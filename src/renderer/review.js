// 날짜별 기록 · 주간/연간 정리를 계산하는 순수 함수 모음 (DOM 없음 → node --test 로 테스트).
//
// "그날 한 일"의 기준
//   - 메모: note.editDays 에 그 날짜가 있으면 그날 쓰거나 고친 메모
//   - 할 일: 체크리스트 항목의 doneAt 이 그 날짜면 그날 완료한 일
// 휴지통의 메모와 정리 결과를 저장한 메모(kind: 'review')는 제외한다.

import { dayKey, noteTitle } from './notes.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function weekdayName(date) {
  return WEEKDAYS[date.getDay()];
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// 한 주는 월요일에 시작한다.
export function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(d, -((d.getDay() + 6) % 7));
}

// ISO 8601 주차 (그 주의 목요일이 속한 해 기준)
export function isoWeek(date) {
  const thursday = addDays(startOfWeek(date), 3);
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.floor((thursday - jan1) / 86_400_000 / 7) + 1;
  return { year: thursday.getFullYear(), week };
}

const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

// 기간: start 이상 end 미만 (날짜 키). last는 마지막 날.
export function weekRange(date) {
  const start = startOfWeek(date);
  const last = addDays(start, 6);
  const { year, week } = isoWeek(date);
  return {
    kind: 'week',
    anchor: start,
    start: dayKey(start),
    end: dayKey(addDays(start, 7)),
    last: dayKey(last),
    label: `${year}년 ${week}주차`,
    sublabel: `${md(start)} ~ ${md(last)}`,
  };
}

export function yearRange(year) {
  return {
    kind: 'year',
    anchor: new Date(year, 0, 1),
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
    last: `${year}-12-31`,
    label: `${year}년`,
    sublabel: '1월 ~ 12월',
  };
}

export function shiftRange(range, delta) {
  if (range.kind === 'week') return weekRange(addDays(range.anchor, 7 * delta));
  return yearRange(range.anchor.getFullYear() + delta);
}

const inRange = (key, range) => key >= range.start && key < range.end;

function trackedNotes(notes) {
  return notes.filter((n) => n.deletedAt === null && n.kind !== 'review');
}

// 날짜 키 → { notes: [메모], done: [{ note, item }] }
export function activityByDay(notes) {
  const days = new Map();
  const day = (key) => {
    if (!days.has(key)) days.set(key, { notes: [], done: [] });
    return days.get(key);
  };
  for (const note of trackedNotes(notes)) {
    for (const key of note.editDays) day(key).notes.push(note);
    for (const item of note.items) {
      if (item.done && item.doneAt !== null) day(dayKey(item.doneAt)).done.push({ note, item });
    }
  }
  for (const entry of days.values()) {
    entry.notes.sort((a, b) => b.updatedAt - a.updatedAt);
    entry.done.sort((a, b) => a.item.doneAt - b.item.doneAt);
  }
  return days;
}

export function activityCount(entry) {
  return entry ? entry.notes.length + entry.done.length : 0;
}

export function buildReview(notes, range) {
  const days = activityByDay(notes);
  const keys = [...days.keys()].filter((k) => inRange(k, range)).sort();

  const touched = new Map(); // 기간 안에 쓰거나 고친 메모
  const done = [];
  let busiest = null;
  for (const key of keys) {
    const entry = days.get(key);
    entry.notes.forEach((n) => touched.set(n.id, n));
    done.push(...entry.done.map((d) => ({ ...d, day: key })));
    const count = activityCount(entry);
    if (!busiest || count > busiest.count) busiest = { day: key, count };
  }

  const touchedNotes = [...touched.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const created = touchedNotes.filter((n) => inRange(dayKey(n.createdAt), range));
  const open = [];
  for (const note of touchedNotes) {
    for (const item of note.items) {
      if (!item.done && item.text.trim()) open.push({ note, item });
    }
  }

  const review = {
    range,
    notes: touchedNotes,
    createdCount: created.length,
    editedCount: touchedNotes.length - created.length,
    done,
    open,
    activeDays: keys.length,
    busiest,
  };

  if (range.kind === 'week') {
    review.byDay = Array.from({ length: 7 }, (_, i) => {
      const key = dayKey(addDays(range.anchor, i));
      const entry = days.get(key);
      return { day: key, notes: entry?.notes ?? [], done: entry?.done ?? [] };
    });
  } else {
    review.byMonth = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, notes: new Set(), done: 0 }));
    for (const key of keys) {
      const month = review.byMonth[Number(key.slice(5, 7)) - 1];
      const entry = days.get(key);
      entry.notes.forEach((n) => month.notes.add(n.id));
      month.done += entry.done.length;
    }
    review.byMonth = review.byMonth.map((m) => ({ month: m.month, notes: m.notes.size, done: m.done }));
  }
  return review;
}

export function isEmptyReview(review) {
  return review.notes.length === 0 && review.done.length === 0;
}

// ------------------------------------------------------------ AI 요약용 프롬프트

// AI에게 주는 양식. 사용자가 정리 화면의 "양식 편집"에서 바꿀 수 있고, 바꾼 값은
// 메모 데이터의 prefs.templates[kind] 에 저장된다 (notes.js normalizeData 참고).
//   format: 결과물의 모양 (회사 주보 양식을 그대로 붙여 넣으면 된다)
//   guide:  작성 지침 (문체, 분량, 묶는 방법 등)
export const DEFAULT_TEMPLATES = {
  week: {
    format: [
      '■ 금주 실적',
      '1. (업무/프로젝트명)',
      '   - (한 일과 결과)',
      '',
      '■ 차주 계획',
      '1. (업무/프로젝트명)',
      '   - (할 일)',
      '',
      '■ 이슈 및 협조 요청',
      '- (없으면 "없음")',
    ].join('\n'),
    guide: [
      '개조식(~함, ~완료, ~예정)으로 짧게 쓴다.',
      '같은 업무는 하나의 번호로 묶는다.',
      '차주 계획은 남은 할 일과 메모에 적힌 다음 단계에서만 고른다.',
    ].join('\n'),
  },
  year: {
    format: [
      '■ 한눈에 보기',
      '(올해 무엇을 했는지 2~3문장)',
      '',
      '■ 주요 성과',
      '• (주제별로 묶어서 3~7개)',
      '',
      '■ 월별 흐름',
      '• (분기나 월 단위로 큰 흐름)',
      '',
      '■ 내년에 이어갈 일',
      '• (남은 할 일과 다음 단계. 없으면 "없음")',
    ].join('\n'),
    guide: '간결한 보고서 문체(~함, ~했음)로 쓴다.',
  },
};

export const DOC_NAME = { week: '주보', year: '연간 정리' };

export function templateFor(kind, saved) {
  const base = DEFAULT_TEMPLATES[kind];
  return {
    format: typeof saved?.format === 'string' && saved.format.trim() ? saved.format : base.format,
    guide: typeof saved?.guide === 'string' ? saved.guide : base.guide,
  };
}

// 고정 규칙 + 사용자 양식 + 작성 지침
export function summarySystem(kind, template = DEFAULT_TEMPLATES[kind]) {
  const lines = [
    `너는 사용자의 메모장 기록으로 ${DOC_NAME[kind]}를 써 주는 비서다.`,
    '주어진 기록에 있는 내용만 근거로 삼고, 기록에 없는 일은 지어내지 않는다.',
    '한국어로 쓴다. 마크다운 기호(#, **, 표)는 쓰지 말고, 아래 [양식]의 모양을 그대로 따른 일반 텍스트로만 답한다.',
    '양식의 괄호 안 설명은 실제 내용으로 바꾸고, 양식에 없는 머리말·맺음말은 붙이지 않는다.',
    '',
    '[양식]',
    template.format.trim(),
  ];
  if (template.guide?.trim()) lines.push('', '[작성 지침]', template.guide.trim());
  return lines.join('\n');
}

const LIMITS = {
  week: { perNote: 800, total: 30_000 },
  year: { perNote: 200, total: 60_000 },
};

function clip(text, max) {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…(생략)` : t;
}

function noteContent(note, max) {
  if (note.type === 'checklist') {
    return note.items
      .filter((it) => it.text.trim())
      .map((it) => `${it.done ? '[x]' : '[ ]'} ${it.text.trim()}`)
      .join('\n')
      .slice(0, max);
  }
  return clip(note.body, max);
}

// maxChars: 설정의 "최대 전송 글자 수". 기본 한도보다 작으면 그만큼만 보낸다.
// template: { format, guide } — 비우면 기본 양식
export function summaryPrompt(review, { maxChars = Infinity, template } = {}) {
  const { range } = review;
  const limit = { ...LIMITS[range.kind] };
  limit.total = Math.min(limit.total, maxChars);
  const lines = [
    `기간: ${range.label} (${range.start} ~ ${range.last})`,
    `통계: 새 메모 ${review.createdCount}개, 고친 메모 ${review.editedCount}개, 완료한 할 일 ${review.done.length}개, 기록한 날 ${review.activeDays}일`,
    '',
    '[완료한 할 일]',
    ...(review.done.length
      ? review.done.map((d) => `- ${d.day} ${d.item.text.trim()} (메모: ${noteTitle(d.note)})`)
      : ['- 없음']),
    '',
    '[남은 할 일]',
    ...(review.open.length ? review.open.map((o) => `- ${o.item.text.trim()} (메모: ${noteTitle(o.note)})`) : ['- 없음']),
    '',
    '[이 기간에 쓰거나 고친 메모]',
  ];

  // 완료/남은 할 일 목록만으로 한도를 넘으면 뒤쪽 줄을 잘라 낸다.
  while (lines.join('\n').length > limit.total && lines.length > 6) lines.splice(lines.length - 2, 1);

  let size = lines.join('\n').length;
  let omitted = 0;
  for (const note of review.notes) {
    const days = note.editDays.filter((k) => inRange(k, range));
    const block = `\n--- ${noteTitle(note)} (작성/수정: ${days.join(', ')})\n${noteContent(note, limit.perNote)}`;
    if (size + block.length > limit.total) {
      omitted++;
      continue;
    }
    lines.push(block);
    size += block.length;
  }
  if (omitted) lines.push(`\n(분량 제한으로 메모 ${omitted}개는 제목도 생략함)`);

  return {
    system: summarySystem(range.kind, templateFor(range.kind, template)),
    prompt: `${lines.join('\n')}\n\n위 기록으로 ${DOC_NAME[range.kind]}를 양식에 맞게 써 줘.`,
  };
}

// ------------------------------------------------------------ 메모로 저장

export function reviewNoteTitle(review) {
  const kind = DOC_NAME[review.range.kind];
  return `${kind} · ${review.range.label} (${review.range.sublabel})`;
}

export function reviewNoteBody(review, aiSummary = '') {
  const out = [];
  if (aiSummary.trim()) out.push(aiSummary.trim(), '', '─────────────', '');
  out.push(
    '■ 통계',
    `• 새 메모 ${review.createdCount}개 · 고친 메모 ${review.editedCount}개`,
    `• 완료한 할 일 ${review.done.length}개 · 기록한 날 ${review.activeDays}일`,
  );
  if (review.busiest) {
    const d = parseDayKey(review.busiest.day);
    out.push(`• 가장 바빴던 날: ${md(d)} (${weekdayName(d)}) — 기록 ${review.busiest.count}건`);
  }
  out.push('', '■ 완료한 일');
  out.push(...(review.done.length ? review.done.map((d) => `[x] ${d.item.text.trim()}`) : ['• 없음']));
  if (review.open.length) {
    out.push('', '■ 남은 할 일', ...review.open.map((o) => `[ ] ${o.item.text.trim()}`));
  }
  out.push('', '■ 쓰거나 고친 메모');
  out.push(...(review.notes.length ? review.notes.map((n) => `• ${noteTitle(n)}`) : ['• 없음']));
  return out.join('\n');
}
