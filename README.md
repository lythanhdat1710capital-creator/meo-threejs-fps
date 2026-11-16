# RAILYARD 9 — a three.js tactical FPS

[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/lythanhdat1710capital-creator/meo-threejs-fps/rank.svg)](https://make.fun/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/lythanhdat1710capital-creator/meo-threejs-fps/reward.svg)](https://make.fun/threejs-fps-02)

A complete round-based tactical FPS built on three.js 0.187.0, for the
[threejs-fps-02 competition](https://make.fun/threejs-fps-02) on make.fun.
No build step, no CDN, no external assets — the whole game is static files
that run offline in a desktop browser.

## The game

Night shift on a freight yard. You are a Viper with two AI squadmates,
against four Jackals holding **Site A**. Plant the spike at the site — or
wipe the other team out. Win the round, earn cash, buy better steel, and do
it again. First to 5 rounds (best of 9) takes the match.

- **Gunplay:** a fixed, learnable spray pattern per weapon (the rifle climbs
  straight up for 9 shots, sweeps left, then whips right — pull down to
  counter it), a near-perfect first shot when standing still, spread that
  punishes moving and rewards crouching and aiming down sights, headshots
  that hit twice as hard, recoil, hit markers and a kill feed.
- **Silence is a weapon:** running is fast but loud — enemies hear it and
  come to check. Hold Shift to walk silently, crouch to move quietest and
  shoot straightest. The HUD shows whether you are loud or silent.
- **Squad:** order your two teammates — Follow me (Z), Hold (X), Rush Site A
  (C) — and ping what you see (V). Teammates acknowledge on the radio and
  call out contacts they spot, with a direction and a marker.
- **Tactics:** one bomb site with plant/defuse timers and progress bars,
  money earned per round and per kill, a buy menu between rounds (rifle,
  DMR, grenades, armour, ammo, and three attachments that visibly tighten
  your spray), lean (Q/E), ADS with sway — hold Shift while aiming to steady
  it — and bots that patrol routes, hold positions, react to sound, take
  cover when hurt, plant the spike and defuse it.

## How to play

| Keys | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look · Click to fire · Right-click to aim down sights |
| Shift | Walk silently (steady your aim while ADS) |
| Ctrl | Crouch |
| R | Reload · G Throw grenade · F Plant / pick up the spike |
| Q / E | Lean left / right |
| 1 / 2 / 3 | Pistol / rifle / DMR |
| Z / X / C | Squad: follow / hold / rush the site · V Spot enemy |
| Space | Jump · B Buy menu (between rounds) |

## Run it locally

```sh
node serve.ts        # http://localhost:8080
```

Hand in the entry with:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/` — the playable game (`index.html`, `src/*.js`, vendored three.js)
- `screenshots/` — three screenshots of the real game
- `main.ts` — copies `game/` + `screenshots/` to the output and writes `dossier.json`
- `serve.ts` — the local static server

MIT licensed.
