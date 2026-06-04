# Imposter Game — Session Log

## Project Overview
Multiplayer social deduction game (like skribbl.io meets Among Us).
- **Stack:** Node.js + Express + Socket.io (backend), vanilla HTML/CSS/JS (frontend)
- **Live URL:** https://imposter-game-production-395b.up.railway.app
- **GitHub:** https://github.com/dandon21/imposter-game
- **Local path:** `/Users/jashanshah/Downloads/imposter-game/`
- **Railway service:** auto-deploys on every `git push` to `main`

---

## Everything Built

### 1. UI/UX Accessibility Pass
- Global `prefers-reduced-motion` CSS override
- `touch-action: manipulation` on all interactive elements
- `.rnd-btn` and `.btn-icon` minimum 44×44px touch targets
- `focus-visible` rings on all interactive elements
- `aria-label` on copy-code, copy-link, and kick buttons
- `<label for>` associations on all form inputs
- `autocomplete="name"` on name input
- `role="alert"` + `aria-live` on error paragraph and toast container
- Vote cards keyboard-navigable (`role="button"`, `tabindex`, keydown handler)
- Confirmation dialog before Leave button

### 2. Deployment to Railway
- Created GitHub repo: `https://github.com/dandon21/imposter-game`
- Deployed to Railway → permanent URL active
- Auto-deploy on every push to `main`

### 3. Full Visual Redesign (glassmorphism dark UI)
- Font: Inter (body) + Fredoka One (headings)
- Background: `#07070f` near-black
- Cards: `rgba(255,255,255,0.04)` + `backdrop-filter: blur(20px)`
- Accent: `#7c3aed` violet with `#a78bfa` bright variant
- Buttons: gradient + glow shadow + spring-physics hover
- Inputs: glass-tinted with glowing focus ring
- Landing: ambient gradient blobs via CSS `::before`
- Vote cards: glass with violet/red glow states
- Toasts: blurred glass with spring entrance

### 4. Feature: Imposter correct guess ends game immediately
When caught imposter guesses the word correctly after voting:
- +150 pts bonus to imposter
- `room.state = 'gameover'` immediately
- 3s delay then `game-over` event fires

### 5. Feature: Gemini → Groq AI hint word for imposter
**How it works:**
- When a round starts, server calls AI API with the secret word
- AI returns one related-but-different hint word
- Only sent to the imposter in their `game-start` payload as `hintWord`
- Shown on the reveal screen AND persisted in the clue-giving screen

**Journey:** Started with Gemini (`gemini-1.5-flash`) → switched to `gemini-2.0-flash` → hit 429 quota on all Gemini models → switched to Groq (`llama3-8b-8192`) → model decommissioned → updated to `llama-3.1-8b-instant` (current).

**Railway env var:** `GROQ_API_KEY`

**Debug endpoint:** `GET /api/hint-test?word=elephant` → `{ word, hint, keySet, error }`

### 6. Feature: Custom word context (`Word [context]` syntax)
- Host types `Levi [Attack on Titan character]` in the custom words textarea
- Server parses bracket syntax: stores plain word + context separately
- `room.customWords = ["Levi"]`, `room.customWordContexts = { "levi": "Attack on Titan character" }`
- Context passed to AI hint prompt and to imposter as `wordContext`
- Brackets never shown in gameplay

### 7. Hint quality improvements
- Prompt rewritten to target ~5/10 similarity
- Explicitly bans synonyms, body parts, direct associations, other character names
- Character-specific example added to prompt (Levi bad/good hints)
- When `wordContext` is set: Groq call skipped entirely — series name IS the hint

### 8. Feature: XLSX/CSV bulk word import
- "📂 Import" button added to lobby (host-only)
- SheetJS loaded via CDN — no npm package
- Client-side parsing of `.xlsx`, `.xls`, `.csv`
- Column A = word, Column B = optional context
- Auto-formats as `Word [context]`, appends to textarea, auto-saves
- Smart header row detection (skips rows where col A is "word", "name", etc.)
- Import button hidden for non-hosts
- Hint text updated: "Added alongside chosen categories · Use Word [context] or import a spreadsheet"

### 9. Feature: Anime built-in category
- 220 anime characters across 35 series added to `DEFAULT_WORDS.Anime`
- `DEFAULT_WORD_CONTEXTS` flat map added for all 220 characters
- Anime appears as a selectable checkbox in lobby alongside Animals, Food, etc.
- `anime-words.csv` file created for manual import reference
- Series covered: One Piece, JoJo's, HxH, Spy x Family, JJK, Chainsaw Man, Demon Slayer, Oregairu, Oshi no Ko, Takopi, COTE, Naruto, Bleach, Dragon Ball, Pokemon, Edgerunners, Mob Psycho 100, Dandadan, Assassination Classroom, Kakegurui, Danganronpa, Kaoru Hana, Otonari no Tenshi, Horimiya, Fruits Basket, Tonikawa, Fire Force, Hell's Paradise, Haikyuu, Blue Lock, NieR Automata, 86, Death Note, FMAB, OPM

### 10. Feature: Imposter sees series context in-game
- `wordContext` sent to imposter in `game-start` payload (server → client)
- Reveal screen: "Series" card shows e.g. "Jujutsu Kaisen"
- Active clue turn word-reminder: shows `from Jujutsu Kaisen` subtitle
- Waiting word-reminder: same subtitle
- Series name displayed with " character" suffix stripped (`.replace(/ character$/, '')`)

### 11. Bug fix: Word banner hides word from imposter before guess
- Results screen showed word to everyone including the imposter, making the guess trivial
- Fixed: word banner shows `???` to imposter until they submit their guess
- After guess (correct or wrong): banner updates to real word via `#word-banner-reveal`

### 12. Bug fix: Game-over screen reveals imposter
- `game-over` payload now includes `imposters`, `imposterNames`, `word`
- Final screen shows who the imposter was and what the word was above the leaderboard

### 13. Bug fix: next-round race condition
- Host could click "Next Round" during the 3s delay after correct imposter guess
- Fixed: `next-round` handler guarded with `room.state === 'gameover'` check

### 14. Feature: Imposter mid-clue win
- During clue phase, if the imposter submits the exact secret word as their clue:
  - +200 pts to imposter
  - Round ends immediately (no vote)
  - `imposter-self-revealed` event emitted: `{ imposterId, imposterName, word, players }`
  - Toast shown to all players
  - Clue input disabled
  - After 3s: next round starts or game-over if last round

---

## Game Rules (for reference)
- 3–10 players per room
- Most players see secret word; 1 imposter (2 if 7+ players) sees nothing + gets hint
- Imposter gets series context for anime characters (no AI hint needed)
- Players take turns giving one vague clue
- After all clues, everyone votes on who the imposter is
- **Imposter caught** → innocents +100pts each
- **Imposter escapes** (no majority) → imposter +200pts
- **Imposter caught + guesses word correctly** → +150pts bonus, game ends immediately
- **Imposter says word as clue** → +200pts, round ends immediately without vote
- Host sets 1–10 rounds; scores accumulate

## Key Socket Events
See `CLAUDE.md` for full event reference.

## What's Still NOT Built
- Timer per clue
- Mobile layout (panels hidden on <820px, no replacement UI)
- Reconnection handling
- Sound effects
- Spectator mode
- SVG icons (currently using emojis)
