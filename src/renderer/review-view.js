// 오른쪽 영역의 "주간·연간 정리" 화면
//   - 통계와 기록 목록은 review.js 로 계산한다 (AI 없이 항상 동작).
//   - "AI 요약 만들기"는 main 프로세스(src/main/llm.js)를 거쳐 설정한 LLM에 요청한다.
import * as N from './notes.js';
import * as R from './review.js';
import { icon } from './icons.js';
import { $, el, button, dateFmt } from './dom.js';

export function createReviewView(ctx) {
  const root = $('review-panel');
  let range = null;
  let focus = null; // 사용자가 고른 날짜. 주간↔연간을 바꿔도 이 날짜를 기준으로 삼는다.
  let llm = null; // 화면용 AI 설정 (키 없음)
  let showPrompt = false;
  // 기간별 AI 요약 결과: key → { status: 'loading'|'done'|'error', text, error, truncated, ms }
  const summaries = new Map();
  const rangeKey = (r) => `${r.kind}:${r.start}`;

  const rangeFor = (kind, date) => (kind === 'week' ? R.weekRange(date) : R.yearRange(date.getFullYear()));

  async function open(kind, date) {
    focus = date;
    range = rangeFor(kind, date);
    showPrompt = false;
    render();
    llm = (await ctx.api.getSettings())?.llm ?? null;
    render();
  }

  function setRange(next) {
    // 이전/다음으로 기간을 옮기면 기준 날짜도 그 기간의 첫날로 옮긴다.
    if (next.kind === range.kind && next.start !== range.start) focus = next.anchor;
    range = next;
    showPrompt = false;
    render();
  }

  // ---------------------------------------------------------- 위쪽 도구 막대

  function toolbar(review) {
    const bar = el('div', 'panel-toolbar');
    const seg = el('div', 'segmented');
    for (const [kind, label] of [['week', '주간'], ['year', '연간']]) {
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
      title: '이 정리(와 AI 요약)를 메모로 저장합니다',
    });
    save.disabled = R.isEmptyReview(review);
    bar.append(seg, nav, el('span', 'spacer'), save, button('icon-btn', icon('close'), ctx.closePanel, { html: true, title: '닫기' }));
    return bar;
  }

  function saveAsNote(review) {
    const s = summaries.get(rangeKey(range));
    ctx.saveReviewAsNote(R.reviewNoteTitle(review), R.reviewNoteBody(review, s?.status === 'done' ? s.text : ''));
  }

  // ---------------------------------------------------------- 통계 · AI 요약

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

  async function summarize(review) {
    const key = rangeKey(range);
    summaries.set(key, { status: 'loading' });
    render();
    const { system, prompt } = R.summaryPrompt(review, { maxChars: llm?.maxPromptChars });
    const res = await ctx.api.llmComplete({ purpose: 'summary', request: { system, prompt } });
    summaries.set(
      key,
      res?.ok
        ? { status: 'done', text: res.text, truncated: res.truncated, ms: res.ms }
        : { status: 'error', error: res?.error ?? { message: '알 수 없는 오류' } },
    );
    if (range && rangeKey(range) === key) render();
  }

  function aiCard(review) {
    const card = el('section', 'ai-card');
    const head = el('div', 'ai-head');
    head.insertAdjacentHTML('beforeend', icon('sparkles'));
    head.append(el('strong', '', 'AI 요약'));
    card.append(head);

    if (!llm?.enabled) {
      card.append(el('p', 'muted', 'AI를 연결하면 이 기간의 기록을 문장으로 요약할 수 있습니다. 사내 LLM이나 Claude API를 설정에서 연결하세요.'));
      card.append(button('btn', 'AI 연결 설정 열기', ctx.openSettings));
      return card;
    }

    const where = llm.format === 'openai' ? hostOf(llm.baseURL) : llm.baseURL ? hostOf(llm.baseURL) : 'api.anthropic.com';
    head.append(el('span', 'muted', `${llm.model || '(모델 미설정)'} · ${where}`));

    const s = summaries.get(rangeKey(range));
    const actions = el('div', 'row-actions');
    const go = button('btn primary', s?.status === 'done' ? '다시 만들기' : 'AI 요약 만들기', () => summarize(review));
    go.disabled = s?.status === 'loading' || R.isEmptyReview(review);
    const peek = button('link-btn', showPrompt ? '보낼 내용 숨기기' : '보낼 내용 보기', () => {
      showPrompt = !showPrompt;
      render();
    });
    actions.append(go, peek);
    card.append(actions);

    if (showPrompt) {
      const { system, prompt } = R.summaryPrompt(review, { maxChars: llm?.maxPromptChars });
      card.append(
        el('p', 'muted', `아래 내용이 ${where} 로 전송됩니다. (${prompt.length.toLocaleString('ko-KR')}자)`),
        el('pre', 'prompt-preview', `[시스템]\n${system}\n\n[요청]\n${prompt}`),
      );
    }

    if (s?.status === 'loading') {
      card.append(el('p', 'muted loading', '요약하는 중… 서버에 따라 1~2분 걸릴 수 있습니다.'));
    } else if (s?.status === 'done') {
      card.append(el('div', 'ai-text', s.text));
      if (s.truncated) card.append(el('p', 'warn', '답변이 최대 출력 토큰에서 잘렸습니다. 설정 → 고급에서 늘릴 수 있습니다.'));
      card.append(el('p', 'muted', `${(s.ms / 1000).toFixed(1)}초 걸림 · "메모로 저장"하면 요약도 함께 저장됩니다.`));
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
    scroll.append(stats(review), aiCard(review));
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

  return { open, render };
}
