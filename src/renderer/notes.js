// 메모 데이터를 다루는 순수 함수 모음 (DOM 없음 → node --test 로 테스트).

export const DATA_VERSION = 1;
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function uid() {
  return globalThis.crypto.randomUUID();
}

export function emptyData() {
  return { version: DATA_VERSION, notes: [], prefs: { theme: 'system' } };
}

// 로컬 시간 기준 날짜 키 (예: "2026-10-01"). 문자열 비교로 날짜 순서를 비교할 수 있다.
export function dayKey(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// kind: 'note'(일반) | 'review'(주간·연간 정리를 저장한 메모 — 통계에서 제외)
// editDays: 이 메모를 쓰거나 고친 날짜 키 목록 (달력·정리에 쓰인다)
export function createNote(type = 'text', now = Date.now()) {
  return {
    id: uid(),
    type,
    kind: 'note',
    title: '',
    body: '',
    items: type === 'checklist' ? [createItem()] : [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    editDays: [dayKey(now)],
    deletedAt: null,
  };
}

// doneAt: 완료 표시한 시각. 날짜를 알 수 없는 완료 항목은 null.
export function createItem(text = '', done = false, doneAt = null) {
  return { id: uid(), text, done, doneAt: done ? doneAt : null };
}

// 메모를 고쳤을 때 호출한다. 수정 시각과 "고친 날"을 함께 기록한다.
export function markEdited(note, now = Date.now()) {
  note.updatedAt = now;
  const key = dayKey(now);
  if (!note.editDays.includes(key)) note.editDays.push(key);
}

export function setItemDone(item, done, now = Date.now()) {
  item.done = done;
  item.doneAt = done ? now : null;
}

// 파일에서 읽은 값을 믿지 않고 필드마다 확인해서 정리한다.
export function normalizeData(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.notes)) return data;
  const str = (v) => (typeof v === 'string' ? v : '');
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const now = Date.now();
  for (const n of raw.notes) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string') continue;
    const createdAt = num(n.createdAt, now);
    const updatedAt = num(n.updatedAt, now);
    // 1.0 버전 데이터에는 editDays가 없다 → 만든 날과 마지막으로 고친 날로 채운다.
    let editDays = Array.isArray(n.editDays) ? n.editDays.filter((d) => DAY_KEY_RE.test(d)) : [];
    if (!editDays.length) editDays = [dayKey(createdAt), dayKey(updatedAt)];
    data.notes.push({
      id: n.id,
      type: n.type === 'checklist' ? 'checklist' : 'text',
      kind: n.kind === 'review' ? 'review' : 'note',
      title: str(n.title),
      body: str(n.body),
      items: Array.isArray(n.items)
        ? n.items
            .filter((it) => it && typeof it === 'object')
            .map((it) => ({
              id: typeof it.id === 'string' ? it.id : uid(),
              text: str(it.text),
              done: Boolean(it.done),
              doneAt: it.done && Number.isFinite(it.doneAt) ? it.doneAt : null,
            }))
        : [],
      pinned: Boolean(n.pinned),
      createdAt,
      updatedAt,
      editDays: [...new Set(editDays)].sort(),
      deletedAt: Number.isFinite(n.deletedAt) ? n.deletedAt : null,
    });
  }
  const theme = raw.prefs?.theme;
  if (theme === 'light' || theme === 'dark') data.prefs.theme = theme;
  // 주보·연간 정리 양식 (review.js DEFAULT_TEMPLATES 를 사용자가 고친 것)
  const templates = {};
  for (const kind of ['week', 'year']) {
    const t = raw.prefs?.templates?.[kind];
    if (t && typeof t === 'object') {
      templates[kind] = { format: str(t.format).slice(0, 20000), guide: str(t.guide).slice(0, 5000) };
    }
  }
  if (Object.keys(templates).length) data.prefs.templates = templates;
  return data;
}

export function noteTitle(note) {
  if (note.title.trim()) return note.title.trim();
  const first =
    note.type === 'checklist'
      ? note.items.find((it) => it.text.trim())?.text
      : note.body.split('\n').find((line) => line.trim());
  return first?.trim() || '제목 없음';
}

export function notePreview(note, max = 80) {
  let text;
  if (note.type === 'checklist') {
    const total = note.items.filter((it) => it.text.trim()).length;
    const done = note.items.filter((it) => it.done && it.text.trim()).length;
    text = total ? `☑ ${done}/${total} 완료` : '빈 체크리스트';
  } else {
    text = note.body.replace(/\s+/g, ' ').trim();
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function searchableText(note) {
  return [note.title, note.body, ...note.items.map((it) => it.text)].join('\n').toLowerCase();
}

// 고정된 메모가 먼저, 그 안에서는 최근 수정 순.
export function sortNotes(notes) {
  return notes.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

// view: 'notes' | 'trash'
export function visibleNotes(notes, { view = 'notes', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const inView = notes.filter((n) => (view === 'trash' ? n.deletedAt !== null : n.deletedAt === null));
  const matched = q ? inView.filter((n) => searchableText(n).includes(q)) : inView;
  if (view === 'trash') return matched.slice().sort((a, b) => b.deletedAt - a.deletedAt);
  return sortNotes(matched);
}

export function purgeExpiredTrash(notes, now = Date.now(), days = TRASH_RETENTION_DAYS) {
  return notes.filter((n) => n.deletedAt === null || now - n.deletedAt < days * DAY_MS);
}

export function daysUntilPurge(note, now = Date.now(), days = TRASH_RETENTION_DAYS) {
  return Math.max(0, Math.ceil((note.deletedAt + days * DAY_MS - now) / DAY_MS));
}

// 일반 메모 → 체크리스트: 줄마다 항목 하나. "- [x] 할 일" 같은 표기도 인식한다.
export function toChecklist(note) {
  const items = note.body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(?:[-*]\s*)?\[( |x|X)\]\s*(.*)$/);
      if (m) return createItem(m[2], m[1] !== ' ');
      return createItem(line.replace(/^[-*•]\s+/, ''));
    });
  return { ...note, type: 'checklist', items: items.length ? items : [createItem()], body: '' };
}

// 체크리스트 → 일반 메모: 완료 여부를 "[x]" 표기로 보존한다.
export function toText(note) {
  const body = note.items
    .filter((it) => it.text.trim())
    .map((it) => `${it.done ? '[x]' : '[ ]'} ${it.text}`)
    .join('\n');
  return { ...note, type: 'text', body, items: [] };
}

export function countChars(note) {
  const text = note.type === 'checklist' ? note.items.map((it) => it.text).join('') : note.body;
  return [...text].length;
}
