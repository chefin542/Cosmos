// 오른쪽 영역의 "주보 · 연간 정리" 화면 (앱을 켜면 이번 주 주보가 먼저 보인다)
//   - 통계와 기록 목록은 review.js 로 계산한다 (AI 없이 항상 동작).
//   - "주보 작성하기"는 main 프로세스(src/main/llm.js)를 거쳐 설정한 LLM에 요청한다.
//   - 양식(형식·작성 지침)은 사용자가 고칠 수 있고 prefs.templates 에 저장된다 (ctx.getTemplate/setTemplate).
//   - 보낼 기록은 이번 기간에 한해 고쳐서 보낼 수 있다 (저장하지 않음).
import * as N from './notes.js';
import * as R from './review.js';
import { icon } from './icons.js';
import { $, el, button, dateFmt } from './dom.js';

function textarea(value, { rows = 4, className = '', placeholder = '' } = {}) {
  const t = document.createElement('textarea');
  t.value = value;
  t.rows = rows;
  t.className = className;
  t.placeholder = placeholder;
  t.spellcheck = false;
  return t;
}

const rowsFor = (text, min = 4, max = 28) => Math.min(max, Math.max(min, String(text).split('\n').length + 1));

export function createReviewView(ctx) {
  const root = $('review-panel');
  let range = null;
  let focus = null; // 사용자가 고른 날짜. 주보↔연간을 바꿔도 이 날짜를 기준으로 삼는다.
  let llm = null; // 화면용 AI 설정 (키 없음)
  let showPrompt = false;
  let showTemplate = false;
  // 기간별 AI 결과: key → { status: 'loading'|'done'|'error', text, error, truncated, ms }
  const summaries = new Map();
  // 기간별로 사용자가 고친 "보낼 기록": key → 문자열
  const promptDrafts = new Map();
  const rangeKey = (r) => `${r.kind}:${r.start}`;

  const rangeFor = (kind, date) => (kind === 'week' ? R.weekRange(date) : R.yearRange(date.getFullYear()));
  const docName = () => R.DOC_NAME[range.kind];

  async function open(kind, date) {
    focus = date;
    range = rangeFor(kind, date);
    showPrompt = false;
    render();
    await refreshSettings();
  }

  async function refreshSettings() {
    llm = (await ctx.api.getSettings())?.llm ?? null;
    if (range) render();
  }

  function setRange(next) {
    // 이전/다음으로 기간을 옮기면 기준 날짜도 그 기간의 첫날로 옮긴다.
    if (next.kind === range.kind && next.start !== range.start) focus = next.anchor;
    range = next;
    showPrompt = false;
    showTemplate = false;
    render();
  }

  // ---------------------------------------------------------- 위쪽 도구 막대

  function toolbar(review) {
    const bar = el('div', 'panel-toolbar');
    const seg = el('div', 'segmented');
    for (const [kind, label] of [['week', '주보'], ['year', '연간 정리']]) {
      const b = button('', label, () => setRange(rangeFor(kind, focus)));
      b.setAttribute('aria-pressed', String(range.kind === kind));
      seg.append(b);
    }
    const nav = el('div', 'range-nav');
    const title = el('div', 'range-title');
    title.append(el('strong', '', range.label), el('span', '', range.sublabel));
    nav.append(
      button('icon-btn', icon('left'), () => setRange(R.shiftRange(range, -1)), { html: true, title: '이전' }),
      title,
      button('icon-btn', icon('right'), () => setRange(R.shiftRange(range, 1)), { html: true, title: '다음' }),
    );
    const save = button('tool', `${icon('save')}<span class="label">메모로 저장</span>`, () => saveAsNote(review), {
      html: true,
      title: `이 ${docName()}를 메모로 저장합니다`,
    });
    save.disabled = R.isEmptyReview(review);
    bar.append(seg, nav, el('span', 'spacer'), save, button('icon-btn', icon('close'), ctx.closePanel, { html: true, title: '닫기' }));
    return bar;
  }

  function saveAsNote(review) {
    const s = summaries.get(rangeKey(range));
    ctx.saveReviewAsNote(R.reviewNoteTitle(review), R.reviewNoteBody(review, s?.status === 'done' ? s.text : ''));
  }

  // ---------------------------------------------------------- 통계

  function stats(review) {
    const box = el('div', 'stat-row');
    const stat = (value, label) => {
      const s = el('div', 'stat');
      s.append(el('strong', '', String(value)), el('span', '', label));
      return s;
    };
    box.append(
      stat(review.createdCount, '새 메모'),
      stat(review.editedCount, '고친 메모'),
      stat(review.done.length, '완료한 할 일'),
      stat(`${review.activeDays}일`, '기록한 날'),
    );
    return box;
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  function errorBox(error) {
    const box = el('div', 'error-box');
    box.append(el('p', '', error.message));
    if (error.detail) {
      const d = el('details');
      d.append(el('summary', '', '자세한 내용'), el('pre', '', error.detail));
      box.append(d);
    }
    const actions = el('div', 'row-actions');
    actions.append(
      button('link-btn', '로그 폴더 열기', () => ctx.api.openLogs()),
      button('link-btn', '진단 정보 복사', copyDiagnostics),
      button('link-btn', '설정 열기', ctx.openSettings),
    );
    box.append(actions);
    return box;
  }

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(await ctx.api.getDiagnostics());
    ctx.showToast('진단 정보를 복사했습니다.');
  }

  // ---------------------------------------------------------- AI 작성

  // 지금 보낼 내용: 시스템(규칙+양식+지침) + 기록(사용자가 고쳤으면 고친 것)
  function request(review) {
    const generated = R.summaryPrompt(review, { maxChars: llm?.maxPromptChars, template: ctx.getTemplate(range.kind) });
    const draft = promptDrafts.get(rangeKey(range));
    return { system: generated.system, prompt: draft ?? generated.prompt, generated: generated.prompt, edited: draft !== undefined };
  }

  async function write(review) {
    const key = rangeKey(range);
    const { system, prompt } = request(review);
    summaries.set(key, { status: 'loading' });
    render();
    const res = await ctx.api.llmComplete({ purpose: 'summary', request: { system, prompt } });
    summaries.set(
      key,
      res?.ok
        ? { status: 'done', text: res.text, truncated: res.truncated, ms: res.ms }
        : { status: 'error', error: res?.error ?? { message: '알 수 없는 오류' } },
    );
    if (range && rangeKey(range) === key) render();
  }

  function templateEditor() {
    const box = el('div', 'editor-box');
    const t = R.templateFor(range.kind, ctx.getTemplate(range.kind));
    const format = textarea(t.format, { rows: rowsFor(t.format, 8, 24), className: 'mono-area' });
    const guide = textarea(t.guide, { rows: rowsFor(t.guide, 3, 10), placeholder: '예: 업무명은 [ ]로 감싸고, 항목마다 진행률(%)을 붙인다.' });
    box.append(
      el('label', 'field-label', `${docName()} 양식`),
      el('p', 'field-hint', '회사 양식을 그대로 붙여 넣으세요. 괄호 안 설명은 AI가 실제 내용으로 바꿉니다.'),
      format,
      el('label', 'field-label', '작성 지침'),
      el('p', 'field-hint', '문체, 분량, 묶는 방법 등 AI가 지킬 규칙을 한 줄에 하나씩 적습니다.'),
      guide,
    );
    const actions = el('div', 'row-actions');
    actions.append(
      button('btn primary', '양식 저장', () => {
        ctx.setTemplate(range.kind, { format: format.value, guide: guide.value });
        showTemplate = false;
        ctx.showToast(`${docName()} 양식을 저장했습니다. 다음 작성부터 적용됩니다.`);
        render();
      }),
      button('btn', '기본 양식으로', () => {
        if (!confirm(`${docName()} 양식을 처음 기본값으로 되돌릴까요?`)) return;
        ctx.setTemplate(range.kind, null);
        render();
      }),
      button('link-btn', '닫기', () => {
        showTemplate = false;
        render();
      }),
    );
    box.append(actions);
    return box;
  }

  function promptEditor(review, where) {
    const box = el('div', 'editor-box');
    const req = request(review);
    box.append(el('p', 'muted', `아래 내용이 ${where} 로 전송됩니다. 기록은 이번 ${range.kind === 'week' ? '주' : '해'}에 한해 고쳐서 보낼 수 있습니다.`));

    const sys = el('details');
    sys.append(el('summary', '', 'AI에게 주는 지시 (규칙 + 양식 + 작성 지침)'), el('pre', 'prompt-preview', req.system));
    box.append(sys);

    const area = textarea(req.prompt, { rows: rowsFor(req.prompt, 8, 22), className: 'mono-area prompt-edit' });
    const info = el('p', 'field-hint');
    const reset = button('link-btn', '원래대로', () => {
      promptDrafts.delete(rangeKey(range));
      render();
    });
    const updateInfo = () => {
      const edited = promptDrafts.has(rangeKey(range));
      info.textContent = `${area.value.length.toLocaleString('ko-KR')}자${edited ? ' · 고친 내용으로 보냅니다' : ''}`;
      reset.hidden = !edited;
    };
    // 다시 그리지 않는다 — 입력 중인 커서를 지키기 위해.
    area.addEventListener('input', () => {
      if (area.value === req.generated) promptDrafts.delete(rangeKey(range));
      else promptDrafts.set(rangeKey(range), area.value);
      updateInfo();
    });
    updateInfo();
    const row = el('div', 'row-actions');
    row.append(info, reset);
    box.append(el('label', 'field-label', '보낼 기록'), area, row);
    return box;
  }

  function resultBox(s) {
    const box = el('div', 'result-box');
    const area = textarea(s.text, { rows: rowsFor(s.text, 8, 30), className: 'ai-text' });
    // 결과를 직접 다듬을 수 있다. 고친 내용은 복사·메모로 저장에 그대로 쓰인다.
    area.addEventListener('input', () => {
      s.text = area.value;
    });
    const actions = el('div', 'row-actions');
    actions.append(
      button('btn primary', '복사', async () => {
        await navigator.clipboard.writeText(area.value);
        ctx.showToast(`${docName()}를 복사했습니다. 메일이나 사내 시스템에 붙여 넣으세요.`);
      }),
      el('span', 'muted', `${(s.ms / 1000).toFixed(1)}초 걸림 · 위 글을 직접 고칠 수 있습니다 · "메모로 저장"하면 함께 저장됩니다.`),
    );
    box.append(area, actions);
    if (s.truncated) box.append(el('p', 'warn', '답변이 최대 출력 토큰에서 잘렸습니다. 설정 → 고급에서 늘릴 수 있습니다.'));
    return box;
  }

  function aiCard(review) {
    const card = el('section', 'ai-card');
    const head = el('div', 'ai-head');
    head.insertAdjacentHTML('beforeend', icon('sparkles'));
    head.append(el('strong', '', `AI ${docName()} 작성`));
    card.append(head);

    if (!llm?.enabled) {
      card.append(el('p', 'muted', `AI를 연결하면 이 기간의 기록으로 ${docName()}를 써 줍니다. 회사 Claude를 쓰고 있다면 설정에서 "Claude Code 설정 가져오기"를 누르세요.`));
      card.append(button('btn primary', 'AI 연결 설정 열기', ctx.openSettings));
      return card;
    }

    const where = llm.format === 'openai' ? hostOf(llm.baseURL) : llm.baseURL ? hostOf(llm.baseURL) : 'api.anthropic.com';
    head.append(el('span', 'muted', `${llm.model || '(모델 미설정)'} · ${where}`));

    const s = summaries.get(rangeKey(range));
    const actions = el('div', 'row-actions');
    const go = button('btn primary', s?.status === 'done' ? '다시 작성' : `${docName()} 작성하기`, () => write(review));
    go.disabled = s?.status === 'loading' || R.isEmptyReview(review);
    const tpl = button('btn', '양식 편집', () => {
      showTemplate = !showTemplate;
      render();
    });
    tpl.setAttribute('aria-pressed', String(showTemplate));
    const peek = button('btn', '보낼 내용 보기·고치기', () => {
      showPrompt = !showPrompt;
      render();
    });
    peek.setAttribute('aria-pressed', String(showPrompt));
    actions.append(go, tpl, peek);
    if (promptDrafts.has(rangeKey(range))) actions.append(el('span', 'warn', '고친 기록으로 보냅니다'));
    card.append(actions);

    if (showTemplate) card.append(templateEditor());
    if (showPrompt) card.append(promptEditor(review, where));

    if (s?.status === 'loading') {
      card.append(el('p', 'muted loading', `${docName()}를 쓰는 중… 서버에 따라 1~2분 걸릴 수 있습니다.`));
    } else if (s?.status === 'done') {
      card.append(resultBox(s));
    } else if (s?.status === 'error') {
      card.append(errorBox(s.error));
    }
    return card;
  }

  // ---------------------------------------------------------- 기록 목록

  function doneRow({ note, item }) {
    const row = button('done-item', '', () => ctx.openNote(note.id), { title: `'${N.noteTitle(note)}' 메모 열기` });
    row.insertAdjacentHTML('beforeend', icon('check'));
    const text = el('span', 'done-text');
    text.append(el('span', '', item.text.trim() || '(빈 항목)'), el('small', '', N.noteTitle(note)));
    row.append(text);
    return row;
  }

  function noteLink(note) {
    return button('note-link', N.noteTitle(note), () => ctx.openNote(note.id));
  }

  function weekDays(review) {
    const box = el('section', 'review-section');
    box.append(el('h3', '', '요일별 기록'));
    for (const day of review.byDay) {
      const date = R.parseDayKey(day.day);
      const row = el('div', `day-row${day.notes.length || day.done.length ? '' : ' empty'}`);
      row.append(el('div', 'day-label', dateFmt.dayWeek.format(date)));
      const body = el('div', 'day-body');
      if (!day.notes.length && !day.done.length) body.append(el('span', 'muted', '기록 없음'));
      if (day.notes.length) {
        const links = el('div', 'note-links');
        day.notes.forEach((n) => links.append(noteLink(n)));
        body.append(links);
      }
      day.done.forEach((d) => body.append(doneRow(d)));
      row.append(body);
      box.append(row);
    }
    return box;
  }

  function yearMonths(review) {
    const box = el('section', 'review-section');
    box.append(el('h3', '', '월별 기록'));
    const table = el('table', 'month-table');
    const head = el('tr');
    ['월', '쓰거나 고친 메모', '완료한 할 일'].forEach((t) => head.append(el('th', '', t)));
    table.append(head);
    for (const m of review.byMonth) {
      const tr = el('tr', m.notes || m.done ? '' : 'empty');
      tr.append(el('td', '', `${m.month}월`), el('td', 'num', String(m.notes)), el('td', 'num', String(m.done)));
      table.append(tr);
    }
    box.append(table);

    if (review.done.length) {
      const doneBox = el('section', 'review-section');
      doneBox.append(el('h3', '', `완료한 할 일 ${review.done.length}`));
      review.done.slice(-50).reverse().forEach((d) => doneBox.append(doneRow(d)));
      if (review.done.length > 50) doneBox.append(el('p', 'muted', `최근 50개만 표시 (전체 ${review.done.length}개)`));
      return [box, doneBox];
    }
    return [box];
  }

  function notesSection(review) {
    const box = el('section', 'review-section');
    box.append(el('h3', '', `쓰거나 고친 메모 ${review.notes.length}`));
    const links = el('div', 'note-links');
    review.notes.slice(0, 100).forEach((n) => links.append(noteLink(n)));
    box.append(links);
    if (review.notes.length > 100) box.append(el('p', 'muted', `100개만 표시 (전체 ${review.notes.length}개)`));
    return box;
  }

  function openSection(review) {
    const box = el('section', 'review-section');
    box.append(el('h3', '', `남은 할 일 ${review.open.length}`));
    review.open.slice(0, 50).forEach(({ note, item }) => {
      const row = button('open-item', '', () => ctx.openNote(note.id));
      const text = el('span', 'done-text');
      text.append(el('span', '', item.text.trim()), el('small', '', N.noteTitle(note)));
      row.append(el('span', 'box'), text);
      box.append(row);
    });
    return box;
  }

  function render() {
    if (!range) return;
    const review = R.buildReview(ctx.state.data.notes, range);
    const scroll = el('div', 'panel-scroll');
    scroll.append(aiCard(review), stats(review)); // 주보 작성이 핵심이라 맨 위
    if (R.isEmptyReview(review)) {
      scroll.append(el('p', 'list-empty', '이 기간에는 기록이 없습니다.'));
    } else {
      if (range.kind === 'week') scroll.append(weekDays(review));
      else scroll.append(...yearMonths(review), notesSection(review));
      if (review.open.length) scroll.append(openSection(review));
    }
    const prev = root.querySelector('.panel-scroll')?.scrollTop ?? 0;
    root.replaceChildren(toolbar(review), scroll);
    scroll.scrollTop = prev;
  }

  return { open, render, refreshSettings };
}
