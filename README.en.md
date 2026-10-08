# 🏆 QuizArena

[![CI](https://github.com/nilpm/quizarena/actions/workflows/ci.yml/badge.svg)](https://github.com/nilpm/quizarena/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)

**A real-time, bracket-style quiz tournament.** A host projects their screen, players join by scanning a QR code with their phones, and they face each other 1-vs-1 until a champion remains.

🇪🇸 [Leer en español](README.md)

> **Note:** the game interface and the bundled sample questions are in Spanish.

---

## Features

- 🎮 **Nothing to install for players**: they join from their phone's browser via QR and pick a name, shape and color.
- 🥊 **Automatic bracket**: 1-vs-1 rounds, a repechage (second chance) for first-round losers, semifinals, third-place match and final.
- ⚡ **Real time** with [Socket.IO](https://socket.io/): scores, bracket and reconnections update instantly.
- 🖥️ **Host dashboard** protected by a PIN: tournament settings, question editor, bracket view and podium.
- 🔌 **Fault tolerant**: a disconnected player has 20 s to come back before losing by walkover.
- 🪶 **Very lightweight**: designed for servers with ~0.1 CPU / 512 MB (precompressed in-memory static files, no per-message compression).
- 🤖 **Bots and autopilot** to test a full tournament without dozens of phones.
- 🌐 **No client-side internet dependencies**: custom inline SVG icons, no CDN or external libraries.

## Quick start

Requirements: [Node.js](https://nodejs.org/) 18 or newer.

```bash
git clone https://github.com/nilpm/quizarena.git
cd quizarena
npm install
npm start
```

The console prints something like:

```
Jugadores (QR):  http://192.168.1.20:3000
Anfitrión:        http://192.168.1.20:3000/host.html
PIN del anfitrión:  4821   (aleatorio; fíjalo con la variable HOST_PIN)
```

1. Open the **host** URL on the machine connected to the projector and enter the PIN.
2. Players scan the **QR** (or open the player URL) while on the same network.
3. Once everyone is in the lobby, press **Iniciar torneo** (Start tournament).

> To play with people outside your local network, deploy to a Node.js host and set `PUBLIC_URL` (see [Configuration](#configuration)).

### Try it without phones

Type test commands in the console where the server is running:

```text
bots 30            # add 30 fake players to the lobby
cfg battleSec=15   # shorter battles
start              # start the tournament
auto on            # the host plays itself until the end
```

Type `help` for the full list. `FAST=1 npm start` speeds up all game timers 10×.

## How it plays

| Phase | What happens |
| --- | --- |
| **Lobby** | Players join and customize their avatar. The host adjusts the settings. |
| **Round 1** | Random pairings. Each player answers on their own phone for `battleSec` seconds. The loser goes to the repechage. |
| **Repechage** | Round-1 losers face each other; the winner returns to the bracket, the loser is eliminated. |
| **Rounds 2…n** | Losers are eliminated. With an odd number of players one gets a *bye* and advances automatically. |
| **Semifinals / 3rd place / Final** | With 4 or fewer players left, matches are played **on the host screen** and players answer with a phone pad (A/B/C/D). |
| **Podium** | The top 3 are shown together with the configured prizes. |

**Scoring**: 100 points per correct answer, +50 for the first player to get each question right.
**Ties**: whoever scored first wins; if nobody scored, it is decided by coin flip.
**Global timer**: when the tournament's total time runs out, the current phase finishes and everyone is ranked by accumulated points.

## Configuration

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST_PIN` | random on every start | PIN to access `/host.html`. Always set it in production. Empty (`HOST_PIN=`) disables protection. |
| `PUBLIC_URL` | `http://<local-IP>:<PORT>` | URL encoded in the QR code. Required behind a proxy or on a hosting platform. |
| `QUESTIONS_FILE` | `data/questions.json` | Path to the question bank. |
| `FAST` | – | If set, speeds up timers ×10 (testing only). |

See [`.env.example`](.env.example). With Node ≥ 20.6 you can load it with:

```bash
node --env-file=.env src/server.js
```

### Tournament options (host dashboard)

| Option | Default | Range | Description |
| --- | --- | --- | --- |
| `totalMin` | 40 | 1–240 | Total tournament length (minutes). |
| `battleSec` | 60 | 10–600 | Length of each regular battle (seconds). |
| `qCount` | 5 | 1–20 | Questions per battle. |
| `topQSec` | 15 | 5–60 | Time per question in semifinals and final (seconds). |
| `prizes` | – | – | 1st, 2nd and 3rd place prizes (free text). |

## Questions

Questions live in [`data/questions.json`](data/questions.json) and can be edited from the **Preguntas** button in the host dashboard (they are validated before saving).

```json
{
  "ronda1": [
    { "q": "¿Cuál es la capital de Francia?", "o": ["Madrid", "París", "Roma", "Berlín"], "a": 1 }
  ],
  "final": [ ... ],
  "otras": [ ... ]
}
```

- `q`: question text.
- `o`: 2 to 4 options.
- `a`: zero-based index of the correct option.

Each phase draws from its own key: `repechaje`, `ronda1`, `ronda2`, … `ronda10`, and `final` (semifinals, third place and final). If a key has fewer questions than needed it is topped up from `otras`; options are shuffled per player.

## Deployment

Any platform that runs Node.js will do (Render, Railway, Fly.io, a VPS…). The essentials:

- Start command: `npm start`
- Variables: `HOST_PIN` and `PUBLIC_URL` (the public `https://` URL).
- Run **a single instance**: tournament state is kept in memory.
- WebSocket support enabled (most platforms have it by default).

## Project structure

```text
quizarena/
├── src/
│   ├── server.js        # Express + Socket.IO server and tournament logic
│   ├── questions.js     # Question bank validation
│   └── fast-static.js   # Precompressed in-memory static file server
├── public/              # Client (player: index.html, host: host.html)
├── data/questions.json  # Question bank
├── test/                # Tests (node:test, no extra dependencies)
└── docs/ARCHITECTURE.md # Internal design and event protocol
```

More details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```bash
npm run dev    # restart the server on file changes
npm test       # run the tests
```

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Known limitations

- Only one tournament at a time, and its state is in memory (lost on restart).
- The PIN protects the host dashboard but does not replace HTTPS: on the public internet always use `https://`.
- The UI is in Spanish.

## Credits

- Click sound: `public/buttonClickSong_V1.mp3` [Freesound](https://freesound.org/people/EdgardEdition/sounds/113636/).
- Built with [Express](https://expressjs.com/), [Socket.IO](https://socket.io/) and [qrcode](https://github.com/soldair/node-qrcode).

## License

[MIT](LICENSE) © 2026 nilpm
