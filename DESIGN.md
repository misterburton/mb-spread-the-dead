# Spread the Dead — build contract

Single source of truth for builders, critics, and smoothing agents. Read this before touching code.

## Pillars
1. **Look**: late-90s console 3D (PS1/Dreamcast). Visible polygons, low-res, vertex jitter, fog draw distance. Readable characters/faces, NOT voxels. Muted near-monochrome horror grade. Mood and readability over detail.
2. **Gore**: low fidelity is license, not restraint. Arterial spray, dismemberment, persistent bodies, persistent blood on her and the street. Kills close, brutal, slow enough to be uncomfortable. Never sexualized — she's an animal feeding.
3. **Concept**: patient zero, a woman the town buried. Women are lineage (convert: silent, costs hunger, she joins the horde autonomously). Men are calories (kill: feeds you, restores rot, leaves a body). Bodies = evidence → town escalates: oblivious → suspicious/clustering → armed → screening converts → cordon. Cordon closes = lose. Convert every woman = win. Feeding accelerates your own extinction (hunger/rot pressure).
4. **Camera**: third-person traversal (watch the horde grow); HARD CUT to intimate first-person per take; snap back out. The cut is the signature.
5. **Controls**: twin-stick touch + one context button. The game decides kiss or kill from the target; the player never chooses.

## Numbers
- ~60 residents, 6 pallbearers. Converts autonomous. Escalation by evidence, never timer.
- Armed residents can kill you and cost horde members. One run: 20–30 min.
- Perf bottleneck = CPU NPC AI, not GPU. Budget: staggered AI ticks (CFG.npc.thinkHz), spatial hashing, no per-frame all-pairs.

## Architecture
- `src/config.js` — ALL tuning constants. Never hardcode.
- `src/engine/` — renderer (WebGPU+WebGL2 fallback), post (grade/dither/vignette), era (jitter/affine TSL), input.
- `src/characters/` — procedural factory; `applyTurn(group)`, `setWalkPhase`, `setDeadPose`, `userData.bloodable`.
- `src/world/` — town generator; `navGrid` (1m cells, 0 walkable / 1 blocked), obstacles AABBs, spawnPoints, lampPositions.
- `src/game/` — state machine, NPC AI, gore system, escalation, HUD, take-cut director, audio.
- `assets/audio/` — CC0/PD only, SOURCES.md log, manifest.json.
- `test/` — per-piece test pages (vite multi-page inputs, served from dist).
- `progress/` — live status page + shots + audio samples.

## Verification rules
- `npm run build` must pass before every commit. Commit after every wave.
- Visual claims need a screenshot (WebGL2 headless path verified; SwiftShader WebGPU can't present headless — env limitation, note it, don't chase it).
- TSL API: read node_modules/three sources or the threejs-webgpu-tsl skill references. Never write TSL from memory.
- Critics run fresh-context, inspect real running output, compare blind. Builder summaries are not evidence.

## Critic bars
1. **Mood**: A/B frames vs low-poly horror reference stills (atmosphere, silhouette, grade) + gore check: visceral 90s survival horror or sanitized? Sanitized fails.
2. **Audio**: Fight Club fight SFX register — close, wet, over-loud. CC0/PD only, licenses logged, layers present (impact, wet, breath, tail), variants per event.
3. **Feel**: full tablet-viewport session; escalation must produce dread not difficulty; take-cut must land every time.

Caps: 6 critic rounds/piece, 6 concurrent subagents.
