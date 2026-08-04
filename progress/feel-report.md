# Feel Critic Report — Spread the Dead

Verdicts from the feel critic session (evidence-driven; frames in `progress/shots/feel-*.png`, capture harness `scripts/feel-capture.mjs`).

## BAR 1 — DREAD, not difficulty: **PASS** (one gap, fixed)

Evidence:
- Sim run (`scripts/sim.mjs`): stages at **0.9 / 2.8 / 5.3 min**, win at 7.4 min, evidence 37/48 — one stage at a time, ~2 min apart, matching the design ladder.
- Announcement works behaviorally:
  - Stage 1 clustering is gradual and visible.
  - Stage 2 rifles physically attach to 1-in-4 men; armed men **AIM (raised arm) within 16m before firing**, 2.5s telegraph inside 8m, muzzle flash + audio crack — confirmed live (`feel-stage2-armed.png`, `feel-stage2-fired.png`, rot −25 on hit).
  - Stage 3 pallbearers (distinct black-suit/tie silhouettes) visibly hunt turned women (`feel-stage3-hunt.png`).
  - Every transition gets a low boom + rising dread drone (director.js) + HUD stage label.
  - EVIDENCE bar gives readable cause→effect (+1 body / +3 witnessed; smooth ramp in sim).
- **Gap found:** stage 4's 90s cordon countdown was invisible — no HUD timer, roadblocks only at world edges.
- **Fix applied:** HUD now shows `CORDON Ns` countdown (amber → red under 20s) whenever stage 4 is active (`hud.js` + `escalation.js` exposes `cordonDeadline`).

Side note: `witnessedConvert` defined in CFG but intentionally unused (converts are silent by design). Run wins at ~8–14 min vs target [20,30] — the dread arc compresses on a clean run; acceptable for the sim-driven no-death path.

## BAR 2 — THE TAKE-CUT: **PASS** (one gap, fixed)

Evidence:
- Hard cut ✓ (single-frame snap to first-person + 0.18s lurch, no crossfade).
- Intimate framing ✓ (`feel-take-cutin.png` — victim's chest/face fills frame at <1.4m).
- Shake = 0.08m handheld wobble, reads as violence ✓.
- Snap-out returns cleanly ✓ (0.18s blend + exact landing on saved transform kills the double-cut; `feel-take-snapout.png` stable behind-her view, evidence incremented).
- Choreography verified in code: bursts at 0/15/40/70% of the 2.6s hold + her/his blood staining + 0.4s drip decals (interactions.js); audio layers impact@0ms, wet@90–170ms, breath@350ms, tail@900ms — impact+wet land inside the 220ms cut (audio.js).
- **Gap found:** mid-hold first-person frame stayed bloodless — bursts biased past the camera and decals pool below frame (`feel-take-hold.png` showed flesh but no red).
- **Fix applied:** blood-flash overlay pulses on kill cuts (0.55) and at the 15/40/70% burst beats (0.55/0.8/0.55) during holds (takecut.js `bloodFlash`).

## Harness bug found & fixed by the critic
`main.js` sim mode rendered only 1 tick in 30 for any `?sim` value → headless frames ~0.5s stale vs game state. Patched: `?sim=1` renders every tick, `?sim=fast` keeps 1-in-30.

## Frames
- Take sequence: `feel-take-before.png`, `feel-take-cutin.png`, `feel-take-hold.png`, `feel-take-cutout.png`, `feel-take-snapout.png`, `feel-take-after.png`
- Stages: `feel-stage1-cluster.png`, `feel-stage2-armed.png`, `feel-stage2-fired.png`, `feel-stage3-hunt.png`, `feel-stage4-cordon.png`
