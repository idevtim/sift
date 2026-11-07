// Synthesized, very quiet UI sounds. Muted when the pref is off or the window
// is in the background.

import { usePrefs } from "@/stores/prefsStore";

export type SoundKind = "tick" | "tap" | "open" | "chime" | "sift";

let ctx: AudioContext | null = null;

export function play(kind: SoundKind) {
  if (!usePrefs.getState().soundOn || document.hidden) return;
  try {
    const C = (ctx ??= new AudioContext());
    if (C.state === "suspended") void C.resume();
    const t = C.currentTime;
    const tone = (f: number, start: number, dur: number, vol: number, type: OscillatorType = "sine") => {
      const o = C.createOscillator();
      const g = C.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t + start);
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(vol, t + start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g);
      g.connect(C.destination);
      o.start(t + start);
      o.stop(t + start + dur + 0.05);
    };
    switch (kind) {
      case "tick":
        tone(1500, 0, 0.05, 0.03);
        break;
      case "tap":
        tone(700, 0, 0.07, 0.025, "triangle");
        break;
      case "open":
        tone(520, 0, 0.12, 0.03);
        tone(780, 0.05, 0.16, 0.03);
        break;
      case "chime":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.7, 0.045));
        break;
      case "sift":
        for (let i = 0; i < 18; i++) tone(1600 + ((i * 397) % 1400), i * 0.12, 0.04, 0.012);
        break;
    }
  } catch {
    // Audio is decoration; never let it break the UI.
  }
}
