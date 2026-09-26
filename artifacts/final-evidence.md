# CRASH CATS: Turbo Arena — final evidence

## Run
```
npm install
npm run dev          # Vite client http://127.0.0.1:5288  +  ws server :5189 (port 5188 is used by another local project)
npm run build && npm start   # production: one Node server serves dist/ + /ws on :5189
npm test             # Playwright (system Edge): real-input playtest + two-browser online best-of-3
npm run sim:balance  # headless determinism + balance table
npx tsx tools/online-e2e.ts ws://127.0.0.1:5189/ws   # two headless clients, queue + room, exploit probe
```

## What was built
- **Loop (CATS):** build car from parts (5 chassis, 5 wheels, 6 weapons, 3 gadgets; levels 1–10, fuse duplicates) → automatic side-view physics battle (cats drive, weapons auto-fire) → 30 s sudden death with bulldozers → trophies/coins/crates → rebuild.
- **Multiplayer:** Quick Battle vs other players' saved cars (async ghost pool on the server, bots offline); Live Duel best-of-3 via matchmaking queue or 4-letter room code with a 25 s/15 s counter-build phase showing the rival car; Local 2P on one device.
- **Netcode:** deterministic Rapier 2D (`rapier2d-deterministic-compat`) + custom deterministic trig (dmath.ts); server sends seed + builds, both clients and the server simulate; server authoritative, end-tick hash compared.

## Asset sources
| Source | Assets |
| --- | --- |
| Higgsfield `gpt_image_2_5` | 4 arena backdrops, garage backdrop, logo, 4 avatars, 3 crates, coin, trophy (job ids in game-progress.md) |
| Higgsfield `tripo_h3_1_image_to_3d` | cat driver GLB (42ff9e4b…), bulldozer GLB (0bcc818b…) — textures downsized 10 MB → 0.6 MB |
| Higgsfield `seed_audio` (voice Grady) | 8 announcer lines |
| Procedural | every car part (geometry bound to physics dims), liveries/materials, floors, props kit, VFX, all SFX + music (Web Audio), part thumbnails |

## Tests & measurements (this revision)
- `tsc --noEmit`: clean.
- Sim: determinism hash equal across runs; dmath max error 3.8e-8; 60-battle matrix median 16 s, 28 % reach sudden death; ~30 ms per headless battle.
- Starter vs bots win rate: 48 % at 0 trophies; tuned starter-part builds 60–90 % at 100–250 (building matters).
- Playwright `tests/playtest.spec.ts` desktop 1280×720 + mobile 844×390: click 배틀! → fight → skip → result → reward applied (desktop: +28 trophies, +30 coins, +1 crate); 0 console errors. Metrics: `playtest/*-metrics.json`.
- Playwright `tests/online.spec.ts`: two browser contexts, 빠른 매칭 → 준비 완료 ×3 rounds → match end, winner +35 trophies; server logged **0 hash mismatches** (browser V8 vs Node).
- `tools/online-e2e.ts`: queue match + room match both complete best-of-3; rogue `ready` during intermission does not start a round; malformed URL → 400, server alive.
- Production build 4.29 MB JS / 1.54 MB gzip (Rapier WASM inlined as base64 ≈ 2.8 MB — documented tradeoff); prod server serves index/GLB/images + SPA fallback.
- Independent code review (sim/server/client): sim clean; fixed server crash on bad URI, forfeit-reward exploit, intermission round-skip, joinRoom mid-match, disconnect soft-lock, double-start race, build-phase edits ignored, ghost map growth, profile load robustness.

## Canvas inspector — pass-2 (`artifacts/pass-2/`, manifest `artifacts/evidence.json`, checker passed 12 artifacts)
| capture | entropy bits | edge density | lum. contrast | dominant share | calls / tris |
| --- | --- | --- | --- | --- | --- |
| desktop active-play | 7.44 | 0.481 | 163 | 0.08 | 77 / 68k |
| desktop sudden-death | 6.17 | 0.417 | 144 | 0.27 | 75 / 86k |
| desktop home | 6.86 | 0.413 | 192 | 0.05 | 22 / 26k |
| mobile active-play | 6.45 | 0.395 | 154 | 0.23 | 78 / 68k |
| mobile garage | 5.97 | 0.413 | 221 | 0.09 | 26 / 26k |
| mobile sudden-death | 5.91 | 0.371 | 151 | 0.25 | — |
All renderBudget rows within desktop/mobile tier budgets. GPU: headless system Edge; no trustworthy FPS figure was captured.

## Visual scorecard (before: not captured — new game)
| Category | Score | Evidence |
| --- | --- | --- |
| Art direction | 2.5 | warm painted CATS-like identity across backdrops, liveries, ribbons UI, props |
| Hero | 2.5 | generated cat GLB (tinted variants) in authored modular cars: livery, rivets, trim, heat glow, damage flash |
| Obstacles/enemies | 2 | rival cars read by weapon silhouette; generated bulldozers telegraph sudden death |
| Rewards/interactables | 2 | crate reveal sequence, slot hotspots, fuse/sell flow; icons generated |
| World | 2.5 | 4 painted plates + procedural floors (planks/concrete/tarmac), props kit, boundary posts, pier + water |
| Materials | 2 | shared material roles, procedural livery/tread/grunge textures, studio env map |
| Lighting/render | 2 | ACES, per-arena key/fill/rim, PCF soft shadows; contrast 144–221 |
| VFX/motion | 2.5 | hit sparks, heat glow, rockets w/ trails, booster flames, dust, explosions, debris, parachuting cat, KO slow-mo, trauma shake |
| UI/HUD | 2.5 | CATS-style HP/power bar, banners, damage numbers, result/crate/online states, responsive 3 viewports |
| Performance evidence | 2 | renderer counts vs budget, build, playtests; no real-GPU FPS number |
**Average 2.3 — meets the premium threshold (no category < 2).**

## Known limitations
- Server trusts client builds/trophies (no accounts or part-ownership validation); profile lives in localStorage.
- Server re-simulates each round on its main thread (30–190 ms); fine for small groups, a worker pool is the next step at scale.
- SFX/music are procedural Web Audio (Higgsfield's SFX/music models are restricted to its own game pipeline); only the announcer is generated.
- If the opponent's tab is backgrounded, the other player waits in the outro until the server's watch timeout.
- Identical mirror builds are decided by seeded blade-phase luck; some counters (drill lifts blade cars) are intentional.
