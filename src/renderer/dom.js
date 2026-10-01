// 작은 DOM 도우미

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className, content, onClick, { title, html = false } = {}) {
  const btn = el('button', className);
  btn.type = 'button';
  if (html) btn.innerHTML = content;
  else btn.textContent = content;
  if (title) btn.title = title;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

export const dateFmt = {
  time: new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' }),
  day: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }),
  dayWeek: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }),
  full: new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }),
  long: new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' }),
};
