# Fix Gemini Hint Word — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gemini-powered imposter hint word actually work reliably by fixing the model name, adding error visibility, and verifying the fix.

**Architecture:** Three targeted changes to `server.js`: update the model to `gemini-2.0-flash`, add `console.error` logging in the catch block so Railway logs expose failures, and add a `/api/hint-test` HTTP endpoint so the API key + model can be verified independently of a live game.

**Tech Stack:** Node.js, Google Gemini REST API (`generativelanguage.googleapis.com`)

---

### Task 1: Add error logging and update model name

**Files:**
- Modify: `server.js:8-34`

- [ ] **Step 1: Replace `getHintWord` with the fixed version**

Replace the entire `getHintWord` function (lines 8–34) with:

```js
async function getHintWord(word) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { console.warn('[hint] GEMINI_API_KEY not set — skipping hint'); return null; }

  // Try models in order of preference; newer models are listed first
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text:
              `You are helping run a social deduction party game. The secret word this round is "${word}". ` +
              `Give the imposter player ONE hint word or very short phrase (max 3 words) that is thematically related to "${word}" but different enough that they don't know the exact answer. ` +
              `The hint should help them give believable clues without giving the word away. ` +
              `Reply with ONLY the hint word or phrase, nothing else, no punctuation.`
            }] }],
            generationConfig: { maxOutputTokens: 20, temperature: 0.7 },
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[hint] model ${model} returned ${res.status}: ${errText.slice(0, 200)}`);
        continue; // try next model
      }

      const data = await res.json();
      const hint = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (hint) { console.log(`[hint] "${word}" → "${hint}" (model: ${model})`); return hint; }
      console.warn(`[hint] model ${model} returned empty hint for "${word}"`);
    } catch (err) {
      console.error(`[hint] fetch error for model ${model}:`, err.message);
    }
  }

  console.warn(`[hint] all models failed for "${word}" — no hint this round`);
  return null;
}
```

- [ ] **Step 2: Verify server still starts**

```bash
cd /Users/jashanshah/Downloads/imposter-game
node -e "
const { createServer } = require('http');
// just load the file, don't listen
" 2>&1 || node --check server.js && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/jashanshah/Downloads/imposter-game
git add server.js
git commit -m "fix: update Gemini model to 2.0-flash, add error logging with model fallback chain"
```

---

### Task 2: Add `/api/hint-test` debug endpoint

**Files:**
- Modify: `server.js` — add one route after `app.use(express.static(...))`

- [ ] **Step 1: Add the test route**

Find this line in `server.js`:
```js
app.use(express.static(path.join(__dirname, 'public')));
```

Add immediately after it:

```js
app.get('/api/hint-test', async (req, res) => {
  const word = req.query.word || 'pizza';
  const hint = await getHintWord(word);
  res.json({ word, hint, keySet: !!process.env.GEMINI_API_KEY });
});
```

- [ ] **Step 2: Test locally**

Start the server (kill any existing server first):

```bash
cd /Users/jashanshah/Downloads/imposter-game
pkill -f "node server.js" 2>/dev/null; sleep 1
GEMINI_API_KEY="your-key-here" node server.js &
sleep 2
curl "http://localhost:3000/api/hint-test?word=pizza"
```

Expected output (something like):
```json
{"word":"pizza","hint":"pasta","keySet":true}
```

If `hint` is `null` and `keySet` is `true`, check Railway logs — the `[hint]` prefixed log lines will show exactly which model errored and why.

If `keySet` is `false`, the env var isn't reaching the process.

- [ ] **Step 3: Commit and push**

```bash
cd /Users/jashanshah/Downloads/imposter-game
git add server.js
git commit -m "feat: add /api/hint-test debug endpoint for verifying Gemini API key"
git push
```

---

### Task 3: Verify on Railway

- [ ] **Step 1: Wait for Railway redeploy (~60s), then hit the test endpoint**

```bash
curl "https://imposter-game-production-395b.up.railway.app/api/hint-test?word=elephant"
```

Expected: `{"word":"elephant","hint":"<something>","keySet":true}`

If `hint` is `null`: open Railway dashboard → your service → **Logs** tab. Search for `[hint]` — the log lines will show the exact HTTP status or error from Gemini.

- [ ] **Step 2: Start a real game and confirm hint appears**

Start a game with 3+ players. The imposter should see a hint word card on the reveal screen and in their word-reminder box during clue giving.

- [ ] **Step 3: If hint still null — check Railway logs for the specific error**

Common failures and fixes:
- `403` → API key is invalid or wrong project; regenerate at aistudio.google.com
- `404` → model name not found; Railway logs will show which model was tried
- `429` → rate limit hit (unlikely on free tier for a party game)
- `keySet: false` → env var name typo in Railway — must be exactly `GEMINI_API_KEY`
