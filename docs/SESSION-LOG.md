# Imposter Game — Session Log

## Project Overview
Multiplayer social deduction game (like skribbl.io meets Among Us).
- **Stack:** Node.js + Express + Socket.io (backend), vanilla HTML/CSS/JS (frontend)
- **Live URL:** https://imposter-game-production-395b.up.railway.app
- **GitHub:** https://github.com/dandon21/imposter-game
- **Local path:** `/Users/jashanshah/Downloads/imposter-game/`
- **Railway service:** auto-deploys on every `git push` to `main`

---

## What Was Built This Session

### 1. UI/UX Fixes (accessibility pass)
Applied the `anthropic-skills:ui-ux-pro-max` skill. Changes to `public/index.html`:
- Added global `prefers-reduced-motion` CSS override
- Added `touch-action: manipulation` to all interactive elements
- Bumped `.rnd-btn` from 34×34 to 44×44px (touch target minimum)
- Added `.btn-icon` min 44×44px
- Added `focus-visible` rings on all interactive elements
- Added `aria-label` to copy-code, copy-link, and kick buttons
- Added `<label for>` associations on all form inputs
- Added `autocomplete="name"` on name input
- Added `role="alert"` + `aria-live` on error paragraph and toast container
- Made vote cards keyboard-navigable (`role="button"`, `tabindex`, keydown handler)
- Added confirmation dialog before Leave button (`location.reload()`)
- Added `.visually-hidden` utility CSS class

### 2. Deployment to Railway
- Organised loose files in Downloads into `imposter-game/` folder with `public/` subfolder
- Ran `npm install`, confirmed server starts on port 3000
- Re-authenticated GitHub CLI (`gh auth login`) — account: `dandon21`
- Created GitHub repo: `https://github.com/dandon21/imposter-game`
- Deployed to Railway → permanent URL: `https://imposter-game-production-395b.up.railway.app`

### 3. Feature: Imposter correct guess ends game immediately
**Files changed:** `server.js`, `public/index.html`

In `server.js`, `imposter-guess` handler — after correct guess:
```js
if (correct) {
  room.state = 'gameover';
  setTimeout(() => {
    io.to(room.code).emit('game-over', {
      players: [...room.players].sort((a, b) => b.score - a.score)
        .map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
    });
  }, 3000);
}
```

In `public/index.html`, `imposter-guessed` handler — added toast:
```js
if (correct) {
  // ... existing score update ...
  toast('🏆 Imposter guessed it — game over!', 's');
}
```

Note: Case-insensitive comparison was already in place:
```js
const correct = guess.trim().toLowerCase() === room.word.toLowerCase();
```

### 4. Full Visual Redesign (glassmorphism dark UI)
**Files changed:** `public/index.html`

- **Font:** Nunito → Inter (kept Fredoka One for headings/logo)
- **Background:** `#07070f` (deeper near-black)
- **Cards:** `rgba(255,255,255,0.04)` + `backdrop-filter: blur(20px)` glass effect
- **Accent:** `#7c3aed` (richer violet, was `#7c5cbf`)
- **Accent bright:** `#a78bfa`
- **Buttons:** richer gradient + glow shadow + spring-physics hover + scale press
- **Inputs:** glass-tinted with glowing focus ring
- **Landing page:** ambient gradient blobs via CSS `::before` pseudo-element
- **Lobby + game panels:** semi-transparent with blur borders
- **Vote cards:** glass with violet glow on hover, red glow on selected
- **Toasts:** blurred glass with spring entrance animation
- **Added radius tokens:** `--radius-sm/md/lg/xl`

**Bug fix after redesign:**
- Logo wrapper `<div>` needed `width: 100%` so `text-align: center` worked (flex column with `align-items: center` shrinks items to content-width otherwise)
- Tagline `margin-top` reduced from `-14px` to `-6px` (logo grew from 56px → 62px)

### 5. Feature: Gemini AI hint word for imposter
**Files changed:** `server.js`, `public/index.html`

**How it works:**
- When a round starts, server calls Gemini API with the secret word
- Gemini returns one related-but-different hint word
- Only sent to the imposter in their `game-start` payload
- Shown on the reveal screen AND persisted in the clue-giving screen

**Server — `getHintWord` function (top of server.js):**
```js
async function getHintWord(word) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `...prompt...` }] }],
          generationConfig: { maxOutputTokens: 20, temperature: 0.7 } }) }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch { return null; }
}
```

**`startRound` made async:**
```js
async function startRound(room) {
  // ... setup ...
  const hintWord = await getHintWord(room.word);
  room.players.forEach(p => {
    const isImposter = room.imposters.includes(p.id);
    io.to(p.id).emit('game-start', {
      word: isImposter ? null : room.word,
      isImposter,
      hintWord: isImposter ? (hintWord || null) : null,
      // ...
    });
  });
}
```

**Client — state variable added:**
```js
let myHintWord = null;
// set in game-start handler:
myHintWord = hintWord || null;
```

**Client — hint shown in word-reminder during clue phase:**
```js
const wordBlock = myRole === 'innocent'
  ? `<div class="word-reminder">...</div>`
  : `<div class="word-reminder">
       <div class="wr-imp">🕵️ You're the imposter — you don't know the word!</div>
       ${myHintWord ? `<div style="..."><div class="wr-label">Your hint</div>
         <div class="wr-val" style="color:var(--accent-bright);">${esc(myHintWord)}</div></div>` : ''}
     </div>`;
```

**Railway env var:** `GEMINI_API_KEY` — set in Railway dashboard → Variables tab ✓

**CSS for hint block on reveal screen (`.imp-hint`):**
```css
.imp-hint { margin-top: 16px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: var(--radius-md); padding: 12px 16px; text-align: center; }
.imp-hint-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--text-muted); margin-bottom: 6px; }
.imp-hint-word { font-family: 'Fredoka One', cursive; font-size: 26px; color: var(--accent-bright); }
.imp-hint-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
```

---

## Outstanding Work

### Fix: Gemini hint not working
**Plan saved at:** `docs/superpowers/plans/2026-06-04-fix-gemini-hint.md`

**Root causes identified:**
1. `gemini-1.5-flash` model may be deprecated by mid-2026
2. `catch {}` silently swallows all errors — no Railway logs
3. No way to test API in isolation

**Fix plan (not yet executed):**
- Update `getHintWord` to try `gemini-2.0-flash` → `gemini-1.5-flash` → `gemini-pro` in sequence
- Add `console.error/warn` logging with `[hint]` prefix
- Add `/api/hint-test?word=pizza` HTTP endpoint for live debugging
- Verify via `curl https://imposter-game-production-395b.up.railway.app/api/hint-test?word=elephant`

---

## Game Rules (for reference)
- 3–10 players per room
- Most players see secret word; 1 imposter (2 if 7+ players) sees nothing + gets hint word
- Players take turns giving one vague clue
- After all clues, everyone votes on who the imposter is
- **Imposter caught** → innocents +100pts each
- **Imposter escapes** (no majority) → imposter +200pts
- **Imposter caught + guesses word correctly** → +150pts bonus, **game ends immediately**
- Host sets 1–10 rounds; scores accumulate

## Key Socket Events
See `CLAUDE.md` in the project root for full event reference.

## What's Still NOT Built
- Timer per clue
- Mobile layout (panels hidden on <820px, no replacement UI)
- Reconnection handling
- Sound effects
- Spectator mode
- SVG icons (currently using emojis — flagged as highest-priority anti-pattern by UI/UX skill)
