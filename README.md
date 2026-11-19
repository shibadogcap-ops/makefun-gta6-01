# makefun-gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/shibadogcap-ops/makefun-gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/shibadogcap-ops/makefun-gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

## Palm Bay Heat

**PALM BAY HEAT** is a top-down open-world crime sandbox set in the fictional sunset city of Palm Bay. You play Jesse Vale, a wheelman running jobs for fixer Marla Quinn, and Palm Bay is yours to steal through — cars, sand, and trouble.

Explore a 4800x3200 city built on an 8x10 road grid, with a boardwalk, beach and open ocean at its edge. Steal and drive any car on the road or parked at the curb — traffic AI keeps the streets moving, vehicles take damage and can catch fire. On foot, walk anywhere, aim and shoot with the mouse.

Crime has a heat. A 5-star wanted system sends the police after you, spikes of heat track crimes witnessed in public, and when the law closes in you can end up **busted** — or, with your health gone, **wasted**. Heat cools down if you lay low.

The main story is a 4-job chain: **First Delivery**, **Beach Sprint**, **Hot Wheels** and **The Big Score**. Between story beats, repeatable errands keep you paid, and a 90-second **rampage mode** tests how long you can last and how much cash you can rack up — your best score is saved. A day-locked sunset palette keeps Palm Bay in permanent golden hour, a minimap tracks heat and jobs, and pause and help screens are there when you need them. Money and your best rampage score persist in localStorage between sessions.

### Controls

| Input | Action |
| --- | --- |
| WASD / Arrow keys | Drive / walk |
| F | Enter / exit car, take jobs |
| Mouse | Aim |
| Left click | Shoot |
| Shift | Sprint / handbrake |
| P or Esc | Pause |
| M | Mute |

### Tech notes

Palm Bay Heat is written in vanilla JavaScript ES modules on Canvas 2D — zero dependencies, zero libraries, zero network requests; it plays fully offline. The world is procedurally generated from a deterministic seed, all sound (engine, radio, SFX) is synthesised with the WebAudio API, and save data lives in localStorage.

*All names, the city of Palm Bay and its story are original works. This game is not affiliated with any publisher.*

## Run it

```sh
node serve.ts
```

then open http://localhost:8080 in a desktop browser (any static file server pointed at game/ works too — the game itself is game/index.html).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
