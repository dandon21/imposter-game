# Imposter Correct Guess Ends Game — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the caught imposter correctly guesses the secret word, the game ends immediately instead of waiting for the host to advance rounds.

**Architecture:** Server-side change only for the core logic — when `imposter-guess` resolves correctly, award points, emit `imposter-guessed` as today, then after a 3-second delay emit `game-over`. Client receives `game-over` naturally via the existing handler. One small client-side addition: show a "Game ending…" toast on correct guess so players aren't surprised by the transition.

**Tech Stack:** Node.js + Socket.io (server), vanilla JS (client)

---

### Task 1: End game on server when imposter guesses correctly

**Files:**
- Modify: `server.js:225-235`

- [ ] **Step 1: Update the `imposter-guess` handler**

Replace the existing handler (lines 225–235) with:

```js
socket.on('imposter-guess', ({ guess }) => {
  const room = getRoom(socket.roomCode);
  if (!room || room.state !== 'results' || !room.imposters.includes(socket.id) || room.guessUsed) return;
  room.guessUsed = true;
  const correct = guess.trim().toLowerCase() === room.word.toLowerCase();
  if (correct) {
    const p = room.players.find(p => p.id === socket.id);
    if (p) p.score += 150;
  }
  io.to(room.code).emit('imposter-guessed', { correct, guess, word: room.word, guesser: socket.id, players: sanitizePlayers(room.players) });

  if (correct) {
    room.state = 'gameover';
    setTimeout(() => {
      io.to(room.code).emit('game-over', {
        players: [...room.players].sort((a, b) => b.score - a.score).map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
      });
    }, 3000);
  }
});
```

- [ ] **Step 2: Verify the server still starts cleanly**

```bash
cd /Users/jashanshah/Downloads/imposter-game && node server.js
```
Expected output:
```
🕵️  IMPOSTER GAME SERVER RUNNING
  Local:   http://localhost:3000
```
Kill with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
cd /Users/jashanshah/Downloads/imposter-game
git add server.js
git commit -m "feat: end game immediately when imposter guesses the word correctly"
```

---

### Task 2: Notify clients the game is ending

**Files:**
- Modify: `public/index.html` — `imposter-guessed` socket handler (~line 939)

- [ ] **Step 1: Add "game ending" toast on correct guess**

In the `imposter-guessed` handler, after the `if (correct) { ... }` block that updates the score display, add:

```js
if (correct) {
  const ptEl = document.getElementById('pts-' + guesser);
  const pData = players.find(p => p.id === guesser);
  if (ptEl && pData) ptEl.textContent = pData.score;
  toast('🏆 Imposter guessed it — game over!', 's');
}
```

The full updated handler should look like:

```js
socket.on('imposter-guessed', ({ correct, guess, word, guesser, players: up }) => {
  players = up;
  const p = players.find(p => p.id === guesser);
  const r = document.createElement('div');
  r.className = `guess-result ${correct ? 'ok' : 'no'}`;
  r.textContent = correct
    ? `✅ ${p?.name} guessed correctly: "${word}" — +150 pts!`
    : `❌ ${p?.name} guessed wrong: "${guess}"`;

  const gb = document.getElementById('guess-box');
  if (gb) gb.replaceWith(r);

  if (correct) {
    const ptEl = document.getElementById('pts-' + guesser);
    const pData = players.find(p => p.id === guesser);
    if (ptEl && pData) ptEl.textContent = pData.score;
    toast('🏆 Imposter guessed it — game over!', 's');
  }
});
```

- [ ] **Step 2: Manually verify the flow**

1. Run `node server.js` in `/Users/jashanshah/Downloads/imposter-game`
2. Open two browser tabs at `http://localhost:3000`
3. Create a room in tab 1, join with tab 2, start game
4. Play through to results with tab 1 as the caught imposter
5. Enter the correct word in the guess box
6. Verify: toast appears, score updates, and after ~3 seconds the game-over podium screen appears on both tabs

- [ ] **Step 3: Commit**

```bash
cd /Users/jashanshah/Downloads/imposter-game
git add public/index.html
git commit -m "feat: toast players when imposter correct guess triggers game over"
```

---

### Task 3: Deploy to Railway

- [ ] **Step 1: Push to GitHub**

```bash
cd /Users/jashanshah/Downloads/imposter-game
git push
```

- [ ] **Step 2: Confirm Railway redeploys**

Railway auto-deploys on every push to `main`. Visit `https://imposter-game-production-395b.up.railway.app` — within ~60 seconds the new behaviour will be live.
