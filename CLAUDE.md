# CLAUDE.md — Imposter Game Project

## What This Is
A real-time multiplayer social deduction game inspired by imposter-game.io and styled like skribbl.io.
Built with Node.js + Express + Socket.io (backend) and vanilla HTML/CSS/JS (frontend).

## Project Structure
```
imposter-game/
├── CLAUDE.md          ← you are here
├── package.json       ← dependencies: express ^4.18.2, socket.io ^4.7.2
├── server.js          ← Express + Socket.io backend (~250 lines)
└── public/
    └── index.html     ← full frontend, all CSS + JS inline (~700 lines)
```

## First-Time Setup
```bash
npm install
node server.js
```
Server runs on http://localhost:3000 and prints a Network URL for other devices on the same WiFi.
For internet play across networks: `npx ngrok http 3000`

---

## Game Rules
- 3–10 players per room
- Most players see a **secret word**; 1 imposter (2 if 7+ players) sees nothing
- Players take turns giving one vague clue referencing the word
- After all clues, everyone votes on who they think the imposter is
- If the imposter is caught, innocents get +100 pts each
- If the imposter escapes (no majority vote), imposter gets +200 pts
- If caught, the imposter gets one chance to guess the word for +150 bonus pts
- Host can set 1–10 rounds; scores accumulate across rounds

---

## Backend: server.js

### Word Lists
7 categories hardcoded in `DEFAULT_WORDS`: Animals, Food, Places, Objects, Movies, Sports, Jobs (~12 words each)

### Room State Object
```js
{
  code,               // 4-char string e.g. "AB3K"
  host,               // socket.id of host
  players,            // [{ id, name, color, score, role }]
  customWords,        // string[] from host textarea
  selectedCategories, // string[] subset of DEFAULT_WORDS keys
  state,              // 'lobby' | 'playing' | 'voting' | 'results' | 'gameover'
  word,               // current round's secret word
  lastWord,           // avoid repeating
  imposters,          // socket.id[]
  clues,              // [{ playerId, playerName, playerColor, clue }]
  votes,              // { [voterId]: targetId }
  clueOrder,          // socket.id[] shuffled each round
  currentClueIndex,   // index into clueOrder
  rounds,             // total rounds configured by host
  currentRound,       // 1-based
  guessUsed,          // bool — imposter only gets one guess per round
}
```

### Socket Events (client → server)
| Event | Payload | Description |
|---|---|---|
| `create-room` | `{ name }` | Host creates room, callback returns `{ success, code, player, room }` |
| `join-room` | `{ name, code }` | Join existing lobby, callback returns same shape |
| `update-settings` | `{ customWords, selectedCategories, rounds }` | Host only, lobby only |
| `start-game` | — | Host only; resets scores, calls startRound() |
| `submit-clue` | `{ clue }` | Only accepted if it's your turn |
| `vote` | `{ targetId }` | Once per player per round |
| `imposter-guess` | `{ guess }` | Imposter only, results phase only, once per round |
| `next-round` | — | Host only; increments round or triggers game-over |
| `back-to-lobby` | — | Host only; resets scores + state |
| `kick-player` | `{ targetId }` | Host only, lobby only |

### Socket Events (server → client)
| Event | When |
|---|---|
| `player-joined` | Someone joins lobby |
| `player-left` | Someone disconnects or is kicked |
| `settings-updated` | Host changes settings |
| `room-update` | Catch-all lobby state sync |
| `game-start` | Per-player event with their word (or null if imposter) |
| `clue-turn` | `{ playerId, index, total }` — whose turn it is |
| `clue-submitted` | `{ entry }` — broadcast to all |
| `voting-start` | `{ players, clues }` — begin voting phase |
| `vote-update` | `{ voterId, count, total }` — live vote count |
| `results` | Full round outcome with scores |
| `imposter-guessed` | `{ correct, guess, word, guesser, players }` |
| `game-over` | `{ players }` sorted by score descending |
| `lobby-return` | Host sent everyone back to lobby |
| `kicked` | Sent only to the kicked player |
| `error-msg` | String error toast |

### Key Server Functions
- `startRound(room)` — picks word, assigns roles, shuffles clue order, emits `game-start` per player (different payload), then emits `clue-turn` after 5s delay
- `resolveVoting(room)` — counts votes, finds most-voted, scores, emits `results`
- `assignRoles(room)` — shuffles players, marks 1 (or 2 if 7+) as imposter
- `pickWord(room)` — pools customWords + selectedCategories, avoids lastWord repeat
- `sanitizePlayers(players, includeRole?)` — strips server-only fields before emitting

---

## Frontend: public/index.html

Single file — all CSS variables, styles, and JS inline.

### Design System
```css
--bg: #09091a          /* page background */
--panel: #10101f       /* sidebar panels */
--card: #17172e        /* card backgrounds */
--border: #28284a
--accent: #7c5cbf      /* purple */
--accent-bright: #9d7de8
--text: #e4e4f4
--imposter: #ff6b6b    /* red */
--innocent: #4ecdc4    /* teal */
--success: #4ade80
--danger: #f87171
```
Fonts: **Fredoka One** (headings/logo) + **Nunito** (body) from Google Fonts

### Screen Flow
```
#screen-landing  →  #screen-lobby  →  #screen-game
                         ↑                  |
                         └──── lobby-return ┘
```

### Game Views (inside #screen-game center panel)
```
#v-reveal    — word card or imposter card + clue order + 5s countdown
#v-clue      — my-turn input OR waiting-for-X card + word reminder
#v-vote      — clickable player grid for voting
#v-results   — outcome, imposter reveal, word reveal, vote counts, scores, guess box
#v-gameover  — final podium with medals
```

### Layout
3-column grid:
- Left (220px): `#game-players` — live player list with turn indicator and scores
- Center (flex): game views, switches via `showView(id)`  
- Right (252px): clue feed (chat-bubble style, animates in from right)

### Key JS Functions
- `showScreen(id)` / `showView(id)` — toggle visibility
- `enterLobby(room)` — populates lobby UI, sets host permissions
- `renderReveal(word, isImposter, order, players)` — injects word reveal HTML + countdown timer
- `renderClueTurn(playerId, index, total)` — renders either my-turn input or waiting card
- `renderResults(...)` — full results page including guess box for caught imposter
- `addToFeed(entry)` — appends clue bubble to right panel feed
- `renderGamePlayers(list, order, activeIdx)` — rebuilds left panel player list
- `saveSettings()` — reads UI state and emits `update-settings`
- `doVote(targetId)` — locks cards, emits `vote`

### Auto-join from URL
If the URL contains `?join=XXXX`, the code field is pre-filled on load.

---

## What's NOT Yet Built (potential next steps)
- [ ] Timer per clue (e.g. 30 seconds or pass)
- [ ] Skip clue / pass button
- [ ] Mobile layout (side panels hidden on <820px but no replacement UI)
- [ ] Chat during results phase
- [ ] Spectator mode
- [ ] Persistent leaderboard
- [ ] Room password / private rooms
- [ ] Sound effects
- [ ] Reconnection handling (if socket drops and reconnects mid-game)
- [ ] Avatar selection instead of color dots
- [ ] Deployment config (Railway, Render, Fly.io all work with `npm start`)

---

## Deployment (when ready)
The app is stateless (rooms live in memory), so any single-instance Node host works:

```bash
# Railway / Render / Fly.io — just point to this repo
# Set env var PORT if needed (defaults to 3000)
npm start
```

For multi-instance deployments you'd need Socket.io Redis adapter — not currently implemented.
