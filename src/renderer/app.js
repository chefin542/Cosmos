import { QUOTE_INTERVAL_MS, createQuoteRotator } from './quotes.js';
import * as N from './notes.js';
import * as R from './review.js';
import { icon, setIcon } from './icons.js';
import { $, el, dateFmt } from './dom.js';
import { createCalendarView } from './calendar-view.js';
import { createReviewView } from './review-view.js';
import { createSettingsView } from './settings-view.js';

// 화면 구성
//   사이드바: 메모 목록 | 달력(calendar-view.js) | 휴지통   ← state.view
//   오른쪽:   메모 편집기 | 주보·연간 정리(review-view.js) | 설정(settings-view.js)   ← state.main
// 앱을 켜면 오른쪽에 이번 주 주보가 먼저 보인다 (init 참고).
const api = window.cosmos;

document.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

// ------------------------------------------------------------ 상태 & 저장

const state = {
  data: N.emptyData(),
  selectedId: null,
  view: 'notes', // 사이드바: 'notes' | 'calendar' | 'trash'
  main: 'editor', // 오른쪽: 'editor' | 'review' | 'settings'
  query: '',
  dirty: false,
  showDone: true,
};

let saveTimer = null;

function markDirty() {
  state.dirty = true;
  $('meta-saved').textContent = '저장 중…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!state.dirty) return;
  state.dirty = false;
  try {
    await api.saveData(state.data);
    if (!state.dirty) $('meta-saved').textContent = '저장됨';
  } catch (err) {
    state.dirty = true;
    $('meta-saved').textContent = '저장 실패';
    showToast('저장하지 못했습니다. 잠시 후 다시 시도합니다.');
    saveTimer = setTimeout(flush, 3000);
  }
}

window.addEventListener('beforeunload', () => {
  if (state.dirty) api.saveDataSync(state.data);
});

const current = () => state.data.notes.find((n) => n.id === state.selectedId) || null;

function isEmptyNote(note) {
  return !note.title.trim() && !note.body.trim() && !note.items.some((it) => it.text.trim());
}

// 편집 중인 메모가 바뀌었음을 기록한다.
function touch(note) {
  N.markEdited(note);
  markDirty();
  renderList();
  renderMeta();
}

function replaceNote(updated) {
  const i = state.data.notes.findIndex((n) => n.id === updated.id);
  if (i !== -1) state.data.notes[i] = updated;
}

// 내용 없이 버려진 새 메모는 남기지 않는다.
function discardIfEmpty(id) {
  const note = state.data.notes.find((n) => n.id === id);
  if (note && note.deletedAt === null && isEmptyNote(note)) {
    state.data.notes = state.data.notes.filter((n) => n.id !== id);
    markDirty();
  }
}

// ------------------------------------------------------------ 동작

function select(id, { focus = null } = {}) {
  if (state.selectedId && state.selectedId !== id) discardIfEmpty(state.selectedId);
  state.selectedId = id;
  showMain('editor');
  renderList();
  renderEditor();
  if (focus === 'body') focusBody();
  if (focus === 'title') $('note-title').focus();
}

function selectFirstVisible() {
  const first = N.visibleNotes(state.data.notes, state)[0];
  select(first ? first.id : null);
}

function newNote(type) {
  if (state.selectedId) discardIfEmpty(state.selectedId);
  state.view = 'notes';
  state.query = '';
  $('search').value = '';
  const note = N.createNote(type);
  state.data.notes.unshift(note);
  state.selectedId = null;
  renderTabs();
  select(note.id, { focus: 'body' });
}

function setView(view) {
  if (state.view === view) return;
  const wasTrash = state.view === 'trash';
  if (state.selectedId) discardIfEmpty(state.selectedId);
  state.view = view;
  renderTabs();
  // 달력으로 갈 때는 보던 메모를 그대로 둔다 (휴지통에서 온 경우만 비운다).
  if (view === 'calendar') {
    if (wasTrash) state.selectedId = null;
    renderList();
    renderEditor();
    return;
  }
  state.selectedId = null;
  selectFirstVisible();
}

// 오른쪽 영역 전환: 메모 편집기 / 정리 / 설정
function showMain(name) {
  state.main = name;
  $('editor-pane').hidden = name !== 'editor';
  $('review-panel').hidden = name !== 'review';
  $('settings-panel').hidden = name !== 'settings';
}

function openNote(id) {
  const note = state.data.notes.find((n) => n.id === id);
  if (!note) return;
  if (note.deletedAt !== null && state.view !== 'trash') setView('trash');
  select(id);
}

function openReview(kind, date) {
  if (state.selectedId) discardIfEmpty(state.selectedId);
  showMain('review');
  reviewView.open(kind, date);
}

// 설정을 닫으면 설정을 열기 전 화면(주보 등)으로 돌아간다.
let mainBeforeSettings = 'editor';

function openSettings() {
  if (state.main !== 'settings') mainBeforeSettings = state.main;
  showMain('settings');
  settingsView.open();
}

function closePanel() {
  if (state.main === 'settings' && mainBeforeSettings === 'review') {
    showMain('review');
    reviewView.refreshSettings();
    return;
  }
  showMain('editor');
  renderEditor();
}

function openThisWeekReport() {
  if (state.view === 'trash') setView('notes');
  openReview('week', new Date());
}

function renderReportButton() {
  const r = R.weekRange(new Date());
  $('report-week').textContent = `${r.label} · ${r.sublabel}`;
}

// 주보·연간 정리 양식: null 이면 기본 양식으로 되돌린다.
function getTemplate(kind) {
  return state.data.prefs.templates?.[kind];
}

function setTemplate(kind, template) {
  const all = { ...(state.data.prefs.templates || {}) };
  if (template) all[kind] = template;
  else delete all[kind];
  state.data.prefs.templates = all;
  markDirty();
}

// 정리 화면의 "메모로 저장"
function saveReviewAsNote(title, body) {
  const note = N.createNote('text');
  note.kind = 'review';
  note.title = title;
  note.body = body;
  state.data.notes.unshift(note);
  markDirty();
  state.query = '';
  $('search').value = '';
  if (state.view !== 'notes') {
    state.view = 'notes';
    renderTabs();
  }
  select(note.id);
  showToast('정리를 메모로 저장했습니다.');
}

// 메모를 지운 뒤 목록에서 바로 아래(없으면 위) 메모를 고른다.
function selectNeighbor(list, removedId) {
  const i = list.findIndex((n) => n.id === removedId);
  const rest = list.filter((n) => n.id !== removedId);
  const next = rest[Math.min(Math.max(i, 0), rest.length - 1)];
  state.selectedId = null;
  select(next ? next.id : null);
}

function trashNote(note) {
  const before = N.visibleNotes(state.data.notes, state);
  note.deletedAt = Date.now();
  markDirty();
  selectNeighbor(before, note.id);
  showToast('휴지통으로 옮겼습니다.', '실행 취소', () => {
    note.deletedAt = null;
    markDirty();
    if (state.view !== 'notes') setView('notes');
    select(note.id);
  });
}

function restoreNote(note) {
  const before = N.visibleNotes(state.data.notes, state);
  note.deletedAt = null;
  markDirty();
  selectNeighbor(before, note.id);
  showToast('메모를 복원했습니다.');
}

function purgeNote(note) {
  if (!confirm(`'${N.noteTitle(note)}' 메모를 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
  const before = N.visibleNotes(state.data.notes, state);
  state.data.notes = state.data.notes.filter((n) => n.id !== note.id);
  markDirty();
  selectNeighbor(before, note.id);
}

function emptyTrash() {
  const count = state.data.notes.filter((n) => n.deletedAt !== null).length;
  if (!count || !confirm(`휴지통의 메모 ${count}개를 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
  state.data.notes = state.data.notes.filter((n) => n.deletedAt === null);
  markDirty();
  state.selectedId = null;
  select(null);
}

function togglePin(note) {
  note.pinned = !note.pinned;
  markDirty();
  renderList();
  renderToolbar(note);
}

function convertNote(note) {
  const converted = note.type === 'text' ? N.toChecklist(note) : N.toText(note);
  N.markEdited(converted);
  replaceNote(converted);
  markDirty();
  renderList();
  renderEditor();
  focusBody();
}

function focusBody() {
  const note = current();
  if (!note) return;
  if (note.type === 'text') {
    const body = $('note-body');
    body.focus();
    body.setSelectionRange(body.value.length, body.value.length);
  } else {
    const inputs = $('checklist').querySelectorAll('.check-row:not(.done) input[type="text"]');
    const target = inputs[inputs.length - 1];
    if (target) focusItem(target.closest('.check-row').dataset.id);
  }
}

// ------------------------------------------------------------ 렌더링: 목록

function shortDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return dateFmt.time.format(d);
  if (d.getFullYear() === now.getFullYear()) return dateFmt.day.format(d);
  return dateFmt.full.format(d);
}

function noteItem(note) {
  const btn = el('button', 'note-item');
  btn.type = 'button';
  btn.dataset.id = note.id;
  if (note.id === state.selectedId) btn.setAttribute('aria-current', 'true');

  const head = el('div', 'note-item-head');
  head.append(el('span', 'note-item-title', N.noteTitle(note)));
  if (note.pinned && state.view === 'notes') head.insertAdjacentHTML('beforeend', icon('pin'));

  const sub = el('div', 'note-item-sub');
  const when = state.view === 'trash' ? note.deletedAt : note.updatedAt;
  sub.append(el('span', 'note-item-date', shortDate(when)));
  sub.append(el('span', 'note-item-preview', N.notePreview(note)));

  btn.append(head, sub);
  return btn;
}

function renderList() {
  const calendar = state.view === 'calendar';
  $('search-box').hidden = calendar;
  $('note-list').hidden = calendar;
  $('calendar-panel').hidden = !calendar;
  if (calendar) {
    calendarView.render();
    renderCounts();
    return;
  }
  const list = $('note-list');
  const notes = N.visibleNotes(state.data.notes, state);
  const scroll = list.scrollTop;
  list.replaceChildren();

  if (state.view === 'trash' && notes.length) {
    const h = el('div', 'list-heading', `${N.TRASH_RETENTION_DAYS}일 후 자동 삭제`);
    const btn = el('button', '', '휴지통 비우기');
    btn.type = 'button';
    btn.addEventListener('click', emptyTrash);
    h.append(btn);
    list.append(h);
  }

  const pinned = state.view === 'notes' ? notes.filter((n) => n.pinned) : [];
  if (pinned.length) {
    list.append(el('div', 'list-heading', '고정됨'));
    pinned.forEach((n) => list.append(noteItem(n)));
    if (pinned.length < notes.length) list.append(el('div', 'list-heading', '메모'));
    notes.filter((n) => !n.pinned).forEach((n) => list.append(noteItem(n)));
  } else {
    notes.forEach((n) => list.append(noteItem(n)));
  }

  if (!notes.length) {
    let msg = '메모가 없습니다.\n새 메모를 만들어 보세요.';
    if (state.query) msg = `'${state.query}'에 대한\n검색 결과가 없습니다.`;
    else if (state.view === 'trash') msg = '휴지통이 비어 있습니다.';
    const empty = el('div', 'list-empty', msg);
    empty.style.whiteSpace = 'pre-line';
    list.append(empty);
  }
  list.scrollTop = scroll;
  renderCounts();
}

function renderCounts() {
  const live = state.data.notes.filter((n) => n.deletedAt === null).length;
  const trash = state.data.notes.length - live;
  $('count-notes').textContent = live || '';
  $('count-trash').textContent = trash || '';
}

function renderTabs() {
  $('view-notes').setAttribute('aria-pressed', String(state.view === 'notes'));
  $('view-calendar').setAttribute('aria-pressed', String(state.view === 'calendar'));
  $('view-trash').setAttribute('aria-pressed', String(state.view === 'trash'));
}

// ------------------------------------------------------------ 렌더링: 편집기

function renderToolbar(note) {
  const inTrash = note.deletedAt !== null;
  $('toolbar-normal').hidden = inTrash;
  $('toolbar-trash').hidden = !inTrash;
  const pin = $('pin-note');
  pin.setAttribute('aria-pressed', String(note.pinned));
  pin.querySelector('.label').textContent = note.pinned ? '고정 해제' : '고정';
  pin.title = note.pinned ? '목록 상단 고정 해제' : '목록 상단에 고정';
  const convert = $('convert-note');
  setIcon(convert.querySelector('[data-icon]'), note.type === 'text' ? 'checklist' : 'text');
  convert.querySelector('.label').textContent = note.type === 'text' ? '체크리스트로' : '일반 메모로';
  convert.title = note.type === 'text' ? '줄마다 항목이 되는 체크리스트로 바꿉니다' : '체크리스트를 일반 메모로 바꿉니다';
}

function renderMeta() {
  const note = current();
  if (!note) return;
  $('meta-updated').textContent = `수정: ${dateFmt.long.format(note.updatedAt)}`;
  $('meta-chars').textContent = `${N.countChars(note).toLocaleString('ko-KR')}자`;
}

function renderEditor() {
  const note = current();
  $('empty-state').hidden = Boolean(note);
  $('editor-inner').hidden = !note;
  if (!note) {
    $('empty-text').textContent =
      state.view === 'trash' ? '삭제된 메모를 선택하면 내용을 볼 수 있습니다.' : '메모를 선택하거나 새로 만드세요.';
    return;
  }
  const readOnly = note.deletedAt !== null;
  renderToolbar(note);

  const banner = $('trash-banner');
  banner.hidden = !readOnly;
  if (readOnly) {
    banner.textContent = `휴지통에 있는 메모입니다. ${N.daysUntilPurge(note)}일 후 영구 삭제됩니다. 편집하려면 먼저 복원하세요.`;
  }

  const title = $('note-title');
  title.value = note.title;
  title.readOnly = readOnly;

  const body = $('note-body');
  body.hidden = note.type !== 'text';
  body.value = note.body;
  body.readOnly = readOnly;

  $('checklist').hidden = note.type !== 'checklist';
  if (note.type === 'checklist') renderChecklist();
  $('meta-saved').textContent = state.dirty ? '저장 중…' : '';
  renderMeta();
}

// ------------------------------------------------------------ 체크리스트

function checkRow(note, item, readOnly) {
  const row = el('div', `check-row${item.done ? ' done' : ''}`);
  row.dataset.id = item.id;

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = item.done;
  box.disabled = readOnly;
  box.setAttribute('aria-label', '완료');
  box.addEventListener('change', () => {
    N.setItemDone(item, box.checked);
    touch(note);
    renderChecklist();
  });

  const input = document.createElement('input');
  input.type = 'text';
  input.value = item.text;
  input.readOnly = readOnly;
  input.placeholder = '할 일';
  input.addEventListener('input', () => {
    item.text = input.value;
    touch(note);
  });
  input.addEventListener('keydown', (e) => onItemKeydown(e, note, item, input));

  const remove = el('button', 'remove');
  remove.type = 'button';
  remove.title = '항목 삭제';
  remove.innerHTML = icon('close');
  remove.addEventListener('click', () => removeItem(note, item, false));

  row.append(box, input, remove);
  return row;
}

function renderChecklist() {
  const note = current();
  const box = $('checklist');
  const readOnly = note.deletedAt !== null;
  box.classList.toggle('readonly', readOnly);
  box.replaceChildren();

  const open = note.items.filter((it) => !it.done);
  const done = note.items.filter((it) => it.done);
  open.forEach((it) => box.append(checkRow(note, it, readOnly)));

  const add = el('button', 'add-item');
  add.type = 'button';
  add.innerHTML = `${icon('plus')}<span>항목 추가</span>`;
  add.addEventListener('click', () => insertItem(note, null));
  box.append(add);

  if (done.length) {
    const toggle = el('button', 'done-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(state.showDone));
    toggle.innerHTML = `${icon('chevron')}<span>완료된 항목 ${done.length}개</span>`;
    toggle.addEventListener('click', () => {
      state.showDone = !state.showDone;
      renderChecklist();
    });
    box.append(toggle);
    if (state.showDone) done.forEach((it) => box.append(checkRow(note, it, readOnly)));
  }
}

function focusItem(id, caret = 'end') {
  const input = $('checklist').querySelector(`.check-row[data-id="${CSS.escape(id)}"] input[type="text"]`);
  if (!input) return;
  input.focus();
  const pos = caret === 'start' ? 0 : input.value.length;
  input.setSelectionRange(pos, pos);
}

// after: 이 항목 바로 뒤에 넣는다. null이면 미완료 항목의 맨 끝.
function insertItem(note, after, text = '') {
  const item = N.createItem(text);
  if (after) {
    note.items.splice(note.items.indexOf(after) + 1, 0, item);
  } else {
    const lastOpen = note.items.map((it) => it.done).lastIndexOf(false);
    note.items.splice(lastOpen + 1, 0, item);
  }
  touch(note);
  renderChecklist();
  focusItem(item.id, 'start');
}

function removeItem(note, item, focusPrevious) {
  const rows = [...$('checklist').querySelectorAll('.check-row')];
  const idx = rows.findIndex((r) => r.dataset.id === item.id);
  note.items = note.items.filter((it) => it !== item);
  touch(note);
  renderChecklist();
  const neighbor = rows[focusPrevious ? idx - 1 : idx + 1] || rows[idx - 1];
  if (neighbor && neighbor.dataset.id !== item.id) focusItem(neighbor.dataset.id);
}

function onItemKeydown(e, note, item, input) {
  if (e.isComposing || e.keyCode === 229 || input.readOnly) return; // 한글 조합 중에는 무시
  const rows = [...$('checklist').querySelectorAll('.check-row')];
  const idx = rows.findIndex((r) => r.dataset.id === item.id);

  if (e.key === 'Enter') {
    e.preventDefault();
    // 커서 뒤의 글자는 새 항목으로 넘긴다.
    const tail = input.value.slice(input.selectionEnd);
    item.text = input.value.slice(0, input.selectionStart);
    insertItem(note, item, tail);
  } else if (e.key === 'Backspace' && input.value === '' && note.items.length > 1) {
    e.preventDefault();
    removeItem(note, item, true);
  } else if (e.key === 'ArrowUp' && idx > 0) {
    e.preventDefault();
    focusItem(rows[idx - 1].dataset.id);
  } else if (e.key === 'ArrowDown' && idx < rows.length - 1) {
    e.preventDefault();
    focusItem(rows[idx + 1].dataset.id);
  }
}

// ------------------------------------------------------------ 테마

// 테마는 설정 화면에서 바꾼다. 값은 메모 데이터(prefs.theme)에 함께 저장된다.
function applyTheme() {
  const theme = state.data.prefs.theme;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function setTheme(theme) {
  state.data.prefs.theme = theme;
  applyTheme();
  markDirty();
}

// ------------------------------------------------------------ 토스트

let toastTimer = null;

function showToast(text, actionLabel, onAction) {
  const toast = $('toast');
  const action = $('toast-action');
  $('toast-text').textContent = text;
  action.hidden = !actionLabel;
  action.textContent = actionLabel || '';
  action.onclick = () => {
    toast.hidden = true;
    onAction?.();
  };
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), actionLabel ? 6000 : 2200);
}

// ------------------------------------------------------------ 과학 명언 (10분마다 교체)

const rotator = createQuoteRotator();
let quoteTimer = null;
let quoteShownAt = 0;

function showNextQuote() {
  const quote = rotator.next();
  const body = $('quote-body');
  const swap = () => {
    $('quote-text').textContent = quote.text;
    $('quote-author').textContent = quote.author;
    $('quote-source').textContent = quote.source || '';
    body.title = `${quote.text}\n— ${quote.author}${quote.source ? ` · ${quote.source}` : ''}`;
    body.classList.remove('fading');
  };
  if ($('quote-text').textContent) {
    body.classList.add('fading');
    setTimeout(swap, 400);
  } else {
    swap();
  }

  // 다음 교체까지 남은 시간을 얇은 막대로 보여 준다.
  const progress = $('quote-progress');
  progress.style.setProperty('--quote-duration', `${QUOTE_INTERVAL_MS}ms`);
  progress.classList.remove('running');
  void progress.offsetWidth; // 애니메이션 재시작
  progress.classList.add('running');

  quoteShownAt = Date.now();
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(showNextQuote, QUOTE_INTERVAL_MS);
}

// 창이 트레이에 숨어 있거나 절전에서 깨어나 타이머가 밀렸을 때 바로잡는다.
function catchUpQuote() {
  if (Date.now() - quoteShownAt >= QUOTE_INTERVAL_MS) showNextQuote();
}

// ------------------------------------------------------------ 창 제어

function applyWindowState(ws) {
  if (!ws) return;
  document.body.classList.toggle('collapsed', ws.collapsed);

  const onTop = $('btn-ontop');
  onTop.setAttribute('aria-pressed', String(ws.alwaysOnTop));
  onTop.title = ws.alwaysOnTop ? '항상 위에 표시 끄기' : '항상 위에 표시';

  const collapse = $('btn-collapse');
  collapse.setAttribute('aria-pressed', String(ws.collapsed));
  setIcon(collapse, ws.collapsed ? 'expand' : 'collapse');
  collapse.title = ws.collapsed ? '창 펼치기' : '창 접기 (제목 표시줄만 남기기)';

  const max = $('btn-max');
  setIcon(max, ws.maximized ? 'restoreWin' : 'maximize');
  max.title = ws.maximized ? '이전 크기로' : '최대화';
  max.disabled = ws.collapsed;
}

// ------------------------------------------------------------ 이벤트 연결

function bindEvents() {
  $('btn-ontop').addEventListener('click', () => api.windowAction('toggle-always-on-top'));
  $('btn-collapse').addEventListener('click', () => api.windowAction('toggle-collapse'));
  $('btn-tray').addEventListener('click', () => api.windowAction('hide-to-tray'));
  $('btn-min').addEventListener('click', () => api.windowAction('minimize'));
  $('btn-max').addEventListener('click', () => api.windowAction('toggle-maximize'));
  $('btn-close').addEventListener('click', () => api.windowAction('close'));
  api.onWindowState(applyWindowState);
  api.onNewNote(() => newNote('text'));

  $('open-report').addEventListener('click', openThisWeekReport);
  $('new-note').addEventListener('click', () => newNote('text'));
  $('new-checklist').addEventListener('click', () => newNote('checklist'));
  $('view-notes').addEventListener('click', () => setView('notes'));
  $('view-calendar').addEventListener('click', () => setView('calendar'));
  $('view-trash').addEventListener('click', () => setView('trash'));
  $('btn-settings').addEventListener('click', () => (state.main === 'settings' ? showMain('editor') : openSettings()));

  $('note-list').addEventListener('click', (e) => {
    const item = e.target.closest('.note-item');
    if (item) select(item.dataset.id);
  });

  $('search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
  });
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.target.value = '';
      state.query = '';
      renderList();
    } else if (e.key === 'Enter' && !e.isComposing) {
      const first = N.visibleNotes(state.data.notes, state)[0];
      if (first) select(first.id, { focus: 'body' });
    }
  });

  $('note-title').addEventListener('input', (e) => {
    const note = current();
    if (!note || note.deletedAt !== null) return;
    note.title = e.target.value;
    touch(note);
  });
  $('note-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      focusBody();
    }
  });
  $('note-body').addEventListener('input', (e) => {
    const note = current();
    if (!note || note.deletedAt !== null) return;
    note.body = e.target.value;
    touch(note);
  });

  const withNote = (fn) => () => {
    const note = current();
    if (note) fn(note);
  };
  $('pin-note').addEventListener('click', withNote(togglePin));
  $('convert-note').addEventListener('click', withNote(convertNote));
  $('delete-note').addEventListener('click', withNote(trashNote));
  $('restore-note').addEventListener('click', withNote(restoreNote));
  $('purge-note').addEventListener('click', withNote(purgeNote));

  $('quote-next').addEventListener('click', showNextQuote);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) catchUpQuote();
  });
  window.addEventListener('focus', catchUpQuote);

  document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'n') {
      e.preventDefault();
      newNote(e.shiftKey ? 'checklist' : 'text');
    } else if (key === 'f') {
      e.preventDefault();
      if (state.view === 'calendar') setView('notes');
      $('search').focus();
      $('search').select();
    } else if (key === 's') {
      e.preventDefault();
      flush();
    } else if (key === ',') {
      e.preventDefault();
      openSettings();
    }
  });
}

// ------------------------------------------------------------ 화면 모듈 연결

// 각 화면 모듈(calendar-view.js 등)이 앱 상태와 동작에 접근하는 통로
const ctx = {
  api,
  state,
  openNote,
  openReview,
  openSettings,
  closePanel,
  getTemplate,
  setTemplate,
  noteItem,
  saveReviewAsNote,
  setTheme,
  showToast,
};
const calendarView = createCalendarView(ctx);
const reviewView = createReviewView(ctx);
const settingsView = createSettingsView(ctx);

// ------------------------------------------------------------ 시작

function welcomeNote() {
  const note = N.createNote('text');
  note.title = 'Cosmos 메모장에 오신 것을 환영합니다';
  note.body = [
    '메모는 입력하는 즉시 자동으로 저장됩니다.',
    '',
    '■ 창 기능 (오른쪽 위 버튼)',
    '• 항상 위에 표시: 다른 창 위에 메모장을 띄워 둡니다.',
    '• 창 접기: 제목 표시줄만 남깁니다. 다시 누르면 펼쳐집니다.',
    '• 트레이로 숨기기: 작업 표시줄에서 사라지고 트레이 아이콘만 남습니다.',
    '  트레이 아이콘을 클릭하거나 메뉴에서 다시 열 수 있습니다.',
    '',
    '■ 메모 기능',
    '• 고정: 중요한 메모를 목록 맨 위에 둡니다.',
    '• 체크리스트: 할 일 목록을 만듭니다. 일반 메모와 서로 바꿀 수 있습니다.',
    '• 휴지통: 삭제한 메모는 30일 동안 보관되며 복원할 수 있습니다.',
    '',
    '■ 주보',
    '• 앱을 켜면 이번 주 주보가 먼저 보입니다. 왼쪽 위 "이번 주 주보"로 언제든 돌아올 수 있습니다.',
    '• 한 주 동안 쓴 메모와 완료한 할 일이 주보의 재료가 됩니다.',
    '• 설정(⚙)에서 "Claude Code 설정 가져오기"로 회사 AI를 연결하면 "주보 작성하기"로 주보를 써 줍니다.',
    '• "양식 편집"에 회사 주보 양식을 붙여 넣으면 그 모양대로 씁니다.',
    '',
    '■ 달력',
    '• 날짜를 누르면 그날 쓰거나 고친 메모와 완료한 할 일이 나옵니다.',
    '',
    '■ 단축키',
    '• Ctrl+N 새 메모 · Ctrl+Shift+N 새 체크리스트',
    '• Ctrl+F 검색 · Ctrl+S 바로 저장 · Ctrl+, 설정 · F12 개발자 도구',
    '',
    '하단에는 과학 명언이 10분마다 바뀌어 나타납니다. 🪐',
  ].join('\n');
  return note;
}

async function init() {
  bindEvents();
  showNextQuote();

  const raw = await api.loadData();
  state.data = N.normalizeData(raw);
  state.data.notes = N.purgeExpiredTrash(state.data.notes).filter(
    (n) => n.deletedAt !== null || !isEmptyNote(n),
  );
  if (raw === null) {
    state.data.notes.push(welcomeNote());
    markDirty();
  }
  applyTheme();
  renderTabs();
  renderList();
  renderReportButton();
  openThisWeekReport(); // 첫 화면 = 이번 주 주보
  applyWindowState(await api.getWindowState());
}

init();
