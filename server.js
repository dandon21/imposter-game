const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

// ── Fuzzy match helper (Levenshtein, ≥80% similarity = correct) ────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function isFuzzyMatch(guess, word) {
  const g = guess.trim().toLowerCase();
  const w = word.trim().toLowerCase();
  if (g === w) return true;
  const maxLen = Math.max(g.length, w.length);
  if (maxLen === 0) return true;
  const similarity = 1 - levenshtein(g, w) / maxLen;
  return similarity >= 0.80;
}
// ───────────────────────────────────────────────────────────────────────────

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
  Anime: [
    'Luffy','Zoro','Nami','Sanji','Usopp','Robin','Ace','Shanks','Whitebeard','Mihawk','Crocodile','Jinbe',
    'Dio','Jotaro','Joseph','Giorno','Josuke','Jolyne','Jonathan','Gyro','Johnny',
    'Gon','Killua','Kurapika','Leorio','Hisoka','Meruem','Chrollo','Neferpitou',
    'Anya','Loid','Yor','Damian','Bond',
    'Gojo','Yuji','Megumi','Nobara','Sukuna','Nanami','Yuta','Toge',
    'Denji','Makima','Power','Aki','Reze','Quanxi','Beam',
    'Tanjiro','Nezuko','Zenitsu','Inosuke','Rengoku','Shinobu','Giyu','Muzan','Akaza','Tengen',
    'Hachiman','Yukino','Yui','Iroha','Hayama',
    'Aqua','Ruby','Ai','Kana','Akane','Mem-cho',
    'Takopi','Shizuka','Marina',
    'Ayanokoji','Horikita','Kushida','Kei','Ryuen',
    'Naruto','Sasuke','Sakura','Kakashi','Itachi','Minato','Jiraiya','Tsunade','Madara','Obito','Pain','Gaara',
    'Ichigo','Rukia','Orihime','Aizen','Byakuya','Toshiro','Grimmjow','Ulquiorra','Uryu','Yoruichi',
    'Goku','Vegeta','Gohan','Piccolo','Frieza','Cell','Beerus','Broly','Trunks','Krillin',
    'Pikachu','Charizard','Mewtwo','Eevee','Gengar','Snorlax','Lucario','Greninja','Garchomp','Arcanine',
    'David','Lucy','Rebecca','Maine','Dorio','Kiwi',
    'Mob','Reigen','Dimple','Teru','Ritsu',
    'Okarun','Momo','Turbo Granny','Aira',
    'Koro-sensei','Nagisa','Karma','Kayano','Irina',
    'Yumeko','Mary','Kirari','Midari',
    'Makoto','Kyoko','Monokuma','Nagito','Hajime','Chiaki',
    'Kaoru','Rintaro',
    'Mahiru','Amane',
    'Hori','Miyamura','Remi','Tooru',
    'Tohru','Kyo','Yuki','Shigure','Akito','Momiji',
    'Tsukasa','Nasa',
    'Shinra','Arthur','Maki','Tamaki','Benimaru','Burns',
    'Gabimaru','Sagiri','Yuzuriha','Tenza','Nurugai','Gantetsusai',
    'Hinata','Kageyama','Tsukishima','Daichi','Kuroo','Bokuto','Ushijima','Oikawa',
    'Isagi','Bachira','Rin','Nagi','Chigiri','Barou','Kaiser',
    '2B','9S','A2','Emil',
    'Shin','Lena','Raiden','Frederica','Anju',
    'Light','L','Misa','Ryuk','Near','Mello',
    'Edward','Alphonse','Roy','Riza','Winry','Envy','Greed','Lust','Hohenheim','Scar',
    'Saitama','Genos','Tatsumaki','Fubuki','Garou','Bang','King','Boros','Sonic',
    // Dragon Ball additions
    'Whis','Jiren',
    // Bleach additions
    'Kenpachi',
    // Haikyuu additions
    'Nishinoya',
    // Fire Force additions
    'Obi',
    // 86 additions
    'Theoto',
    // Attack on Titan
    'Eren','Mikasa','Armin','Levi','Erwin',
    // My Hero Academia
    'Midoriya','Bakugo','Todoroki','All Might','Uraraka',
    // Tokyo Ghoul
    'Kaneki','Touka','Arima','Rize',
    // Black Clover
    'Asta','Yuno','Noelle','Yami',
    // Fairy Tail
    'Natsu','Lucy Heartfilia','Erza','Gray','Wendy',
    // Code Geass
    'Lelouch','C.C.','Suzaku','Kallen',
    // Steins;Gate
    'Okabe','Kurisu','Mayuri','Hashida',
    // Kuroko\'s Basketball
    'Kuroko','Kagami','Kise','Akashi',
    // Slam Dunk
    'Sakuragi','Rukawa','Akagi','Mitsui',
    // Prince of Tennis
    'Ryoma','Tezuka','Fuji','Atobe',
    // Yuri on Ice
    'Yuuri','Victor','Yurio',
    // Sword Art Online
    'Kirito','Asuna','Sinon','Klein','Leafa',
    // Re:Zero
    'Subaru','Emilia','Rem','Ram',
    // Overlord
    'Ainz','Albedo','Shalltear','Demiurge',
    // No Game No Life
    'Sora','Shiro','Stephanie',
    // KonoSuba
    'Kazuma','Megumin',
    // That Time I Got Reincarnated as a Slime
    'Rimuru','Shion','Milim',
    // Mushoku Tensei
    'Rudeus','Roxy','Eris','Sylphiette',
    // The Rising of the Shield Hero
    'Naofumi','Raphtalia','Filo','Malty',
    // Log Horizon
    'Shiroe','Naotsugu','Akatsuki',
    // The Eminence in Shadow
    'Cid','Alpha','Beta',
    // Cowboy Bebop
    'Spike','Jet','Faye','Edward Wong',
    // Samurai Champloo
    'Mugen','Jin','Fuu',
    // Trigun
    'Vash','Wolfwood','Knives',
    // Neon Genesis Evangelion
    'Shinji','Asuka','Rei','Misato','Kaworu',
    // Gurren Lagann
    'Simon','Kamina','Yoko','Nia',
    // Parasyte
    'Shinichi','Migi','Reiko',
    // Erased
    'Satoru','Kayo','Airi',
    // The Promised Neverland
    'Emma','Norman','Ray','Isabella',
    // Made in Abyss
    'Riko','Reg','Nanachi','Bondrewd',
    // Dr. Stone
    'Senku','Taiju',
    // Soul Eater
    'Maka','Soul','Death the Kid','Black Star',
    // Blue Exorcist
    'Yukio','Shiemi',
    // Noragami
    'Yato','Hiyori','Yukine',
    // Bungo Stray Dogs
    'Dazai','Atsushi','Akutagawa','Chuuya',
    // The Apothecary Diaries
    'Maomao','Jinshi','Gaoshun',
    // Frieren
    'Frieren','Fern','Stark','Himmel',
    // Delicious in Dungeon
    'Laios','Marcille','Senshi',
    // Kaiju No. 8
    'Kafka','Reno','Kikoru',
    // Solo Leveling
    'Jinwoo','Cha Hae-In','Beru',
    // Wind Breaker
    'Haruka','Kaji','Umemiya',
    // Mashle
    'Mash','Finn','Lance',
    // Blue Box
    'Taiki','Chinatsu','Hina',
    // Toradora
    'Ryuuji','Taiga','Minori','Kitamura',
    // Your Lie in April
    'Kousei','Kaori','Tsubaki','Watari',
    // Clannad
    'Tomoya','Nagisa Furukawa','Kyou','Tomoyo','Ushio','Akio',
    // Kaguya-sama
    'Kaguya','Shirogane','Chika','Ishigami',
    // Rascal Does Not Dream of Bunny Girl Senpai
    'Sakuta','Mai','Tomoe','Rio',
    // My Dress-Up Darling
    'Wakana','Marin','Sajuna','Shinju',
    // Komi Can\'t Communicate
    'Komi','Tadano','Najimi','Yamai',
    // Spirited Away
    'Chihiro','Haku','Yubaba','No-Face',
    // Princess Mononoke
    'Ashitaka','San','Lady Eboshi','Jigo',
    // Howl\'s Moving Castle
    'Howl','Sophie','Calcifer','Witch of the Waste',
    // My Neighbor Totoro
    'Satsuki','Mei','Totoro',
    // Kiki\'s Delivery Service
    'Kiki','Jiji','Tombo',
    // Akira
    'Kaneda','Tetsuo','Shikishima',
    // A Silent Voice
    'Shoya','Shoko','Ueno','Nagatsuka',
    // Your Name
    'Taki','Mitsuha','Teshigawara','Sayaka',
    // Weathering with You
    'Hodaka','Hina Amano',
    // Suzume
    'Suzume','Souta','Daijin',
    // Monster
    'Tenma','Johan','Nina','Lunge',
    // Hajime no Ippo
    'Ippo','Takamura','Miyata',
    // Initial D
    'Takumi','Keisuke','Ryousuke','Itsuki',
    // Food Wars
    'Soma','Erina','Megumi Tadokoro','Takumi Aldini',
    // Gintama
    'Gintoki','Shinpachi','Kagura','Katsura',
    // The Seven Deadly Sins
    'Meliodas','Elizabeth','Ban','Diane',
    // Black Lagoon
    'Revy','Rock','Dutch','Benny',
    // Violet Evergarden
    'Violet','Gilbert','Hodgins','Cattleya',
    // Inuyasha
    'Inuyasha','Kagome','Sesshomaru','Miroku','Sango',
    // Rurouni Kenshin
    'Kenshin','Sanosuke','Aoshi',
    // Yu Yu Hakusho
    'Yusuke','Kurama','Hiei','Kuwabara',
    // Berserk
    'Guts','Griffith','Casca','Skull Knight','Judeau',
    // The God of High School
    'Jin Mori','Daewi','Yoo Mira',
    // The Irregular at Magic High School
    'Tatsuya','Miyuki Shiba','Erika','Leo',
    // A Certain Magical Index
    'Touma','Index','Accelerator','Misaka',
    // Fate
    'Kiritsugu','Saber','Kirei','Iskandar','Shirou','Archer','Jeanne','Sieg','Astolfo','Karna','Ritsuka','Mash Kyrielight','Romani','Solomon',
    // Ranking of Kings
    'Bojji','Kage','Daida','Hiling',
    // Vinland Saga
    'Thorfinn','Askeladd','Canute','Thors',
  ],
};

const DEFAULT_WORD_CONTEXTS = {
  luffy:'One Piece character', zoro:'One Piece character', nami:'One Piece character',
  sanji:'One Piece character', usopp:'One Piece character', robin:'One Piece character',
  ace:'One Piece character', shanks:'One Piece character', whitebeard:'One Piece character',
  mihawk:'One Piece character', crocodile:'One Piece character', jinbe:'One Piece character',
  dio:"JoJo's Bizarre Adventure character", jotaro:"JoJo's Bizarre Adventure character",
  joseph:"JoJo's Bizarre Adventure character", giorno:"JoJo's Bizarre Adventure character",
  josuke:"JoJo's Bizarre Adventure character", jolyne:"JoJo's Bizarre Adventure character",
  jonathan:"JoJo's Bizarre Adventure character", gyro:"JoJo's Bizarre Adventure character",
  johnny:"JoJo's Bizarre Adventure character",
  gon:'Hunter x Hunter character', killua:'Hunter x Hunter character',
  kurapika:'Hunter x Hunter character', leorio:'Hunter x Hunter character',
  hisoka:'Hunter x Hunter character', meruem:'Hunter x Hunter character',
  chrollo:'Hunter x Hunter character', neferpitou:'Hunter x Hunter character',
  anya:'Spy x Family character', loid:'Spy x Family character', yor:'Spy x Family character',
  damian:'Spy x Family character', bond:'Spy x Family character',
  gojo:'Jujutsu Kaisen character', yuji:'Jujutsu Kaisen character',
  megumi:'Jujutsu Kaisen character', nobara:'Jujutsu Kaisen character',
  sukuna:'Jujutsu Kaisen character', nanami:'Jujutsu Kaisen character',
  yuta:'Jujutsu Kaisen character', toge:'Jujutsu Kaisen character',
  denji:'Chainsaw Man character', makima:'Chainsaw Man character', power:'Chainsaw Man character',
  aki:'Chainsaw Man character', reze:'Chainsaw Man character', quanxi:'Chainsaw Man character',
  beam:'Chainsaw Man character',
  tanjiro:'Demon Slayer character', nezuko:'Demon Slayer character', zenitsu:'Demon Slayer character',
  inosuke:'Demon Slayer character', rengoku:'Demon Slayer character', shinobu:'Demon Slayer character',
  giyu:'Demon Slayer character', muzan:'Demon Slayer character', akaza:'Demon Slayer character',
  tengen:'Demon Slayer character',
  hachiman:'Oregairu character', yukino:'Oregairu character', yui:'Oregairu character',
  iroha:'Oregairu character', hayama:'Oregairu character',
  aqua:'Oshi no Ko character', ruby:'Oshi no Ko character', ai:'Oshi no Ko character',
  kana:'Oshi no Ko character', akane:'Oshi no Ko character', 'mem-cho':'Oshi no Ko character',
  takopi:"Takopi's Original Sin character", shizuka:"Takopi's Original Sin character",
  marina:"Takopi's Original Sin character",
  ayanokoji:'Classroom of the Elite character', horikita:'Classroom of the Elite character',
  kushida:'Classroom of the Elite character', kei:'Classroom of the Elite character',
  ryuen:'Classroom of the Elite character',
  naruto:'Naruto character', sasuke:'Naruto character', sakura:'Naruto character',
  kakashi:'Naruto character', itachi:'Naruto character', minato:'Naruto character',
  jiraiya:'Naruto character', tsunade:'Naruto character', madara:'Naruto character',
  obito:'Naruto character', pain:'Naruto character', gaara:'Naruto character',
  ichigo:'Bleach character', rukia:'Bleach character', orihime:'Bleach character',
  aizen:'Bleach character', byakuya:'Bleach character', toshiro:'Bleach character',
  grimmjow:'Bleach character', ulquiorra:'Bleach character', uryu:'Bleach character',
  yoruichi:'Bleach character',
  goku:'Dragon Ball character', vegeta:'Dragon Ball character', gohan:'Dragon Ball character',
  piccolo:'Dragon Ball character', frieza:'Dragon Ball character', cell:'Dragon Ball character',
  beerus:'Dragon Ball character', broly:'Dragon Ball character', trunks:'Dragon Ball character',
  krillin:'Dragon Ball character',
  pikachu:'Pokemon character', charizard:'Pokemon character', mewtwo:'Pokemon character',
  eevee:'Pokemon character', gengar:'Pokemon character', snorlax:'Pokemon character',
  lucario:'Pokemon character', greninja:'Pokemon character', garchomp:'Pokemon character',
  arcanine:'Pokemon character',
  david:'Cyberpunk Edgerunners character', lucy:'Cyberpunk Edgerunners character',
  rebecca:'Cyberpunk Edgerunners character', maine:'Cyberpunk Edgerunners character',
  dorio:'Cyberpunk Edgerunners character', kiwi:'Cyberpunk Edgerunners character',
  mob:'Mob Psycho 100 character', reigen:'Mob Psycho 100 character', dimple:'Mob Psycho 100 character',
  teru:'Mob Psycho 100 character', ritsu:'Mob Psycho 100 character',
  okarun:'Dandadan character', momo:'Dandadan character',
  'turbo granny':'Dandadan character', aira:'Dandadan character',
  'koro-sensei':'Assassination Classroom character', nagisa:'Assassination Classroom character',
  karma:'Assassination Classroom character', kayano:'Assassination Classroom character',
  irina:'Assassination Classroom character',
  yumeko:'Kakegurui character', mary:'Kakegurui character', kirari:'Kakegurui character',
  midari:'Kakegurui character',
  makoto:'Danganronpa character', kyoko:'Danganronpa character', monokuma:'Danganronpa character',
  nagito:'Danganronpa character', hajime:'Danganronpa character', chiaki:'Danganronpa character',
  kaoru:'Kaoru Hana wa Rin to Saku character', rintaro:'Kaoru Hana wa Rin to Saku character',
  mahiru:'Otonari no Tenshi character', amane:'Otonari no Tenshi character',
  hori:'Horimiya character', miyamura:'Horimiya character', remi:'Horimiya character',
  tooru:'Horimiya character',
  tohru:'Fruits Basket character', kyo:'Fruits Basket character', yuki:'Fruits Basket character',
  shigure:'Fruits Basket character', akito:'Fruits Basket character', momiji:'Fruits Basket character',
  tsukasa:'Tonikawa character', nasa:'Tonikawa character',
  shinra:'Fire Force character', arthur:'Fire Force character', maki:'Fire Force character',
  tamaki:'Fire Force character', benimaru:'Fire Force character', burns:'Fire Force character',
  gabimaru:"Hell's Paradise character", sagiri:"Hell's Paradise character",
  yuzuriha:"Hell's Paradise character", tenza:"Hell's Paradise character",
  nurugai:"Hell's Paradise character", gantetsusai:"Hell's Paradise character",
  hinata:'Haikyuu character', kageyama:'Haikyuu character', tsukishima:'Haikyuu character',
  daichi:'Haikyuu character', kuroo:'Haikyuu character', bokuto:'Haikyuu character',
  ushijima:'Haikyuu character', oikawa:'Haikyuu character',
  isagi:'Blue Lock character', bachira:'Blue Lock character', rin:'Blue Lock character',
  nagi:'Blue Lock character', chigiri:'Blue Lock character', barou:'Blue Lock character',
  kaiser:'Blue Lock character',
  '2b':'NieR Automata character', '9s':'NieR Automata character',
  a2:'NieR Automata character', emil:'NieR Automata character',
  shin:'86 character', lena:'86 character', raiden:'86 character',
  frederica:'86 character', anju:'86 character',
  light:'Death Note character', l:'Death Note character', misa:'Death Note character',
  ryuk:'Death Note character', near:'Death Note character', mello:'Death Note character',
  edward:'Fullmetal Alchemist Brotherhood character', alphonse:'Fullmetal Alchemist Brotherhood character',
  roy:'Fullmetal Alchemist Brotherhood character', riza:'Fullmetal Alchemist Brotherhood character',
  winry:'Fullmetal Alchemist Brotherhood character', envy:'Fullmetal Alchemist Brotherhood character',
  greed:'Fullmetal Alchemist Brotherhood character', lust:'Fullmetal Alchemist Brotherhood character',
  hohenheim:'Fullmetal Alchemist Brotherhood character', scar:'Fullmetal Alchemist Brotherhood character',
  saitama:'One Punch Man character', genos:'One Punch Man character',
  tatsumaki:'One Punch Man character', fubuki:'One Punch Man character',
  garou:'One Punch Man character', bang:'One Punch Man character',
  king:'One Punch Man character', boros:'One Punch Man character', sonic:'One Punch Man character',
  // Dragon Ball additions
  whis:'Dragon Ball character', jiren:'Dragon Ball character',
  // Bleach additions
  kenpachi:'Bleach character',
  // Haikyuu additions
  nishinoya:'Haikyuu character',
  // Fire Force additions
  obi:'Fire Force character',
  // 86 additions
  theoto:'86 character',
  // Attack on Titan
  eren:'Attack on Titan character', mikasa:'Attack on Titan character',
  armin:'Attack on Titan character', levi:'Attack on Titan character', erwin:'Attack on Titan character',
  // My Hero Academia
  midoriya:'My Hero Academia character', bakugo:'My Hero Academia character',
  todoroki:'My Hero Academia character', 'all might':'My Hero Academia character', uraraka:'My Hero Academia character',
  // Tokyo Ghoul
  kaneki:'Tokyo Ghoul character', touka:'Tokyo Ghoul character',
  arima:'Tokyo Ghoul character', rize:'Tokyo Ghoul character',
  // Black Clover
  asta:'Black Clover character', yuno:'Black Clover character',
  noelle:'Black Clover character', yami:'Black Clover character',
  // Fairy Tail
  natsu:'Fairy Tail character', 'lucy heartfilia':'Fairy Tail character',
  erza:'Fairy Tail character', gray:'Fairy Tail character', wendy:'Fairy Tail character',
  // Code Geass
  lelouch:'Code Geass character', 'c.c.':'Code Geass character',
  suzaku:'Code Geass character', kallen:'Code Geass character',
  // Steins;Gate
  okabe:'Steins;Gate character', kurisu:'Steins;Gate character',
  mayuri:'Steins;Gate character', hashida:'Steins;Gate character',
  // Kuroko's Basketball
  kuroko:"Kuroko's Basketball character", kagami:"Kuroko's Basketball character",
  kise:"Kuroko's Basketball character", akashi:"Kuroko's Basketball character",
  // Slam Dunk
  sakuragi:'Slam Dunk character', rukawa:'Slam Dunk character',
  akagi:'Slam Dunk character', mitsui:'Slam Dunk character',
  // Prince of Tennis
  ryoma:'Prince of Tennis character', tezuka:'Prince of Tennis character',
  fuji:'Prince of Tennis character', atobe:'Prince of Tennis character',
  // Yuri on Ice
  yuuri:'Yuri on Ice character', victor:'Yuri on Ice character', yurio:'Yuri on Ice character',
  // Sword Art Online
  kirito:'Sword Art Online character', asuna:'Sword Art Online character',
  sinon:'Sword Art Online character', klein:'Sword Art Online character', leafa:'Sword Art Online character',
  // Re:Zero
  subaru:'Re:Zero character', emilia:'Re:Zero character',
  rem:'Re:Zero character', ram:'Re:Zero character',
  // Overlord
  ainz:'Overlord character', albedo:'Overlord character',
  shalltear:'Overlord character', demiurge:'Overlord character',
  // No Game No Life
  sora:'No Game No Life character', shiro:'No Game No Life character', stephanie:'No Game No Life character',
  // KonoSuba
  kazuma:'KonoSuba character', megumin:'KonoSuba character',
  // That Time I Got Reincarnated as a Slime
  rimuru:'That Time I Got Reincarnated as a Slime character',
  shion:'That Time I Got Reincarnated as a Slime character',
  milim:'That Time I Got Reincarnated as a Slime character',
  // Mushoku Tensei
  rudeus:'Mushoku Tensei character', roxy:'Mushoku Tensei character',
  eris:'Mushoku Tensei character', sylphiette:'Mushoku Tensei character',
  // The Rising of the Shield Hero
  naofumi:'The Rising of the Shield Hero character', raphtalia:'The Rising of the Shield Hero character',
  filo:'The Rising of the Shield Hero character', malty:'The Rising of the Shield Hero character',
  // Log Horizon
  shiroe:'Log Horizon character', naotsugu:'Log Horizon character', akatsuki:'Log Horizon character',
  // The Eminence in Shadow
  cid:'The Eminence in Shadow character', alpha:'The Eminence in Shadow character', beta:'The Eminence in Shadow character',
  // Cowboy Bebop
  spike:'Cowboy Bebop character', jet:'Cowboy Bebop character',
  faye:'Cowboy Bebop character', 'edward wong':'Cowboy Bebop character',
  // Samurai Champloo
  mugen:'Samurai Champloo character', jin:'Samurai Champloo character', fuu:'Samurai Champloo character',
  // Trigun
  vash:'Trigun character', wolfwood:'Trigun character', knives:'Trigun character',
  // Neon Genesis Evangelion
  shinji:'Neon Genesis Evangelion character', asuka:'Neon Genesis Evangelion character',
  rei:'Neon Genesis Evangelion character', misato:'Neon Genesis Evangelion character', kaworu:'Neon Genesis Evangelion character',
  // Gurren Lagann
  simon:'Gurren Lagann character', kamina:'Gurren Lagann character',
  yoko:'Gurren Lagann character', nia:'Gurren Lagann character',
  // Parasyte
  shinichi:'Parasyte character', migi:'Parasyte character', reiko:'Parasyte character',
  // Erased
  satoru:'Erased character', kayo:'Erased character', airi:'Erased character',
  // The Promised Neverland
  emma:'The Promised Neverland character', norman:'The Promised Neverland character',
  ray:'The Promised Neverland character', isabella:'The Promised Neverland character',
  // Made in Abyss
  riko:'Made in Abyss character', reg:'Made in Abyss character',
  nanachi:'Made in Abyss character', bondrewd:'Made in Abyss character',
  // Dr. Stone
  senku:'Dr. Stone character', taiju:'Dr. Stone character',
  // Soul Eater
  maka:'Soul Eater character', soul:'Soul Eater character',
  'death the kid':'Soul Eater character', 'black star':'Soul Eater character',
  // Blue Exorcist
  yukio:'Blue Exorcist character', shiemi:'Blue Exorcist character',
  // Noragami
  yato:'Noragami character', hiyori:'Noragami character', yukine:'Noragami character',
  // Bungo Stray Dogs
  dazai:'Bungo Stray Dogs character', atsushi:'Bungo Stray Dogs character',
  akutagawa:'Bungo Stray Dogs character', chuuya:'Bungo Stray Dogs character',
  // The Apothecary Diaries
  maomao:'The Apothecary Diaries character', jinshi:'The Apothecary Diaries character', gaoshun:'The Apothecary Diaries character',
  // Frieren
  frieren:'Frieren character', fern:'Frieren character',
  stark:'Frieren character', himmel:'Frieren character',
  // Delicious in Dungeon
  laios:'Delicious in Dungeon character', marcille:'Delicious in Dungeon character', senshi:'Delicious in Dungeon character',
  // Kaiju No. 8
  kafka:'Kaiju No. 8 character', reno:'Kaiju No. 8 character', kikoru:'Kaiju No. 8 character',
  // Solo Leveling
  jinwoo:'Solo Leveling character', 'cha hae-in':'Solo Leveling character', beru:'Solo Leveling character',
  // Wind Breaker
  haruka:'Wind Breaker character', kaji:'Wind Breaker character', umemiya:'Wind Breaker character',
  // Mashle
  mash:'Mashle character', finn:'Mashle character', lance:'Mashle character',
  // Blue Box
  taiki:'Blue Box character', chinatsu:'Blue Box character', hina:'Blue Box character',
  // Toradora
  ryuuji:'Toradora character', taiga:'Toradora character',
  minori:'Toradora character', kitamura:'Toradora character',
  // Your Lie in April
  kousei:'Your Lie in April character', kaori:'Your Lie in April character',
  tsubaki:'Your Lie in April character', watari:'Your Lie in April character',
  // Clannad
  tomoya:'Clannad character', 'nagisa furukawa':'Clannad character',
  kyou:'Clannad character', tomoyo:'Clannad character', ushio:'Clannad character', akio:'Clannad character',
  // Kaguya-sama
  kaguya:'Kaguya-sama character', shirogane:'Kaguya-sama character',
  chika:'Kaguya-sama character', ishigami:'Kaguya-sama character',
  // Rascal Does Not Dream of Bunny Girl Senpai
  sakuta:'Rascal Does Not Dream of Bunny Girl Senpai character',
  mai:'Rascal Does Not Dream of Bunny Girl Senpai character',
  tomoe:'Rascal Does Not Dream of Bunny Girl Senpai character',
  rio:'Rascal Does Not Dream of Bunny Girl Senpai character',
  // My Dress-Up Darling
  wakana:'My Dress-Up Darling character', marin:'My Dress-Up Darling character',
  sajuna:'My Dress-Up Darling character', shinju:'My Dress-Up Darling character',
  // Komi Can't Communicate
  komi:"Komi Can't Communicate character", tadano:"Komi Can't Communicate character",
  najimi:"Komi Can't Communicate character", yamai:"Komi Can't Communicate character",
  // Spirited Away
  chihiro:'Spirited Away character', haku:'Spirited Away character',
  yubaba:'Spirited Away character', 'no-face':'Spirited Away character',
  // Princess Mononoke
  ashitaka:'Princess Mononoke character', san:'Princess Mononoke character',
  'lady eboshi':'Princess Mononoke character', jigo:'Princess Mononoke character',
  // Howl's Moving Castle
  howl:"Howl's Moving Castle character", sophie:"Howl's Moving Castle character",
  calcifer:"Howl's Moving Castle character", 'witch of the waste':"Howl's Moving Castle character",
  // My Neighbor Totoro
  satsuki:'My Neighbor Totoro character', mei:'My Neighbor Totoro character', totoro:'My Neighbor Totoro character',
  // Kiki's Delivery Service
  kiki:"Kiki's Delivery Service character", jiji:"Kiki's Delivery Service character", tombo:"Kiki's Delivery Service character",
  // Akira
  kaneda:'Akira character', tetsuo:'Akira character', shikishima:'Akira character',
  // A Silent Voice
  shoya:'A Silent Voice character', shoko:'A Silent Voice character',
  ueno:'A Silent Voice character', nagatsuka:'A Silent Voice character',
  // Your Name
  taki:'Your Name character', mitsuha:'Your Name character',
  teshigawara:'Your Name character', sayaka:'Your Name character',
  // Weathering with You
  hodaka:'Weathering with You character', 'hina amano':'Weathering with You character',
  // Suzume
  suzume:'Suzume character', souta:'Suzume character', daijin:'Suzume character',
  // Monster
  tenma:'Monster character', johan:'Monster character',
  nina:'Monster character', lunge:'Monster character',
  // Hajime no Ippo
  ippo:'Hajime no Ippo character', takamura:'Hajime no Ippo character', miyata:'Hajime no Ippo character',
  // Initial D
  takumi:'Initial D character', keisuke:'Initial D character',
  ryousuke:'Initial D character', itsuki:'Initial D character',
  // Food Wars
  soma:'Food Wars character', erina:'Food Wars character',
  'megumi tadokoro':'Food Wars character', 'takumi aldini':'Food Wars character',
  // Gintama
  gintoki:'Gintama character', shinpachi:'Gintama character',
  kagura:'Gintama character', katsura:'Gintama character',
  // The Seven Deadly Sins
  meliodas:'The Seven Deadly Sins character', elizabeth:'The Seven Deadly Sins character',
  ban:'The Seven Deadly Sins character', diane:'The Seven Deadly Sins character',
  // Black Lagoon
  revy:'Black Lagoon character', rock:'Black Lagoon character',
  dutch:'Black Lagoon character', benny:'Black Lagoon character',
  // Violet Evergarden
  violet:'Violet Evergarden character', gilbert:'Violet Evergarden character',
  hodgins:'Violet Evergarden character', cattleya:'Violet Evergarden character',
  // Inuyasha
  inuyasha:'Inuyasha character', kagome:'Inuyasha character', sesshomaru:'Inuyasha character',
  miroku:'Inuyasha character', sango:'Inuyasha character',
  // Rurouni Kenshin
  kenshin:'Rurouni Kenshin character', sanosuke:'Rurouni Kenshin character', aoshi:'Rurouni Kenshin character',
  // Yu Yu Hakusho
  yusuke:'Yu Yu Hakusho character', kurama:'Yu Yu Hakusho character',
  hiei:'Yu Yu Hakusho character', kuwabara:'Yu Yu Hakusho character',
  // Berserk
  guts:'Berserk character', griffith:'Berserk character', casca:'Berserk character',
  'skull knight':'Berserk character', judeau:'Berserk character',
  // The God of High School
  'jin mori':'The God of High School character', daewi:'The God of High School character', 'yoo mira':'The God of High School character',
  // The Irregular at Magic High School
  tatsuya:'The Irregular at Magic High School character', 'miyuki shiba':'The Irregular at Magic High School character',
  erika:'The Irregular at Magic High School character', leo:'The Irregular at Magic High School character',
  // A Certain Magical Index
  touma:'A Certain Magical Index character', index:'A Certain Magical Index character',
  accelerator:'A Certain Magical Index character', misaka:'A Certain Magical Index character',
  // Fate
  kiritsugu:'Fate character', saber:'Fate character', kirei:'Fate character',
  iskandar:'Fate character', shirou:'Fate character', archer:'Fate character',
  jeanne:'Fate character', sieg:'Fate character', astolfo:'Fate character',
  karna:'Fate character', ritsuka:'Fate character', 'mash kyrielight':'Fate character',
  romani:'Fate character', solomon:'Fate character',
  // Ranking of Kings
  bojji:'Ranking of Kings character', kage:'Ranking of Kings character',
  daida:'Ranking of Kings character', hiling:'Ranking of Kings character',
  // Vinland Saga
  thorfinn:'Vinland Saga character', askeladd:'Vinland Saga character',
  canute:'Vinland Saga character', thors:'Vinland Saga character',
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
  room.word = pickWord(room).replace(/\s*\[.*?\]\s*$/, '').trim();
  room.lastWord = room.word;
  room.clues = [];
  room.votes = {};
  room.clueOrder = [...room.players].sort(() => Math.random() - 0.5).map(p => p.id);
  room.currentClueIndex = 0;
  room.imposters = assignRoles(room);
  room.guessUsed = false;

  const wordContext = room.customWordContexts?.[room.word.toLowerCase()]
    || DEFAULT_WORD_CONTEXTS[room.word.toLowerCase()]
    || null;
  // When context exists (e.g. an anime character), the series name IS the hint — skip Groq.
  const hintWord = wordContext ? null : await getHintWord(room.word, null);

  room.players.forEach(p => {
    const isImposter = room.imposters.includes(p.id);
    io.to(p.id).emit('game-start', {
      word: isImposter ? null : room.word,
      isImposter,
      hintWord: isImposter ? (hintWord || null) : null,
      wordContext: isImposter ? (wordContext || null) : null,
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
    if (!player) return;
    const trimmed = clue.trim().slice(0, 60);
    const entry = { playerId: socket.id, playerName: player.name, playerColor: player.color, clue: trimmed };
    room.clues.push(entry);
    room.currentClueIndex++;

    io.to(room.code).emit('clue-submitted', { entry, index: room.currentClueIndex - 1 });

    // Mid-clue win: imposter accidentally (or deliberately) says the secret word
    if (room.imposters.includes(socket.id) && trimmed.toLowerCase() === room.word.toLowerCase()) {
      player.score += 200;
      room.state = 'gameover';
      io.to(room.code).emit('imposter-self-revealed', {
        imposterId: socket.id,
        imposterName: player.name,
        word: room.word,
        players: sanitizePlayers(room.players),
      });
      setTimeout(() => {
        const isLastRound = room.currentRound >= room.rounds;
        if (isLastRound) {
          io.to(room.code).emit('game-over', {
            players: [...room.players].sort((a, b) => b.score - a.score)
              .map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
            imposters: room.imposters,
            imposterNames: room.players.filter(p => room.imposters.includes(p.id)).map(p => p.name),
            word: room.word,
          });
        } else {
          room.currentRound++;
          startRound(room);
        }
      }, 3000);
      return;
    }

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
    const correct = isFuzzyMatch(guess, room.word);
    const exact = guess.trim().toLowerCase() === room.word.trim().toLowerCase();
    if (correct) {
      const p = room.players.find(p => p.id === socket.id);
      if (p) p.score += 150;
    }
    io.to(room.code).emit('imposter-guessed', {
      correct,
      fuzzy: correct && !exact,
      guess,
      word: room.word,
      guesser: socket.id,
      players: sanitizePlayers(room.players)
    });

    if (correct) {
      room.state = 'gameover';
      setTimeout(() => {
        io.to(room.code).emit('game-over', {
          players: [...room.players].sort((a, b) => b.score - a.score).map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
          imposters: room.imposters,
          imposterNames: room.players.filter(p => room.imposters.includes(p.id)).map(p => p.name),
          word: room.word,
        });
      }, 3000);
    }
  });

  socket.on('next-round', () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id || room.state === 'gameover') return;
    room.currentRound++;
    if (room.currentRound > room.rounds) {
      room.state = 'gameover';
      io.to(room.code).emit('game-over', { players: [...room.players].sort((a, b) => b.score - a.score).map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })), imposters: room.imposters, imposterNames: room.players.filter(p => room.imposters.includes(p.id)).map(p => p.name), word: room.word });
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
