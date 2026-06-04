const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

// ===== HINT WORD =====
async function getHintWord(word, context = null) {
  const key = process.env.GROQ_API_KEY;
  if (!key) { console.warn('[hint] GROQ_API_KEY not set — skipping hint'); return null; }
  const wordDesc = context ? `"${word}" (${context})` : `"${word}"`;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content:
          `You are running a social deduction party game. The secret word is ${wordDesc}.\n` +
          `Give the imposter ONE hint — a word or short phrase (max 3 words) that is in the same broad CATEGORY as ${wordDesc}, ` +
          `but NOT a synonym, body part, direct attribute, or obvious first-association of "${word}".\n` +
          `NEVER give: other character names, show/movie/game titles, the word itself, or anything that directly names the source material.\n` +
          `Instead give: thematic elements, settings, emotions, roles, or concepts associated with the category.\n` +
          `Target ~5/10 similarity: recognisably related to the same theme, but someone hearing only the hint could not immediately guess "${word}".\n` +
          `Bad hints for "elephant": trunk, tusk, large, mammoth, grey.\n` +
          `Good hints for "elephant": safari, wildlife reserve, savanna.\n` +
          `Bad hints for "Levi (Attack on Titan character)": Eren, Mikasa, Attack on Titan, Survey Corps.\n` +
          `Good hints for "Levi (Attack on Titan character)": underground city, soldier, titan hunter.\n` +
          `Reply with ONLY the hint word or phrase. No punctuation, no explanation.`
        }],
        max_tokens: 20,
        temperature: 0.8,
      }),
    });
    if (!res.ok) { console.warn(`[hint] Groq returned ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
    const data = await res.json();
    const hint = data?.choices?.[0]?.message?.content?.trim();
    if (hint) { console.log(`[hint] "${word}" → "${hint}"`); return hint; }
    return null;
  } catch (err) {
    console.error('[hint] fetch error:', err.message);
    return null;
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/hint-test', async (req, res) => {
  const word = req.query.word || 'pizza';
  const key = process.env.GROQ_API_KEY;
  let error = null;
  let hint = null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: `Say one word related to "${word}". Reply with ONLY that word.` }], max_tokens: 20 }),
    });
    const body = await r.text();
    if (r.ok) hint = JSON.parse(body)?.choices?.[0]?.message?.content?.trim() || null;
    else error = `HTTP ${r.status}: ${body.slice(0, 400)}`;
  } catch (err) { error = err.message; }
  res.json({ word, hint, keySet: !!key, error });
});

// ===== WORD LISTS =====
const DEFAULT_WORDS = {
  Animals:  ['elephant','penguin','dolphin','tiger','giraffe','octopus','flamingo','cheetah','koala','platypus','narwhal','axolotl'],
  Food:     ['pizza','sushi','tacos','ramen','croissant','mango','spaghetti','dumpling','churros','bibimbap','poutine','baklava'],
  Places:   ['beach','library','airport','volcano','lighthouse','stadium','castle','subway','monastery','aquarium','glacier','bazaar'],
  Objects:  ['umbrella','telescope','piano','compass','lantern','typewriter','parachute','hourglass','kaleidoscope','abacus','periscope','sundial'],
  Movies:   ['Titanic','Inception','Avatar','Frozen','Matrix','Interstellar','Shrek','Parasite','Dune','Clueless','Spirited Away','Arrival'],
  Sports:   ['basketball','volleyball','archery','fencing','surfing','gymnastics','cricket','polo','bobsled','lacrosse','curling','sumo'],
  Jobs:     ['astronaut','surgeon','archaeologist','sommelier','actuary','taxidermist','puppeteer','cartographer','glassblower','falconer'],
};

const COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#52BE80'];

const rooms = {};

// ===== HELPERS =====
function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function getRoom(code) { return rooms[code?.toUpperCase()]; }

function pickWord(room) {
  const pool = [...room.customWords];
  room.selectedCategories.forEach(cat => { if (DEFAULT_WORDS[cat]) pool.push(...DEFAULT_WORDS[cat]); });
  if (!pool.length) pool.push(...Object.values(DEFAULT_WORDS).flat());
  // Avoid repeating last word
  const filtered = pool.filter(w => w !== room.lastWord);
  const src = filtered.length ? filtered : pool;
  return src[Math.floor(Math.random() * src.length)];
}

function assignRoles(room) {
  const n = room.players.length >= 7 ? 2 : 1;
  const shuffled = [...room.players].sort(() => Math.random() - 0.5);
  const imposterIds = new Set(shuffled.slice(0, n).map(p => p.id));
  room.players.forEach(p => { p.role = imposterIds.has(p.id) ? 'imposter' : 'innocent'; });
  return [...imposterIds];
}

async function startRound(room) {
  room.state = 'playing';
  room.word = pickWord(room);
  room.lastWord = room.word;
  room.clues = [];
  room.votes = {};
  room.clueOrder = [...room.players].sort(() => Math.random() - 0.5).map(p => p.id);
  room.currentClueIndex = 0;
  room.imposters = assignRoles(room);
  room.guessUsed = false;

  const wordContext = room.customWordContexts?.[room.word.toLowerCase()] || null;
  const hintWord = await getHintWord(room.word, wordContext);

  room.players.forEach(p => {
    const isImposter = room.imposters.includes(p.id);
    io.to(p.id).emit('game-start', {
      word: isImposter ? null : room.word,
      isImposter,
      hintWord: isImposter ? (hintWord || null) : null,
      clueOrder: room.clueOrder,
      players: sanitizePlayers(room.players),
      round: room.currentRound,
      totalRounds: room.rounds,
    });
  });

  // Give players time to read their role before clues start
  setTimeout(() => {
    io.to(room.code).emit('clue-turn', {
      playerId: room.clueOrder[0],
      index: 0,
      total: room.clueOrder.length,
    });
  }, 5000);
}

function resolveVoting(room) {
  const counts = {};
  room.players.forEach(p => (counts[p.id] = 0));
  Object.values(room.votes).forEach(id => { if (counts[id] !== undefined) counts[id]++; });

  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter(id => counts[id] === max);
  const imposterCaught = top.length === 1 && room.imposters.includes(top[0]);

  if (imposterCaught) {
    room.players.filter(p => !room.imposters.includes(p.id)).forEach(p => { p.score += 100; });
  } else {
    room.imposters.forEach(id => {
      const p = room.players.find(p => p.id === id);
      if (p) p.score += 200;
    });
  }

  room.state = 'results';
  io.to(room.code).emit('results', {
    word: room.word,
    imposters: room.imposters,
    imposterNames: room.players.filter(p => room.imposters.includes(p.id)).map(p => p.name),
    imposterCaught,
    voteCounts: counts,
    votes: room.votes,
    players: sanitizePlayers(room.players, true),
    round: room.currentRound,
    totalRounds: room.rounds,
    isLastRound: room.currentRound >= room.rounds,
  });
}

function sanitizePlayers(players, includeRole = false) {
  return players.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    score: p.score,
    ...(includeRole ? { role: p.role } : {}),
  }));
}

// ===== SOCKET.IO =====
io.on('connection', socket => {
  socket.on('create-room', ({ name }, cb) => {
    let code;
    do { code = genCode(); } while (rooms[code]);

    rooms[code] = {
      code, host: socket.id,
      players: [], customWords: [], customWordContexts: {},
      selectedCategories: Object.keys(DEFAULT_WORDS),
      state: 'lobby', word: null, lastWord: null,
      imposters: [], clues: [], votes: {},
      clueOrder: [], currentClueIndex: 0,
      rounds: 3, currentRound: 1, guessUsed: false,
    };

    const player = { id: socket.id, name: name.slice(0, 20).trim(), color: COLORS[0], score: 0, role: null };
    rooms[code].players.push(player);
    socket.join(code);
    socket.roomCode = code;
    cb({ success: true, code, player, room: { ...rooms[code], players: sanitizePlayers(rooms[code].players) } });
  });

  socket.on('join-room', ({ name, code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ success: false, error: 'Room not found! Check the code.' });
    if (room.state !== 'lobby') return cb({ success: false, error: 'Game already in progress!' });
    if (room.players.length >= 10) return cb({ success: false, error: 'Room is full (max 10 players).' });

    const color = COLORS[room.players.length % COLORS.length];
    const player = { id: socket.id, name: name.slice(0, 20).trim(), color, score: 0, role: null };
    room.players.push(player);
    socket.join(room.code);
    socket.roomCode = room.code;
    cb({ success: true, code: room.code, player, room: { ...room, players: sanitizePlayers(room.players) } });
    socket.to(room.code).emit('player-joined', { player, players: sanitizePlayers(room.players) });
  });

  socket.on('update-settings', ({ customWords, selectedCategories, rounds }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    if (Array.isArray(customWords)) {
      const parsed = customWords.slice(0, 60).map(w => w.trim()).filter(Boolean).map(raw => {
        const m = raw.match(/^(.+?)\s*\[(.+?)\]\s*$/);
        return m ? { word: m[1].trim(), context: m[2].trim(), raw } : { word: raw, context: null, raw };
      });
      room.customWords = parsed.map(p => p.word);
      room.customWordContexts = Object.fromEntries(parsed.filter(p => p.context).map(p => [p.word.toLowerCase(), p.context]));
    }
    if (Array.isArray(selectedCategories)) room.selectedCategories = selectedCategories;
    if (typeof rounds === 'number') room.rounds = Math.max(1, Math.min(10, rounds));
    io.to(room.code).emit('settings-updated', { customWords: room.customWords, selectedCategories: room.selectedCategories, rounds: room.rounds });
  });

  socket.on('start-game', () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 3) return io.to(socket.id).emit('error-msg', 'Need at least 3 players!');
    room.currentRound = 1;
    room.players.forEach(p => { p.score = 0; });
    startRound(room);
  });

  socket.on('submit-clue', ({ clue }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    if (room.clueOrder[room.currentClueIndex] !== socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    const entry = { playerId: socket.id, playerName: player.name, playerColor: player.color, clue: clue.trim().slice(0, 60) };
    room.clues.push(entry);
    room.currentClueIndex++;

    io.to(room.code).emit('clue-submitted', { entry, index: room.currentClueIndex - 1 });

    if (room.currentClueIndex >= room.clueOrder.length) {
      room.state = 'voting';
      setTimeout(() => {
        io.to(room.code).emit('voting-start', {
          players: sanitizePlayers(room.players),
          clues: room.clues,
        });
      }, 1500);
    } else {
      io.to(room.code).emit('clue-turn', {
        playerId: room.clueOrder[room.currentClueIndex],
        index: room.currentClueIndex,
        total: room.clueOrder.length,
      });
    }
  });

  socket.on('vote', ({ targetId }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.state !== 'voting' || room.votes[socket.id]) return;
    room.votes[socket.id] = targetId;
    io.to(room.code).emit('vote-update', { voterId: socket.id, count: Object.keys(room.votes).length, total: room.players.length });
    if (Object.keys(room.votes).length >= room.players.length) resolveVoting(room);
  });

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

  socket.on('next-round', () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    room.currentRound++;
    if (room.currentRound > room.rounds) {
      room.state = 'gameover';
      io.to(room.code).emit('game-over', { players: [...room.players].sort((a, b) => b.score - a.score).map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })) });
    } else {
      startRound(room);
    }
  });

  socket.on('back-to-lobby', () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    room.state = 'lobby';
    room.currentRound = 1;
    room.players.forEach(p => { p.score = 0; p.role = null; });
    io.to(room.code).emit('lobby-return', { room: { ...room, players: sanitizePlayers(room.players) } });
  });

  socket.on('kick-player', ({ targetId }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.players = room.players.filter(p => p.id !== targetId);
    io.to(targetId).emit('kicked');
    io.to(room.code).emit('player-left', { playerId: targetId, newHost: room.host, players: sanitizePlayers(room.players) });
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.roomCode);
    if (!room) return;
    const left = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) { delete rooms[socket.roomCode]; return; }
    if (room.host === socket.id) room.host = room.players[0].id;

    io.to(room.code).emit('player-left', { playerId: socket.id, leftName: left?.name, newHost: room.host, players: sanitizePlayers(room.players) });

    if (room.state === 'playing') {
      room.clueOrder = room.clueOrder.filter(id => id !== socket.id);
      if (room.currentClueIndex >= room.clueOrder.length) {
        if (room.clueOrder.length === 0) return;
        room.state = 'voting';
        io.to(room.code).emit('voting-start', { players: sanitizePlayers(room.players), clues: room.clues });
      } else {
        io.to(room.code).emit('clue-turn', { playerId: room.clueOrder[room.currentClueIndex], index: room.currentClueIndex, total: room.clueOrder.length });
      }
    } else if (room.state === 'voting') {
      delete room.votes[socket.id];
      if (room.players.length > 0 && Object.keys(room.votes).length >= room.players.length) resolveVoting(room);
    }
  });
});

// ===== SERVER START =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
    }
  }
  console.log(`\n🕵️  IMPOSTER GAME SERVER RUNNING`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log(`\n  Share the Network URL with others on the same WiFi!`);
  console.log(`  For internet play, use: npx ngrok http ${PORT}\n`);
});
