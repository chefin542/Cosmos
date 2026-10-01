import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../src/renderer/notes.js';

const DAY = 24 * 60 * 60 * 1000;

function note(overrides = {}) {
  return { ...N.createNote('text', 1000), ...overrides };
}

test('고정된 메모가 먼저, 그다음 최근 수정 순으로 정렬된다', () => {
  const a = note({ title: 'a', updatedAt: 100 });
  const b = note({ title: 'b', updatedAt: 300 });
  const c = note({ title: 'c', updatedAt: 200, pinned: true });
  assert.deepEqual(N.sortNotes([a, b, c]).map((n) => n.title), ['c', 'b', 'a']);
});

test('메모 목록과 휴지통을 구분하고, 제목·본문·체크리스트 항목에서 검색한다', () => {
  const live = note({ title: '장보기', body: '우유' });
  const list = { ...N.createNote('checklist'), items: [N.createItem('망원경 청소')] };
  const trashed = note({ title: '옛 메모', deletedAt: 5000 });
  const all = [live, list, trashed];

  assert.equal(N.visibleNotes(all).length, 2);
  assert.deepEqual(N.visibleNotes(all, { view: 'trash' }), [trashed]);
  assert.deepEqual(N.visibleNotes(all, { query: '우유' }), [live]);
  assert.deepEqual(N.visibleNotes(all, { query: '망원경' }), [list]);
  assert.deepEqual(N.visibleNotes(all, { query: '옛' }), []);
});

test('검색은 대소문자를 구분하지 않는다', () => {
  const n = note({ body: 'Hubble Telescope' });
  assert.deepEqual(N.visibleNotes([n], { query: 'hubble' }), [n]);
});

test('휴지통의 메모는 30일이 지나면 정리된다', () => {
  const now = 100 * DAY;
  const fresh = note({ deletedAt: now - 29 * DAY });
  const old = note({ deletedAt: now - 31 * DAY });
  const live = note();
  assert.deepEqual(N.purgeExpiredTrash([fresh, old, live], now), [fresh, live]);
  assert.equal(N.daysUntilPurge(fresh, now), 1);
});

test('일반 메모와 체크리스트를 서로 변환해도 완료 여부가 보존된다', () => {
  const n = note({ body: '- 우유\n\n[x] 빵\n• 달걀' });
  const list = N.toChecklist(n);
  assert.equal(list.type, 'checklist');
  assert.deepEqual(list.items.map((it) => [it.text, it.done]), [['우유', false], ['빵', true], ['달걀', false]]);

  const back = N.toText(list);
  assert.equal(back.type, 'text');
  assert.equal(back.body, '[ ] 우유\n[x] 빵\n[ ] 달걀');
  assert.deepEqual(N.toChecklist(back).items.map((it) => [it.text, it.done]), [['우유', false], ['빵', true], ['달걀', false]]);
});

test('빈 메모를 체크리스트로 바꾸면 빈 항목 하나가 생긴다', () => {
  assert.equal(N.toChecklist(note()).items.length, 1);
});

test('제목이 없으면 첫 줄을 제목으로 쓴다', () => {
  assert.equal(N.noteTitle(note({ body: '\n  첫 줄\n둘째 줄' })), '첫 줄');
  assert.equal(N.noteTitle(note()), '제목 없음');
  const list = { ...N.createNote('checklist'), items: [N.createItem(''), N.createItem('할 일')] };
  assert.equal(N.noteTitle(list), '할 일');
});

test('체크리스트 미리보기는 완료 개수를 보여 준다', () => {
  const list = { ...N.createNote('checklist'), items: [N.createItem('a', true), N.createItem('b'), N.createItem('')] };
  assert.equal(N.notePreview(list), '☑ 1/2 완료');
});

test('손상되었거나 이상한 데이터는 안전하게 정리된다', () => {
  assert.deepEqual(N.normalizeData(null), N.emptyData());
  assert.deepEqual(N.normalizeData({ notes: 'oops' }), N.emptyData());
  const data = N.normalizeData({
    notes: [null, { id: 1 }, { id: 'ok', title: 5, type: 'weird', items: [null, { text: 'x', done: 1 }], deletedAt: 'no' }],
    prefs: { theme: 'neon' },
  });
  assert.equal(data.notes.length, 1);
  const [n] = data.notes;
  assert.equal(n.title, '');
  assert.equal(n.type, 'text');
  assert.equal(n.deletedAt, null);
  assert.equal(n.items.length, 1);
  assert.equal(n.items[0].done, true);
  assert.equal(data.prefs.theme, 'system');
});

test('글자 수는 한글·이모지를 한 글자로 센다', () => {
  assert.equal(N.countChars(note({ body: '우주🪐' })), 3);
});
