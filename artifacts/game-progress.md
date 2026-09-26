# Game progress — CRASH CATS

## Intent / constraints
- User (Korean): "Make a multiplayer game identical to CATS: Crash Arena Turbo Stars." Follow-up: "use Higgsfield for some assets, procedural for others."
- UI language: Korean. Original branding (not ZeptoLab's logo/names).

## Decisions
- Vite + TS + Three.js client; Node `ws` server (server/) serves static build + websocket.
- Physics: `@dimforge/rapier2d-deterministic-compat` (2D, cross-platform deterministic) in shared `src/shared/sim` used by client AND server.
- Online: lockstep-by-seed (server sends seed + both builds, everyone simulates), server authoritative on result.
- Higgsfield: backdrops, logo, avatars, crates/coin/trophy icons, cat driver GLB, bulldozer GLB, announcer voice.
- Procedural: all vehicle parts (bound to physics dims), floors/props, VFX, SFX (Web Audio).

## Higgsfield jobs
| asset | job id | path |
| --- | --- | --- |
| bg skate / harbor / airport / warehouse / garage | 6dfb91d1, 2c2a14ed, f8ee95f7, dc2fdba6, 30d9b2e9 | public/assets/img/bg_*.jpg |
| logo | ec2c35b8 | public/assets/img/logo.png |
| cat concept | 5e9de3a7 | artifacts/raw/cat_concept.png |
| avatars player/tomcat/punk/siamese | 1c7ad857, 5fcd7f02, 8eef9d12, 6126137a | public/assets/img/av_*.png |
| dozer concept | b0aa778a | artifacts/raw/dozer_concept.png |
| crates wood/silver/gold, coin, trophy | 6c0ffde2, 9dd97b22, 9b3d1afe, 2bdb2ba6, ef6f7975 | public/assets/img/*.png |
| cat driver 3D (tripo h3.1) | 42ff9e4b-5b38-431b-8424-f73f5c32a074 | DONE public/assets/models/cat.glb (textures 512, 622KB) |
| bulldozer 3D (tripo h3.1) | 0bcc818b-e2f5-4a0f-8061-b337677008a2 | DONE public/assets/models/dozer.glb (794KB) |
| announcer TTS x8 (seed_audio, Grady) | ee84d5d6, 6195310b, 6d4e5583, 1194eea1, ed07dbe5, c1d14ee0, bb80187c, 437a5a77 | DONE public/assets/audio/vo_*.mp3 |

## Status
- [x] reference study, skills loaded, design brief
- [x] 2D assets generated + processed
- [x] shared parts + deterministic sim (tools/sim-harness.ts: determinism OK, median 16s)
- [x] procedural part models — WORKER A done (≤31 calls, ≤23.5k tris per car)
- [x] arena/vfx/battle view/garage view — lead (battle-preview.html dev harness)
- [x] UI screens — WORKER B done (26 states × 3 viewports)
- [x] server + protocol + client Net; tools/online-e2e.ts: queue+room best-of-3 OK, hashes consistent
- [x] integration, QA, review fixes, evidence (artifacts/final-evidence.md, pass-2)

## Notes
- Port 5188 is used by the user's other project (hearth-and-kin) → this game's Vite dev = 5288, ws server = 5189.
- No Playwright Chromium installed → tests/inspector use system Edge (channel msedge).
- Fixed: boundary posts at center, overexposed paints (LIGHT_SCALE 0.62), dozer yaw, cat yaw (-0.6), floor extension + harbor water, camera clamp.
