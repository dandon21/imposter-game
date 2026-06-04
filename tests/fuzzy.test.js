// tests/fuzzy.test.js
const assert = require('assert');

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

assert.strictEqual(isFuzzyMatch('Elephant', 'elephant'), true, 'case insensitive exact');
assert.strictEqual(isFuzzyMatch(' elephant ', 'elephant'), true, 'trims whitespace');
assert.strictEqual(isFuzzyMatch('elephan', 'elephant'), true, '1 char missing = 87.5%');
assert.strictEqual(isFuzzyMatch('elephent', 'elephant'), true, '1 substitution = 87.5%');
assert.strictEqual(isFuzzyMatch('Naruto', 'naruto'), true, 'anime char case insensitive');
assert.strictEqual(isFuzzyMatch('Naruto ', 'naruto'), true, 'trailing space');
assert.strictEqual(isFuzzyMatch('narto', 'naruto'), true, '1 deletion on 6-char word = 83.3%');
assert.strictEqual(isFuzzyMatch('nrto', 'naruto'), false, '2 deletions on 6-char word = 66.7%');
assert.strictEqual(isFuzzyMatch('cat', 'elephant'), false, 'completely wrong');
assert.strictEqual(isFuzzyMatch('', 'elephant'), false, 'empty guess');

console.log('All fuzzy match tests passed ✓');
