---
name: ship-notes
description: Write user-facing Sift release notes into release-notes/vX.Y.Z.md in the project's established voice. Use this whenever the user asks for release notes, "the notes", changelog copy, "what's new" text, or announcement copy for a Sift version — including right after a version bump, when preparing a release, or when they type /release-notes and mean this repo's notes rather than Claude Code's own changelog. Also use it when reviewing or rewriting existing notes in release-notes/.
---

# Sift release notes

You are writing for someone who opened Sift and wants to know what changed for
*them*. Not a changelog, not a commit summary — a short note from the people who
make the app, explaining what's different and what it means for their disk.

The audience is everyday: someone whose drive is filling up and who wants it
handled calmly. Many aren't technical. They trust Sift because it never deletes
anything without a way back — so anything that touches *what gets removed* or
*how it can be restored* deserves the most care.

> `/release-notes` is a **built-in Claude Code command** that shows the CLI's own
> changelog — it will always shadow this skill. Invoke this one as `/ship-notes`,
> or just ask for release notes in plain language and it triggers on its own.

## Before writing

Gather the facts first. Writing notes from memory of the conversation is how a
release gets a bullet describing something that didn't ship.

1. **Get the version** from `package.json`. The notes file is
   `release-notes/v<version>.md`. If the version hasn't been bumped yet, say so —
   the bump usually comes first, and writing notes for the wrong version is worse
   than pausing to ask.
2. **Read the last two release notes files** in `release-notes/`, if any exist.
   They are the living definition of the voice; this skill describes it, but the
   files *are* it. If the voice has drifted since this skill was written, follow
   the files.
3. **Get the actual changes.** `git log --oneline v<previous>..HEAD` and
   `git diff --stat v<previous>..HEAD`. Tags are `vX.Y.Z`. If the release isn't
   tagged yet, diff against the most recent tag; for the first release, describe
   what the app does today. Read the diff itself for anything you'll make a claim
   about — especially what Sift finds, removes, or keeps in Restore, where being
   wrong in the notes is worse than saying nothing.
4. **Borrow the app's words.** Per-kind copy lives in `src/lib/findingCopy.ts`
   ("Old installers", "App leftovers"). Use the same names the user sees on screen.

## Structure

```markdown
# Sift v<version>

<One sentence framing the release and why the user should care.>

## What's new

- **<Bold lead-in, ending in a period.>** <Prose explaining the change and its effect.>

- **<Next one.>** <...>

## One thing worth knowing

<Optional. Honest caveats — a limitation, something Sift deliberately leaves alone, a tradeoff.>

## Works on

- **macOS** 10.15+ (Apple Silicon and Intel)
- **Windows** 10+ (x64 and ARM64)
- **Linux** (x86_64)

---

Grab the latest from the release page.
```

Use `## What's new` for a normal release. When a release is large enough that
the bullets split cleanly by area, use topic headings instead — `## Power tools`,
`## Windows`. Three or four bullets is a healthy release note; one is fine if one
thing shipped. Update the `Works on` list if supported platforms change.

## Voice

Match the app: **plain words, never alarming.**

**Lead with what the user sees, never the implementation.** "Sift now finds
leftovers from apps you've already removed" — not "added an orphaned-support-dir
scanner." Files, functions, crate names, and file paths never appear. (Paths are
for Power tools only, and even there the notes describe the feature, not the path.)

**Say how much, and which way.** If a change means Sift finds more (or less) to
free up, say so plainly and, where you can, roughly how much: *"expect the
number on Home to go up — often by a few gigabytes if you keep old installers
around."* An unexplained jump or drop reads like a bug.

**Be exact about safety.** If a change touches what's pre-selected, what goes to
Restore, how long it's held, or what's permanent, spell it out. Never blur the
line between "held in Restore for 30 days" and "gone for good" — emptying the
Trash is the only permanent action, and the notes must say so whenever it's
involved.

**Admit what was broken.** Don't hide a bug behind "improved reliability." Say
what went wrong and what happens now. Candour is why people trust Sift with
their files.

**Explain the consequence, not just the change.** "Items you removed before
updating are still in Restore" tells the reader what they'll actually experience.

**Keep caveats in the open.** Anything Sift deliberately won't touch (backup
drives, system locations) or can't yet do goes under `## One thing worth knowing`.

**Calm, not cheerful.** No exclamation marks, no emoji, no "health scores," no
fear ("your disk is critically full"). Typographic punctuation — em-dashes,
ellipses — is welcome. Use the platform's own words where it matters: Trash vs
Recycle Bin, Finder / Explorer / Files.

Second person throughout, contractions welcome, sentences on the shorter side.
Warm but unfussy: the register of a helpful friend who's good with computers.

## Worked example

A good bullet — names the change in the user's words, says which way the number
moves, and is exact about safety:

> - **Old installers in your Downloads are counted.** Sift was only looking in a
>   couple of places for installers you've already used, so it missed the ones
>   most people have. Expect the amount on Home to go up. Like everything else,
>   they go to Restore when you free them up — you have 30 days to change your mind.

The same change written badly, for contrast:

> - **Improved installer detection.** Extended `findings::scan` to walk
>   `~/Downloads` for `*.dmg` and `*.pkg`.

The second one tells a user nothing they can act on, leaks the implementation,
and says nothing about whether their files are safe.

## Finishing

Write the file, then read it back once as someone who just updated and noticed
the number on Home changed. If any bullet leaves you asking "so what does that
mean for me — and can I get my files back?", it isn't finished.

Report the path to the user and offer to adjust the framing — the opening
sentence is the part most worth a second opinion, since it sets what the release
is *about*.
