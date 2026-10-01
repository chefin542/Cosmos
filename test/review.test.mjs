import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../src/renderer/notes.js';
import * as R from '../src/renderer/review.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

function note(title, created, extra = {}) {
  const n = N.createNote(extra.type || 'text', created);
  n.title = title;
  return Object.assign(n, extra);
}

test('한 주는 월요일에 시작하고, ISO 주차를 쓴다', () => {
  const r = R.weekRange(new Date(2026, 9, 1)); // 2026-10-01 목요일
  assert.equal(r.start, '2026-09-28');
  assert.equal(r.last, '2026-10-04');
  assert.equal(r.end, '2026-10-05');
  assert.equal(r.label, '2026년 40주차');
  assert.equal(r.sublabel, '9/28 ~ 10/4');
  assert.equal(R.weekRange(new Date(2026, 9, 4)).start, '2026-09-28'); // 일요일도 같은 주
  assert.equal(R.shiftRange(r, -1).start, '2026-09-21');
  assert.equal(R.isoWeek(new Date(2027, 0, 1)).week, 53); // 2027-01-01은 2026년 53주차
  assert.equal(R.shiftRange(R.yearRange(2026), 1).label, '2027년');
});

test('고친 날짜를 기록하고, 완료 시각을 기록한다', () => {
  const n = note('일지', at(2026, 9, 28));
  N.markEdited(n, at(2026, 9, 30));
  N.markEdited(n, at(2026, 9, 30, 18));
  assert.deepEqual(n.editDays, ['2026-09-28', '2026-09-30']);
  const item = N.createItem('할 일');
  N.setItemDone(item, true, at(2026, 10, 1));
  assert.equal(N.dayKey(item.doneAt), '2026-10-01');
  N.setItemDone(item, false);
  assert.equal(item.doneAt, null);
});

test('1.0 데이터는 만든 날·마지막 수정일로 기록을 채운다', () => {
  const data = N.normalizeData({
    notes: [{ id: 'a', title: 't', createdAt: at(2026, 9, 1), updatedAt: at(2026, 9, 3), items: [{ text: 'x', done: true }] }],
  });
  const [n] = data.notes;
  assert.deepEqual(n.editDays, ['2026-09-01', '2026-09-03']);
  assert.equal(n.kind, 'note');
  assert.equal(n.items[0].doneAt, null); // 완료 날짜를 모르는 항목
});

function sampleNotes() {
  const plan = note('관측 계획', at(2026, 9, 28), { type: 'checklist' });
  plan.items = [N.createItem('망원경 청소'), N.createItem('지도 인쇄'), N.createItem('보고서')];
  N.setItemDone(plan.items[0], true, at(2026, 9, 29));
  N.setItemDone(plan.items[1], true, at(2026, 9, 29, 15));
  N.markEdited(plan, at(2026, 9, 29));

  const old = note('예전 메모', at(2026, 8, 1));
  N.markEdited(old, at(2026, 10, 1)); // 이번 주에 고침

  const other = note('지난주 메모', at(2026, 9, 22));
  const trashed = note('지운 메모', at(2026, 9, 29), { deletedAt: at(2026, 9, 30) });
  const saved = note('주간 정리', at(2026, 9, 30), { kind: 'review' });
  return { plan, old, other, all: [plan, old, other, trashed, saved] };
}

test('날짜별 기록: 그날 쓰거나 고친 메모와 완료한 일을 모은다', () => {
  const { plan, all } = sampleNotes();
  const days = R.activityByDay(all);
  const d29 = days.get('2026-09-29');
  assert.deepEqual(d29.notes, [plan]); // 휴지통 메모는 제외
  assert.deepEqual(d29.done.map((d) => d.item.text), ['망원경 청소', '지도 인쇄']);
  assert.equal(days.has('2026-09-30'), false); // 정리 메모는 제외
});

test('주간 정리: 새 메모·고친 메모·완료한 일·남은 일·가장 바빴던 날', () => {
  const { all } = sampleNotes();
  const review = R.buildReview(all, R.weekRange(new Date(2026, 9, 1)));
  assert.equal(review.notes.length, 2);
  assert.equal(review.createdCount, 1);
  assert.equal(review.editedCount, 1);
  assert.equal(review.done.length, 2);
  assert.deepEqual(review.open.map((o) => o.item.text), ['보고서']);
  assert.equal(review.activeDays, 3);
  assert.deepEqual(review.busiest, { day: '2026-09-29', count: 3 });
  assert.equal(review.byDay.length, 7);
  assert.equal(review.byDay[1].done.length, 2); // 화요일
  assert.equal(R.isEmptyReview(R.buildReview(all, R.weekRange(new Date(2026, 6, 1)))), true);
});

test('연간 정리: 월별로 집계한다', () => {
  const { all } = sampleNotes();
  const review = R.buildReview(all, R.yearRange(2026));
  assert.equal(review.byMonth.length, 12);
  assert.deepEqual(review.byMonth[7], { month: 8, notes: 1, done: 0 }); // 8월: 예전 메모(작성)
  assert.deepEqual(review.byMonth[8], { month: 9, notes: 2, done: 2 }); // 9월: 관측 계획, 지난주 메모
  assert.deepEqual(review.byMonth[9], { month: 10, notes: 1, done: 0 });
});

test('AI 프롬프트에는 기간 기록이 들어가고, 너무 길면 줄인다', () => {
  const { all } = sampleNotes();
  const { system, prompt } = R.summaryPrompt(R.buildReview(all, R.weekRange(new Date(2026, 9, 1))));
  assert.match(system, /지어내지 않는다/);
  assert.match(prompt, /2026-09-28 ~ 2026-10-04/);
  assert.match(prompt, /망원경 청소/);
  assert.match(prompt, /\[ \] 보고서/);
  assert.doesNotMatch(prompt, /지운 메모|지난주 메모/);

  const many = Array.from({ length: 400 }, (_, i) => note(`메모${i}`, at(2026, 3, 1), { body: '가'.repeat(5000) }));
  const big = R.summaryPrompt(R.buildReview(many, R.yearRange(2026))).prompt;
  assert.ok(big.length < 70_000);
  assert.match(big, /메모 \d+개는 제목도 생략/);
});

test('정리를 메모로 저장할 때 AI 요약이 맨 위에 온다', () => {
  const { all } = sampleNotes();
  const review = R.buildReview(all, R.weekRange(new Date(2026, 9, 1)));
  assert.equal(R.reviewNoteTitle(review), '주보 · 2026년 40주차 (9/28 ~ 10/4)');
  const body = R.reviewNoteBody(review, '■ 한눈에 보기\n관측 준비를 함');
  assert.ok(body.startsWith('■ 한눈에 보기'));
  assert.match(body, /\[x\] 망원경 청소/);
  assert.match(body, /가장 바빴던 날: 9\/29 \(화\)/);
  assert.doesNotMatch(R.reviewNoteBody(review), /─/);
});

test('최대 전송 글자 수 설정을 지킨다', () => {
  const many = Array.from({ length: 50 }, (_, i) => note(`메모${i}`, at(2026, 9, 29), { body: '나'.repeat(2000) }));
  const review = R.buildReview(many, R.weekRange(new Date(2026, 9, 1)));
  const small = R.summaryPrompt(review, { maxChars: 5000 }).prompt;
  assert.ok(small.length < 5200, `길이 ${small.length}`);
  assert.match(small, /제목도 생략/);
});

test('주보 기본 양식: 금주 실적 · 차주 계획 · 이슈', () => {
  const { all } = sampleNotes();
  const { system, prompt } = R.summaryPrompt(R.buildReview(all, R.weekRange(new Date(2026, 9, 1))));
  assert.match(system, /주보를 써 주는 비서/);
  assert.match(system, /\[양식\]\n■ 금주 실적/);
  assert.match(system, /■ 차주 계획/);
  assert.match(system, /\[작성 지침\]\n개조식/);
  assert.match(prompt, /주보를 양식에 맞게 써 줘/);
});

test('사용자가 고친 양식과 지침을 그대로 넣는다', () => {
  const { all } = sampleNotes();
  const template = { format: '1. 금주 업무\n2. 차주 업무\n3. 특이사항', guide: '항목마다 진행률(%)을 붙인다.' };
  const { system } = R.summaryPrompt(R.buildReview(all, R.weekRange(new Date(2026, 9, 1))), { template });
  assert.match(system, /\[양식\]\n1\. 금주 업무\n2\. 차주 업무\n3\. 특이사항/);
  assert.match(system, /진행률\(%\)/);
  assert.doesNotMatch(system, /금주 실적/);
  // 양식을 비우면 기본 양식, 지침만 비우면 지침 없이
  assert.equal(R.templateFor('week', { format: '  ', guide: '' }).format, R.DEFAULT_TEMPLATES.week.format);
  assert.doesNotMatch(R.summarySystem('week', { format: 'A', guide: '' }), /작성 지침/);
  assert.match(R.summaryPrompt(R.buildReview(all, R.yearRange(2026))).system, /연간 정리를 써 주는/);
});

test('양식은 메모 데이터에 저장되고 다시 읽힌다', () => {
  const data = N.normalizeData({ notes: [], prefs: { templates: { week: { format: 'F', guide: 'G' }, bad: { format: 'x' }, year: 'oops' } } });
  assert.deepEqual(data.prefs.templates, { week: { format: 'F', guide: 'G' } });
  assert.equal(N.normalizeData({ notes: [] }).prefs.templates, undefined);
});
