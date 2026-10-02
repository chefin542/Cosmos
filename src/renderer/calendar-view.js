// 사이드바의 "달력" 탭: 월간 달력 + 고른 날짜의 기록 + 주간·연간 정리 버튼
import * as N from './notes.js';
import * as R from './review.js';
import { icon } from './icons.js';
import { $, el, button, dateFmt } from './dom.js';

const WEEK_HEAD = ['월', '화', '수', '목', '금', '토', '일'];

// 기록 건수 → 점 진하기 (0~3)
function level(count) {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

export function createCalendarView(ctx) {
  const root = $('calendar-panel');
  const today = () => N.dayKey(Date.now());
  let selected = today();
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  function selectDay(key) {
    selected = key;
    const d = R.parseDayKey(key);
    month = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
  }

  function moveMonth(delta) {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    render();
  }

  function header() {
    const head = el('div', 'cal-head');
    head.append(
      button('icon-btn', icon('left'), () => moveMonth(-1), { html: true, title: '이전 달' }),
      el('span', 'cal-title', `${month.getFullYear()}년 ${month.getMonth() + 1}월`),
      button('icon-btn', icon('right'), () => moveMonth(1), { html: true, title: '다음 달' }),
      button('cal-today', '오늘', () => selectDay(today())),
    );
    return head;
  }

  function grid(days) {
    const g = el('div', 'cal-grid');
    g.setAttribute('role', 'grid');
    WEEK_HEAD.forEach((w, i) => g.append(el('span', `cal-weekday${i === 6 ? ' sun' : i === 5 ? ' sat' : ''}`, w)));

    const first = R.startOfWeek(month);
    const lastOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const span = Math.round((lastOfMonth - first) / 86_400_000) + 1; // 첫 주 월요일 ~ 말일
    const cells = Math.ceil(span / 7) * 7;
    const todayKey = today();
    for (let i = 0; i < cells; i++) {
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      const key = N.dayKey(date);
      const count = R.activityCount(days.get(key));
      const cell = button('cal-day', '', () => selectDay(key));
      cell.dataset.day = key;
      cell.dataset.level = level(count);
      if (date.getMonth() !== month.getMonth()) cell.classList.add('outside');
      if (key === todayKey) cell.classList.add('today');
      if (key === selected) cell.setAttribute('aria-selected', 'true');
      if (date.getDay() === 0) cell.classList.add('sun');
      if (date.getDay() === 6) cell.classList.add('sat');
      cell.setAttribute('aria-label', `${dateFmt.dayWeek.format(date)}, 기록 ${count}건`);
      cell.append(el('span', 'num', String(date.getDate())), el('span', 'dot'));
      g.append(cell);
    }
    return g;
  }

  function dayDetail(days) {
    const entry = days.get(selected);
    const box = el('div', 'cal-detail');
    const date = R.parseDayKey(selected);
    const h = el('div', 'cal-detail-head');
    h.append(el('strong', '', dateFmt.dayWeek.format(date)));
    if (entry) h.append(el('span', 'count', `기록 ${R.activityCount(entry)}건`));
    box.append(h);

    // 그날의 메모: 있으면 열고, 없으면 그 날짜로 새로 만든다 (미래 날짜도 가능)
    const dayNote = N.notesForDate(ctx.state.data.notes, selected)[0];
    const future = selected > N.dayKey(Date.now());
    box.append(
      button(
        `day-memo-btn${dayNote ? ' has-note' : ''}`,
        dayNote ? `${icon('note')}<span>이 날 메모 열기</span>` : `${icon('plus')}<span>${future ? '이 날 메모 미리 쓰기' : '이 날 메모 쓰기'}</span>`,
        () => ctx.openDayMemo(selected),
        { html: true, title: dayNote ? N.noteTitle(dayNote) : '이 날짜로 지정된 메모를 만듭니다' },
      ),
    );

    if (!entry) {
      box.append(el('p', 'list-empty', '이 날은 기록이 없습니다.'));
      return box;
    }
    if (entry.notes.length) {
      box.append(el('div', 'list-heading', `메모 ${entry.notes.length}`));
      entry.notes.forEach((n) => box.append(ctx.noteItem(n)));
    }
    if (entry.done.length) {
      box.append(el('div', 'list-heading', `완료한 할 일 ${entry.done.length}`));
      for (const { note, item } of entry.done) {
        const row = button('done-item', '', () => ctx.openNote(note.id), { title: `'${N.noteTitle(note)}' 메모 열기` });
        row.insertAdjacentHTML('beforeend', icon('check'));
        const text = el('span', 'done-text');
        text.append(el('span', '', item.text.trim() || '(빈 항목)'), el('small', '', N.noteTitle(note)));
        row.append(text);
        box.append(row);
      }
    }
    return box;
  }

  function render() {
    const days = R.activityByDay(ctx.state.data.notes);
    const actions = el('div', 'cal-actions');
    actions.append(
      button('', `${icon('sparkles')}<span>주보</span>`, () => ctx.openReview('week', R.parseDayKey(selected)), {
        html: true,
        title: '고른 날짜가 속한 주의 주보를 엽니다',
      }),
      button('', `${icon('sparkles')}<span>연간 정리</span>`, () => ctx.openReview('year', R.parseDayKey(selected)), {
        html: true,
        title: '고른 날짜가 속한 해를 정리합니다',
      }),
    );
    const scroll = root.scrollTop;
    root.replaceChildren(actions, header(), grid(days), dayDetail(days));
    root.scrollTop = scroll;
  }

  // 날짜 목록의 메모를 누르면 연다 (ctx.noteItem 이 만든 버튼)
  root.addEventListener('click', (e) => {
    const item = e.target.closest('.note-item');
    if (item) ctx.openNote(item.dataset.id);
  });

  return { render, selectDay };
}
