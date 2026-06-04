# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is
A real-time multiplayer social deduction game. Players get a secret word and give vague clues; one player (the imposter) doesn't know the word and must blend in. Built with Node.js + Express + Socket.io backend and a single-file vanilla HTML/CSS/JS frontend. Deployed on Railway at https://imposter-game-production-395b.up.railway.app — auto-deploys on every push to `main`.

## Setup & Running
```bash
npm install
node server.js          # http://localhost:3000
```
No build step. Changes to `public/index.html` or `server.js` are live on next server restart.

## Live Debug Endpoint
```bash
curl "http://localhost:3000/api/hint-test?word=Gojo"
curl "https://imposter-game-production-395b.up.railway.app/api/hint-test?word=elephant"
# Returns: { word, hint, keySet, error }
```

---

## Architecture

### File Structure
```
server.js              — Express + Socket.io backend (~500 lines)
public/index.html      — entire frontend: CSS vars + all JS inline (~1100 lines)
anime-words.csv        — 220 anime characters for bulk import
docs/SESSION-LOG.md    — full history of everything built
docs/superpowers/plans/ — implementation plans
```

### Room State (server.js)
```js
{
  code, host,
  players,            // [{ id, name, color, score, role }]
  state,              // 'lobby' | 'playing' | 'voting' | 'results' | 'gameover'
  word,               // always stripped of [context] brackets
  lastWord,
  imposters,          // socket.id[]
  clues, votes, clueOrder, currentClueIndex,
  rounds, currentRound, guessUsed,
  customWords,        // plain word strings (brackets stripped on save)
  customWordContexts, // { "levi": "Attack on Titan character" } — lowercase keys
}
```

### Word Categories & Contexts
`DEFAULT_WORDS` has 8 categories: Animals, Food, Places, Objects, Movies, Sports, Jobs, **Anime** (220 characters across 35 series).

`DEFAULT_WORD_CONTEXTS` is a flat map `{ lowercase_name → "Series character" }` for all 220 anime characters. When a word has a context (either from this map or `customWordContexts`), the Groq hint call is **skipped** — the series name IS the hint.

### AI Hints (Groq API)
- Env var: `GROQ_API_KEY` (set in Railway Variables)
- Model: `llama-3.1-8b-instant`
- Called in `startRound()` only when `wordContext` is null
- Prompt targets ~5/10 similarity — bans synonyms, body parts, direct associations, other character names
- `wordContext` (series name) passed to imposter alongside `hintWord` in `game-start`

### Custom Words with Context
Host types `Levi [Attack on Titan character]` in textarea — server parses bracket syntax, stores plain word + context separately. Brackets never appear in gameplay. Also supports XLSX/CSV bulk import via SheetJS CDN (Column A = word, Column B = context).

### Key Socket Events

**Client → Server:**
| Event | Guard | Description |
|---|---|---|
| `create-room` / `join-room` | — | Callback-based lobby entry |
| `update-settings` | host + lobby | `{ customWords, selectedCategories, rounds }` |
| `start-game` | host | Resets scores, calls `startRound()` |
| `submit-clue` | your turn + playing | If imposter says the word → immediate win +200 pts |
| `vote` | voting phase | Once per player |
| `imposter-guess` | imposter + results + once | Word guess after being caught (+150 pts if correct) |
| `next-round` | host + not gameover | Blocked when `room.state === 'gameover'` |
| `back-to-lobby` / `kick-player` | host | Lobby management |

**Server → Client (notable):**
| Event | Key Fields |
|---|---|
| `game-start` | `{ word, isImposter, hintWord, wordContext, clueOrder, round, totalRounds }` |
| `imposter-self-revealed` | `{ imposterId, imposterName, word, players }` — mid-clue win |
| `imposter-guessed` | `{ correct, guess, word, guesser, players }` — post-catch guess |
| `game-over` | `{ players, imposters, imposterNames, word }` |

### Frontend State (public/index.html)
Key globals: `myId`, `myRole`, `myWord`, `myHintWord`, `myWordContext`, `isHost`, `players`, `selectedCats`, `hasVoted`, `hasGuessed`.

Views inside `#screen-game` switched via `showView(id)`:
`v-reveal` → `v-clue` → `v-vote` → `v-results` → `v-gameover`

### Scoring
| Outcome | Points |
|---|---|
| Imposter escapes vote | +200 to imposter |
| Innocents catch imposter | +100 to each innocent |
| Imposter guesses word after being caught | +150 to imposter |
| Imposter says word as clue mid-game | +200 to imposter, round ends immediately |

### Important Behaviours to Know
- `room.word` is always stripped of `[context]` brackets (done in `startRound`)
- Word banner on results screen shows `???` to the imposter until they submit their guess, then reveals real word via `#word-banner-reveal`
- `next-round` handler is guarded against `room.state === 'gameover'` to prevent race condition when imposter correctly guesses during 3s delay
- `game-over` payload always includes `imposters`, `imposterNames`, `word` so the final screen can show who was the imposter

---

## Deployment
Railway auto-deploys on `git push` to `main`. Required env var:
- `GROQ_API_KEY` — Groq API key (free tier sufficient; `llama-3.1-8b-instant`)
