# CRASH CATS: Turbo Arena — design

Reference: CATS: Crash Arena Turbo Stars (ZeptoLab). Original title/logo/names; same genre and loop.

## Design brief
- **Promise:** Bolt ridiculous weapons onto a cat-driven battle car, then watch it smash a rival's car in a seconds-long automatic brawl — tinker, go again.
- **Target feeling:** Mischievous engineering pride → nail-biting spectator tension → loud, crunchy payoff.
- **Primary verb:** BUILD (equip chassis / wheels / weapons / gadgets into slots).
- **Secondary verbs:** open crates, fuse duplicate parts (level up), pick a mode, counter-build between rounds (online).
- **Repeat every 5–30 s:** one automatic battle (typ. 8–25 s) → reward → tweak build.
- **Changes across 1–5 min:** trophies/league climb, crates add new parts that change strategy, fused parts grow stats.
- **Lose / learn / restart:** chassis HP hits 0, or the sudden-death bulldozers touch you. HP bars + floating damage show *which* weapon did the work; "Again" is one tap.
- **Rewarded:** builds that reach the enemy body while their own body stays shielded by wheels/parts. **Risk:** tall/top-heavy builds flip; light builds get pushed; weapons facing the wrong way do nothing.
- **Better player:** reads the opponent silhouette (online build phase), counter-builds: wedge vs. tall, fork vs. heavy, back-weapons vs. flippers, bigfoot wheels to ride over.
- **Next decision communicated:** HP/Damage totals on the build screen, slot hotspots on the car, opponent preview in the live-duel build phase.
- **Non-goals:** real-money economy, ads, crate timers, driver skills.

## Core loop contract
Player **builds a car** to **destroy the opponent's body** while **physics (flips, pushes, reach, sudden-death dozers)** creates risk; success gives **trophies + coins + crates (new parts)**; failure costs **trophies** and shows the fight so they can re-build and retry in one tap.

## Modes (multiplayer)
1. **Quick Battle (async PvP)** — server hands you a real player's saved car (ghost) near your trophies, exactly like CATS. Offline → local bot garages.
2. **Live Duel (online, real-time)** — matchmaking queue or private room code. Best of 3. 25 s build phase before each round showing the rival's car; both clients run the same deterministic Rapier sim from a server seed; server simulates too and is authoritative for the score.
3. **Local 2P** — same device, P2 builds from the full catalog, then fight.

## Arena / encounter plan
- Side-on 2.5D arena, 18 m wide; cars spawn at x=±5 facing each other; wall posts at the edges.
- Camera frames both cars, zooms with their separation, shakes on heavy hits.
- 0–2 s: cars accelerate, first contact ~2 s. Weapons auto-fire on cooldowns / contact.
- 30 s: **SUDDEN DEATH** — bulldozers roll in from both walls; touching one is an instant KO. 60 s hard cap → HP% decides.
- Four arenas (Skate Park, Harbor, Airport, Warehouse) rotate by seed: generated painted backdrop + procedural floor & props.

## Parts (v1)
- Chassis: Scooter, Wedge, Box Tank, Dragster, Tower.
- Wheels: Basic, Bigfoot, Spiked, Turbo, Heavy.
- Weapons: Blade (swinging saw), Drill, Chainsaw, Rocket, Fork (flipper), Punch (piston glove).
- Gadgets: Booster, Armor plate, Spring.
- Levels 1–10; fusing two identical parts of the same level → level+1.
