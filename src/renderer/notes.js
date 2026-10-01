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

export function createNote(type = 'text', now = Date.now()) {
  return {
    id: uid(),
    type,
    title: '',
    body: '',
    items: type === 'checklist' ? [createItem()] : [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function createItem(text = '', done = false) {
  return { id: uid(), text, done };
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
    data.notes.push({
      id: n.id,
      type: n.type === 'checklist' ? 'checklist' : 'text',
      title: str(n.title),
      body: str(n.body),
      items: Array.isArray(n.items)
        ? n.items
            .filter((it) => it && typeof it === 'object')
            .map((it) => ({
              id: typeof it.id === 'string' ? it.id : uid(),
              text: str(it.text),
              done: Boolean(it.done),
            }))
        : [],
      pinned: Boolean(n.pinned),
      createdAt: num(n.createdAt, now),
      updatedAt: num(n.updatedAt, now),
      deletedAt: Number.isFinite(n.deletedAt) ? n.deletedAt : null,
    });
  }
  const theme = raw.prefs?.theme;
  if (theme === 'light' || theme === 'dark') data.prefs.theme = theme;
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
