// 오른쪽 영역의 "설정" 화면: 테마 · AI 연결 · 문제 해결
// API 키는 화면에 다시 보여 주지 않는다 (main 프로세스가 암호화해서 보관).
import { icon } from './icons.js';
import { $, el, button } from './dom.js';

const THEMES = [
  ['system', '시스템 설정'],
  ['light', '라이트'],
  ['dark', '다크'],
];

const URL_PLACEHOLDER = {
  anthropic: 'https://llm.회사.com  (비우면 https://api.anthropic.com)',
  openai: 'https://llm.회사.com/v1',
};

// 입력칸 하나면 <label for>로 묶고, 라디오 묶음 등은 이름표만 붙인다.
function field(label, control, hint) {
  const wrap = el('div', 'field');
  const lab = el('label', 'field-label', label);
  if (control.id) lab.htmlFor = control.id;
  wrap.append(lab, control);
  if (hint) wrap.append(el('span', 'field-hint', hint));
  return wrap;
}

function input(type, value, attrs = {}) {
  const i = document.createElement('input');
  i.type = type;
  i.value = value ?? '';
  Object.assign(i, attrs);
  return i;
}

function radios(name, options, value) {
  const box = el('div', 'radio-row');
  for (const [v, label] of options) {
    const lab = el('label', 'radio');
    const r = input('radio', v, { name, checked: v === value });
    lab.append(r, el('span', '', label));
    box.append(lab);
  }
  return box;
}

const radioValue = (root, name) => root.querySelector(`input[name="${name}"]:checked`)?.value;

export function createSettingsView(ctx) {
  const root = $('settings-panel');
  let llm = null;
  let status = null; // { kind: 'ok'|'error'|'busy', text, detail }

  async function open() {
    status = null;
    llm = (await ctx.api.getSettings())?.llm;
    render();
  }

  // 화면 입력값 → 설정 객체 (apiKey 가 빈 문자열이면 저장된 키를 유지)
  function collect() {
    const num = (id, min, max, d) => {
      const v = Number(root.querySelector(`#${id}`).value);
      return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
    };
    return {
      enabled: root.querySelector('#llm-enabled').checked,
      format: radioValue(root, 'llm-format'),
      baseURL: root.querySelector('#llm-url').value.trim(),
      authType: radioValue(root, 'llm-auth'),
      apiKey: root.querySelector('#llm-key').value.trim(),
      model: root.querySelector('#llm-model').value.trim(),
      extraHeaders: root.querySelector('#llm-headers').value,
      maxTokens: num('llm-max-tokens', 256, 128000, 8192),
      timeoutSec: num('llm-timeout', 10, 1800, 180),
    };
  }

  async function save() {
    const next = await ctx.api.saveSettings({ llm: collect() });
    llm = next.llm;
    status = { kind: 'ok', text: '저장했습니다.' };
    render();
  }

  async function clearKey() {
    if (!confirm('저장된 API 키를 지울까요?')) return;
    const next = await ctx.api.saveSettings({ llm: { ...collect(), apiKey: '', clearKey: true } });
    llm = next.llm;
    status = { kind: 'ok', text: 'API 키를 지웠습니다.' };
    render();
  }

  async function test() {
    const draft = collect();
    status = { kind: 'busy', text: '연결 테스트 중… (아직 저장하지 않은 입력값으로 시험합니다)' };
    renderStatus();
    const res = await ctx.api.llmComplete({ purpose: 'test', draft });
    status = res?.ok
      ? { kind: 'ok', text: `연결 성공 (${(res.ms / 1000).toFixed(1)}초, 모델: ${res.model ?? draft.model}) — 응답: "${res.text.slice(0, 80)}"` }
      : { kind: 'error', text: res?.error?.message ?? '알 수 없는 오류', detail: res?.error?.detail };
    renderStatus();
  }

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(await ctx.api.getDiagnostics());
    ctx.showToast('진단 정보를 복사했습니다. 메신저나 Claude Code에 붙여 넣으세요.');
  }

  function renderStatus() {
    const box = root.querySelector('#llm-status');
    if (!box) return;
    box.replaceChildren();
    box.className = `status ${status?.kind ?? ''}`;
    if (!status) return;
    box.append(el('span', '', status.text));
    if (status.detail) {
      const d = el('details');
      d.append(el('summary', '', '자세한 내용'), el('pre', '', status.detail));
      box.append(d);
    }
  }

  function themeSection() {
    const sec = el('section', 'settings-section');
    sec.append(el('h3', '', '화면'));
    const seg = el('div', 'segmented');
    for (const [value, label] of THEMES) {
      // 다시 그리지 않는다 — 저장하지 않은 AI 설정 입력값이 사라지지 않게.
      const b = button('', label, () => {
        ctx.setTheme(value);
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      b.setAttribute('aria-pressed', String(ctx.state.data.prefs.theme === value));
      seg.append(b);
    }
    sec.append(field('테마', seg));
    return sec;
  }

  function llmSection() {
    const sec = el('section', 'settings-section');
    sec.append(
      el('h3', '', 'AI 연결'),
      el('p', 'muted', '주간·연간 정리를 문장으로 요약할 때 씁니다. 요약을 요청하면 그 기간의 메모 내용이 아래 서버로 전송됩니다.'),
    );

    const enabled = el('label', 'switch');
    enabled.append(input('checkbox', '', { id: 'llm-enabled', checked: llm.enabled }), el('span', '', 'AI 요약 사용'));
    sec.append(enabled);

    const format = radios('llm-format', [['anthropic', 'Anthropic (Claude) 형식'], ['openai', 'OpenAI 호환 형식']], llm.format);
    sec.append(field('API 형식', format, 'Claude Code가 붙는 사내 LLM이라면 대부분 Anthropic 형식입니다.'));

    const url = input('url', llm.baseURL, { id: 'llm-url', placeholder: URL_PLACEHOLDER[llm.format], spellcheck: false });
    sec.append(field('서버 주소', url, 'Anthropic 형식은 주소 끝에 /v1을 붙이지 않습니다. OpenAI 호환 형식은 보통 /v1까지 씁니다.'));
    format.addEventListener('change', () => (url.placeholder = URL_PLACEHOLDER[radioValue(root, 'llm-format')]));

    const auth = radios('llm-auth', [['x-api-key', 'x-api-key 헤더'], ['bearer', 'Authorization: Bearer']], llm.authType);
    sec.append(field('인증 방식', auth));

    const keyRow = el('div', 'inline');
    const key = input('password', '', {
      id: 'llm-key',
      placeholder: llm.hasKey ? '저장됨 — 바꾸려면 새 키를 입력' : 'API 키 또는 토큰',
      autocomplete: 'off',
    });
    keyRow.append(key);
    if (llm.hasKey) keyRow.append(button('link-btn', '키 지우기', clearKey));
    sec.append(field('API 키', keyRow, '운영체제 보안 저장소로 암호화해서 이 PC에만 저장합니다.'));

    sec.append(field('모델', input('text', llm.model, { id: 'llm-model', placeholder: '예: claude-opus-5-5', spellcheck: false })));

    const adv = el('details', 'advanced');
    adv.append(el('summary', '', '고급 설정'));
    const headers = el('textarea');
    headers.id = 'llm-headers';
    headers.rows = 3;
    headers.spellcheck = false;
    headers.placeholder = 'X-Team-Id: my-team';
    headers.value = llm.extraHeaders;
    adv.append(
      field('추가 헤더', headers, '한 줄에 하나씩 "이름: 값". 사내 게이트웨이가 요구하는 헤더가 있을 때만 씁니다.'),
      field('최대 출력 토큰', input('number', llm.maxTokens, { id: 'llm-max-tokens', min: 256, max: 128000, step: 256 })),
      field('시간 제한(초)', input('number', llm.timeoutSec, { id: 'llm-timeout', min: 10, max: 1800 })),
    );
    sec.append(adv);

    const actions = el('div', 'row-actions');
    actions.append(button('btn primary', '저장', save), button('btn', '연결 테스트', test));
    sec.append(actions, el('div', 'status', ''));
    sec.lastChild.id = 'llm-status';

    const help = el('details', 'help-box');
    help.append(el('summary', '', '사내 Claude Code 설정을 그대로 옮기는 방법'));
    const table = el('table', 'map-table');
    for (const [envName, where] of [
      ['ANTHROPIC_BASE_URL', '서버 주소 (형식: Anthropic)'],
      ['ANTHROPIC_AUTH_TOKEN', 'API 키 + 인증 방식 "Authorization: Bearer"'],
      ['ANTHROPIC_API_KEY', 'API 키 + 인증 방식 "x-api-key"'],
      ['ANTHROPIC_MODEL', '모델'],
      ['ANTHROPIC_CUSTOM_HEADERS', '고급 설정 → 추가 헤더'],
    ]) {
      const tr = el('tr');
      tr.append(el('td', 'mono', envName), el('td', '', where));
      table.append(tr);
    }
    help.append(
      el('p', 'muted', 'Claude Code 설정 파일(~/.claude/settings.json의 "env")이나 환경 변수에서 아래 값을 찾아 옮기면 됩니다.'),
      table,
    );
    sec.append(help);
    return sec;
  }

  function troubleSection() {
    const sec = el('section', 'settings-section');
    sec.append(el('h3', '', '문제 해결'));
    const actions = el('div', 'row-actions');
    actions.append(button('btn', '로그 폴더 열기', () => ctx.api.openLogs()), button('btn', '진단 정보 복사', copyDiagnostics));
    sec.append(
      actions,
      el(
        'p',
        'muted',
        'F12: 개발자 도구 · 진단 정보에는 API 키가 들어가지 않습니다. 개발자용 안내는 저장소의 CLAUDE.md를 참고하세요.',
      ),
    );
    return sec;
  }

  function render() {
    if (!llm) return;
    const bar = el('div', 'panel-toolbar');
    const title = el('div', 'panel-title');
    title.insertAdjacentHTML('beforeend', icon('settings'));
    title.append(el('strong', '', '설정'));
    bar.append(title, el('span', 'spacer'), button('icon-btn', icon('close'), ctx.closePanel, { html: true, title: '닫기' }));
    const scroll = el('div', 'panel-scroll');
    scroll.append(themeSection(), llmSection(), troubleSection());
    root.replaceChildren(bar, scroll);
    renderStatus();
  }

  return { open };
}
