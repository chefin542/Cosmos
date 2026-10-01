import test from 'node:test';
import assert from 'node:assert/strict';
import { QUOTES, QUOTE_INTERVAL_MS, createQuoteRotator } from '../src/renderer/quotes.js';

test('명언은 10분마다 바뀐다', () => {
  assert.equal(QUOTE_INTERVAL_MS, 600_000);
});

test('모든 명언에 한국어 본문과 인물이 있다', () => {
  assert.ok(QUOTES.length >= 20);
  for (const q of QUOTES) {
    assert.match(q.text, /[가-힣]/);
    assert.ok(q.author.trim());
  }
  assert.equal(new Set(QUOTES.map((q) => q.text)).size, QUOTES.length, '중복 명언');
});

test('한 바퀴 도는 동안 모든 명언이 한 번씩 나오고, 같은 명언이 연달아 나오지 않는다', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rotator = createQuoteRotator(QUOTES, random);
  let prev = null;
  for (let round = 0; round < 20; round++) {
    const seen = new Set();
    for (let i = 0; i < QUOTES.length; i++) {
      const q = rotator.next();
      assert.notEqual(q, prev);
      seen.add(q);
      prev = q;
    }
    assert.equal(seen.size, QUOTES.length);
  }
});
