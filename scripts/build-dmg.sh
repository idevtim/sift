#!/bin/bash
set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load credentials from .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
else
  echo "❌ .env file not found at $PROJECT_DIR/.env"
  echo "   Copy .env.example and fill in your Apple credentials."
  exit 1
fi

: "${APPLE_ID:?APPLE_ID is not set in .env}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD is not set in .env}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is not set in .env}"

APP_NAME="Sift"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Tim Murphy ($APPLE_TEAM_ID)}"

# Releases are drafted on the public repo (the same one as the code).
RELEASE_REPO="idevtim/sift"
RELEASE_TARGET="main"

# Updater signing key. Tauri reads TAURI_SIGNING_PRIVATE_KEY (raw key bytes)
# and TAURI_SIGNING_PRIVATE_KEY_PASSWORD; without BOTH set it silently skips
# signing and no .sig sibling is emitted (the build still "succeeds").
KEY_PATH="$HOME/.tauri/sift.key"
if [ -f "$KEY_PATH" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
  # Tauri requires _PASSWORD to be set even for passwordless keys.
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  SIGNING_ENABLED=true
  echo "✓ Updater key: $KEY_PATH"
else
  SIGNING_ENABLED=false
  echo "⚠️  Updater key missing at $KEY_PATH — bundles will be UNSIGNED"
  echo "    Generate with: npx @tauri-apps/cli signer generate -w $KEY_PATH"
fi

# ─── Pre-flight: updater pubkey matches the key we sign with ────────────────
# A mismatch builds and uploads fine, then every installed copy rejects the
# update at download time. Catch it here instead.
if $SIGNING_ENABLED; then
  CONF_PUBKEY=$(node -p "require('$PROJECT_DIR/src-tauri/tauri.conf.json').plugins.updater.pubkey")
  if [ "$CONF_PUBKEY" != "$(cat "$KEY_PATH.pub")" ]; then
    echo "❌ plugins.updater.pubkey in tauri.conf.json doesn't match $KEY_PATH.pub"
    echo "   Paste the output of \`cat $KEY_PATH.pub\` into tauri.conf.json."
    exit 1
  fi
  echo "✓ Updater pubkey matches $KEY_PATH.pub"
fi

# ─── Pre-flight: version + release notes ────────────────────────────────────
VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
TAURI_VERSION=$(node -p "require('$PROJECT_DIR/src-tauri/tauri.conf.json').version")
CARGO_VERSION=$(grep -m1 '^version' "$PROJECT_DIR/src-tauri/Cargo.toml" | sed -E 's/version = "(.*)"/\1/')

if [ "$VERSION" != "$TAURI_VERSION" ] || [ "$VERSION" != "$CARGO_VERSION" ]; then
  echo "❌ Version mismatch:"
  echo "   package.json:    $VERSION"
  echo "   tauri.conf.json: $TAURI_VERSION"
  echo "   Cargo.toml:      $CARGO_VERSION"
  exit 1
fi

RELEASE_NOTES="$PROJECT_DIR/release-notes/v$VERSION.md"
if [ ! -f "$RELEASE_NOTES" ]; then
  echo "❌ Missing release notes: release-notes/v$VERSION.md"
  echo "   Create this file before releasing."
  exit 1
fi
echo "✓ Found release notes for v$VERSION"

# ─── Pre-flight: signing identity exists ────────────────────────────────────
if ! security find-identity -v -p codesigning | grep -qF "$SIGNING_IDENTITY"; then
  echo "❌ Signing identity not found in keychain:"
  echo "   $SIGNING_IDENTITY"
  echo "   Available identities:"
  security find-identity -v -p codesigning | sed 's/^/     /'
  exit 1
fi
echo "✓ Signing identity present: $SIGNING_IDENTITY"

# ─── Pre-flight: rust targets installed ─────────────────────────────────────
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -q "^$target$"; then
    echo "🦀 Installing missing rust target: $target"
    rustup target add "$target"
  fi
done

# ─── Build (Tauri codesigns + notarizes + staples the .app) ─────────────────
# Sift ships a single bundle with nothing injected after the build, so the
# Tauri bundler can do the whole signing job. It reads:
#   APPLE_SIGNING_IDENTITY                     → codesign identity
#   APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID  → notarytool credentials
# The .app.tar.gz updater payload is made by Tauri in Rust (no AppleDouble
# sidecars), so it doesn't need repacking either.
export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"
export APPLE_ID
export APPLE_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"
export APPLE_TEAM_ID

echo "🔨 Building $APP_NAME v$VERSION (universal: arm64 + x86_64)..."
echo "   Tauri signs + notarizes the .app (1–5 min waiting on Apple)."
cd "$PROJECT_DIR"

BUNDLE_DIR="$PROJECT_DIR/src-tauri/target/universal-apple-darwin/release/bundle"

# Wipe any prior bundle output. Tauri doesn't always overwrite cleanly when
# inputs haven't changed, so a stale DMG / .app.tar.gz from a previous version
# can otherwise be picked up by the asset-locating logic below.
if [ -d "$BUNDLE_DIR" ]; then
  echo "🧹 Clearing previous bundle output: $BUNDLE_DIR"
  rm -rf "$BUNDLE_DIR"
fi

# Updater artifacts (.sig + payload) are opt-in via tauri.release.conf.json, so
# a plain `npm run tauri:build` works without the key. Only add it when signing.
RELEASE_CONF=()
if $SIGNING_ENABLED; then
  RELEASE_CONF=(--config src-tauri/tauri.release.conf.json)
fi
npm run tauri:build -- --target universal-apple-darwin ${RELEASE_CONF[@]+"${RELEASE_CONF[@]}"}
APP_PATH="$BUNDLE_DIR/macos/$APP_NAME.app"
DMG_PATH="$BUNDLE_DIR/dmg/${APP_NAME}_${VERSION}_universal.dmg"
TARGZ_PATH="$BUNDLE_DIR/macos/$APP_NAME.app.tar.gz"
SIG_PATH="$TARGZ_PATH.sig"

if [ ! -d "$APP_PATH" ] || [ ! -f "$DMG_PATH" ]; then
  echo "❌ Build did not produce expected artifacts:"
  echo "   $APP_PATH"
  echo "   $DMG_PATH"
  exit 1
fi

if $SIGNING_ENABLED; then
  if [ ! -f "$TARGZ_PATH" ] || [ ! -f "$SIG_PATH" ]; then
    echo "❌ Signing was enabled but updater payload is missing:"
    echo "   $TARGZ_PATH"
    echo "   $SIG_PATH"
    echo "   Usually TAURI_SIGNING_PRIVATE_KEY_PASSWORD in .env is wrong for $KEY_PATH."
    exit 1
  fi
  echo "✓ Updater payload signed"
fi

# ─── Sign + notarize + staple the DMG ───────────────────────────────────────
# The .app inside is already notarized + stapled by Tauri; notarize the DMG
# wrapper too so Gatekeeper doesn't have to fetch the ticket online on first
# launch.
codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$DMG_PATH"

echo "📤 Submitting DMG to notarytool (this can take 1–5 min)..."
xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

echo "📎 Stapling notarization ticket to DMG..."
xcrun stapler staple "$DMG_PATH"

# ─── Verify ─────────────────────────────────────────────────────────────────
echo "🔍 Verifying code signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH" 2>&1 | tail -5

echo "🔍 Verifying notarization ticket on DMG..."
if ! xcrun stapler validate "$DMG_PATH" 2>&1 | tail -5; then
  echo "❌ Stapler validation failed — DMG is not notarized."
  exit 1
fi

echo "🔍 Final Gatekeeper check on .app..."
spctl --assess --type execute --verbose "$APP_PATH" 2>&1 | tail -5 || {
  echo "⚠️  spctl assessment failed; the app may still work but Gatekeeper will warn."
}

echo ""
echo "✅ Build complete: $DMG_PATH (v$VERSION)"

# ─── GitHub Release ─────────────────────────────────────────────────────────
if gh auth status >/dev/null 2>&1; then
  echo "🚀 Drafting GitHub release v$VERSION on $RELEASE_REPO..."
  # Tag the built commit on origin (idevtim/sift) so the release points at its source.
  git tag "v$VERSION" 2>/dev/null || echo "   Tag v$VERSION already exists on origin"
  git push origin "v$VERSION" 2>&1 || echo "   (tag push skipped or already pushed)"

  # Build the asset list. DMG is always uploaded (first-install download).
  # Updater payload (.app.tar.gz + .sig) and latest.json only when signing.
  ASSETS=("$DMG_PATH")

  if $SIGNING_ENABLED; then
    ASSETS+=("$TARGZ_PATH" "$SIG_PATH")

    # Generate/merge latest.json. If a Windows/Linux build already uploaded
    # one, download it and merge in our darwin entries without clobbering theirs.
    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT

    EXISTING_MANIFEST=""
    if gh release view "v$VERSION" --repo "$RELEASE_REPO" >/dev/null 2>&1; then
      if gh release download "v$VERSION" --repo "$RELEASE_REPO" --pattern 'latest.json' --dir "$TEMP_DIR" 2>/dev/null \
         && [ -f "$TEMP_DIR/latest.json" ]; then
        EXISTING_MANIFEST=$(cat "$TEMP_DIR/latest.json")
        echo "   Merging into existing latest.json from release"
      fi
    fi

    PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    NOTES=$(cat "$RELEASE_NOTES")
    SIG_CONTENT=$(cat "$SIG_PATH")
    TAR_URL="https://github.com/$RELEASE_REPO/releases/download/v$VERSION/$(basename "$TARGZ_PATH")"
    LATEST_JSON_PATH="$TEMP_DIR/latest.json"

    # `darwin-aarch64` and `darwin-x86_64` both point at the universal tarball
    # — Tauri's updater picks the entry matching the running arch and either
    # works.
    if [ -n "$EXISTING_MANIFEST" ]; then
      echo "$EXISTING_MANIFEST" | jq --arg ver "$VERSION" --arg notes "$NOTES" --arg date "$PUB_DATE" \
        --arg sig "$SIG_CONTENT" --arg url "$TAR_URL" '
        .version = $ver |
        .notes = $notes |
        .pub_date = $date |
        (.platforms //= {}) |
        .platforms["darwin-aarch64"] = {signature: $sig, url: $url} |
        .platforms["darwin-x86_64"] = {signature: $sig, url: $url}
      ' > "$LATEST_JSON_PATH"
    else
      jq -n --arg ver "$VERSION" --arg notes "$NOTES" --arg date "$PUB_DATE" \
        --arg sig "$SIG_CONTENT" --arg url "$TAR_URL" '
        {
          version: $ver,
          notes: $notes,
          pub_date: $date,
          platforms: {
            "darwin-aarch64": {signature: $sig, url: $url},
            "darwin-x86_64": {signature: $sig, url: $url}
          }
        }
      ' > "$LATEST_JSON_PATH"
    fi

    ASSETS+=("$LATEST_JSON_PATH")
  fi

  if gh release view "v$VERSION" --repo "$RELEASE_REPO" >/dev/null 2>&1; then
    echo "   Release exists — uploading ${#ASSETS[@]} asset(s)"
    for asset in "${ASSETS[@]}"; do
      echo "   uploading $(basename "$asset")"
      gh release upload "v$VERSION" "$asset" --repo "$RELEASE_REPO" --clobber
    done
  else
    echo "   Creating draft release with ${#ASSETS[@]} asset(s)"
    gh release create "v$VERSION" "${ASSETS[@]}" \
      --repo "$RELEASE_REPO" \
      --target "$RELEASE_TARGET" \
      --title "v$VERSION" \
      --notes-file "$RELEASE_NOTES" \
      --draft
  fi

  # Verify every asset landed.
  PRESENT=$(gh release view "v$VERSION" --repo "$RELEASE_REPO" --json assets --jq '.assets[].name')
  for asset in "${ASSETS[@]}"; do
    name=$(basename "$asset")
    if ! echo "$PRESENT" | grep -qFx "$name"; then
      echo "❌ Upload reported success but $name is missing from the release."
      echo "   Present: $PRESENT"
      exit 1
    fi
  done

  echo "✅ Drafted v$VERSION on $RELEASE_REPO — review and publish from the Releases page."
  echo "    https://github.com/$RELEASE_REPO/releases/tag/v$VERSION"

  # ─── Homebrew cask ────────────────────────────────────────────────────────
  # `brew install --cask idevtim/tap/sift` installs whatever version the cask
  # names, so a release that skips this leaves every *new* Homebrew install one
  # version behind. Existing installs don't notice (the cask says
  # `auto_updates true` and Sift's updater handles them), which is exactly why
  # a stale cask goes unseen.
  #
  # The hash is of $DMG_PATH, the bytes just uploaded, so it matches the
  # download without fetching it back. The tap is a separate repo; this commits
  # the bump there and stops. Push it only after publishing the draft: until
  # then the DMG URL 404s for anyone else.
  HOMEBREW_TAP_DIR="${HOMEBREW_TAP_DIR:-$(dirname "$PROJECT_DIR")/homebrew-tap}"
  CASK_PATH="$HOMEBREW_TAP_DIR/Casks/sift.rb"
  DMG_SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
  if [ ! -f "$CASK_PATH" ]; then
    echo "⚠️  No cask at $CASK_PATH — set HOMEBREW_TAP_DIR, then bump it by hand:"
    echo "     version \"$VERSION\"   sha256 \"$DMG_SHA256\""
  else
    sed -i '' -E \
      -e "s/^(  version )\"[^\"]*\"/\1\"$VERSION\"/" \
      -e "s/^(  sha256 )\"[^\"]*\"/\1\"$DMG_SHA256\"/" \
      "$CASK_PATH"
    if grep -q "^  version \"$VERSION\"$" "$CASK_PATH" && grep -q "^  sha256 \"$DMG_SHA256\"$" "$CASK_PATH"; then
      git -C "$HOMEBREW_TAP_DIR" commit -q -m "feat: update sift to $VERSION" -- Casks/sift.rb >/dev/null 2>&1 \
        || echo "   cask already at $VERSION"
      echo "🍺 Cask bumped to $VERSION in $HOMEBREW_TAP_DIR (committed, not pushed)"
      echo "   Push it after publishing the draft — until then, brew installs the previous version."
    else
      echo "⚠️  Could not rewrite version/sha256 in $CASK_PATH — bump it by hand:"
      echo "     version \"$VERSION\"   sha256 \"$DMG_SHA256\""
    fi
  fi
else
  echo "ℹ️  Skipping GitHub release — run \`gh auth login\` to enable."
  echo "    Manual: gh release create v$VERSION \"$DMG_PATH\" --repo $RELEASE_REPO --target $RELEASE_TARGET --title v$VERSION --notes-file \"$RELEASE_NOTES\" --draft"
fi
