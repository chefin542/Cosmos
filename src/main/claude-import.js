// "Claude Code 설정 가져오기": 이 PC의 Claude 설정에서 AI 연결 정보를 찾는다.
//
// 찾아보는 곳 (뒤에 오는 것이 앞의 값을 덮어쓴다 — 실제 적용 우선순위 순서)
//   1. 환경 변수                ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ...
//   2. Claude Code 사용자 설정  ~/.claude/settings.json 의 "env", "model"
//   3. Claude Code 관리자 설정  managed-settings.json (Windows: C:\Program Files\ClaudeCode\)
//   4. Claude 데스크톱 앱 (회사 서버 연결 모드, "3P")
//        로컬 설정: %LOCALAPPDATA%\Claude-3p\configLibrary\<id>.json  (앱의 설정 창이 저장)
//        관리자 설정: Windows 레지스트리 HKCU/HKLM\SOFTWARE\Policies\Claude, Linux /etc/claude-desktop/managed-settings.json
//      키 이름: inferenceProvider, inferenceGatewayBaseUrl, inferenceGatewayApiKey,
//               inferenceGatewayAuthScheme(기본 bearer), inferenceModels, inferenceCustomHeaders
//      참고: https://claude.com/docs/third-party/claude-desktop/configuration
//
// 파일 시스템·환경 변수·레지스트리 읽기는 deps 로 받아서 테스트할 수 있게 했다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function defaultDeps() {
  return {
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    listDir: (p) => fs.readdirSync(p),
    mtime: (p) => fs.statSync(p).mtimeMs,
    readRegistry: (key) => execFileSync('reg', ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 5000 }),
    readPlist: (p) => execFileSync('plutil', ['-convert', 'json', '-o', '-', p], { encoding: 'utf8', timeout: 5000 }),
  };
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// reg query 출력에서 REG_SZ / REG_DWORD 값만 꺼낸다.
function parseRegQuery(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s+(\S+)\s+(REG_SZ|REG_DWORD)\s+(.*)$/);
    if (m) out[m[1]] = m[2] === 'REG_DWORD' ? String(parseInt(m[3], 16)) : m[3].trim();
  }
  return out;
}

// 키 값을 화면에 보여 줄 때: 끝 4자리만
function maskKey(key) {
  return key ? `…${key.slice(-4)}` : '';
}

// 모델 목록 값은 JSON 문자열일 수도, 배열일 수도, ["id"] 또는 [{ name }] 일 수도 있다.
function modelNames(value) {
  const list = typeof value === 'string' ? tryJson(value) : value;
  if (!Array.isArray(list)) return [];
  return list.map((m) => (typeof m === 'string' ? m : m?.name || m?.id)).filter((m) => typeof m === 'string' && m);
}

function headersText(value) {
  const obj = typeof value === 'string' ? tryJson(value) ?? value : value;
  if (typeof obj === 'string') return obj; // 이미 "이름: 값" 형식
  if (obj && typeof obj === 'object') return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('\n');
  return '';
}

function importClaudeSettings(deps = defaultDeps()) {
  const found = { format: 'anthropic' };
  const models = [];
  const sources = []; // 화면에 보여 줄 "어디서 무엇을 찾았는지"
  const notes = [];

  function apply(where, values) {
    const got = [];
    if (values.baseURL) {
      found.baseURL = values.baseURL;
      got.push('서버 주소');
    }
    if (values.apiKey) {
      found.apiKey = values.apiKey;
      found.authType = values.authType;
      got.push(`API 키(${maskKey(values.apiKey)}, ${values.authType === 'bearer' ? 'Bearer' : 'x-api-key'})`);
    } else if (values.authType && found.apiKey === undefined) {
      found.authType = values.authType;
    }
    if (values.model) {
      found.model = values.model;
      got.push(`모델(${values.model})`);
    }
    if (values.models?.length) {
      for (const m of values.models) if (!models.includes(m)) models.push(m);
      got.push(`모델 목록 ${values.models.length}개`);
    }
    if (values.extraHeaders) {
      found.extraHeaders = values.extraHeaders;
      got.push('추가 헤더');
    }
    if (got.length) sources.push({ where, got });
  }

  // Claude Code 형식 (환경 변수 이름)
  function fromClaudeCodeEnv(env = {}, topModel) {
    const v = {};
    if (env.ANTHROPIC_BASE_URL) v.baseURL = env.ANTHROPIC_BASE_URL;
    if (env.ANTHROPIC_AUTH_TOKEN) {
      v.apiKey = env.ANTHROPIC_AUTH_TOKEN;
      v.authType = 'bearer';
    } else if (env.ANTHROPIC_API_KEY) {
      v.apiKey = env.ANTHROPIC_API_KEY;
      v.authType = 'x-api-key';
    }
    v.model = env.ANTHROPIC_MODEL || topModel;
    v.models = [
      env.ANTHROPIC_MODEL,
      env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      env.ANTHROPIC_SMALL_FAST_MODEL,
      topModel,
    ].filter((m, i, a) => m && a.indexOf(m) === i);
    // 별칭(sonnet, opus 등)은 실제 모델 이름이 아니므로 기본 모델로 쓰지 않는다.
    if (v.model && /^(sonnet|opus|haiku|default|best|opusplan)(\[1m\])?$/i.test(v.model)) {
      v.model = env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || undefined;
    }
    if (env.ANTHROPIC_CUSTOM_HEADERS) v.extraHeaders = headersText(env.ANTHROPIC_CUSTOM_HEADERS);
    return v;
  }

  function fromClaudeCodeSettings(file, label) {
    let text;
    try {
      text = deps.readFile(file);
    } catch {
      return;
    }
    const json = tryJson(text);
    if (!json) {
      notes.push(`${label}(${file})를 읽었지만 JSON 형식이 아닙니다.`);
      return;
    }
    apply(`${label} — ${file}`, fromClaudeCodeEnv(json.env || {}, typeof json.model === 'string' ? json.model : undefined));
    if (json.apiKeyHelper) notes.push(`${label}에서 apiKeyHelper(키를 프로그램으로 받는 방식)를 씁니다. API 키는 직접 넣어 주세요.`);
  }

  // Claude 데스크톱 앱 형식 (inference* 키)
  function fromDesktopConfig(cfg, where) {
    if (!cfg || typeof cfg !== 'object') return;
    // 로컬 설정 파일은 키가 한 단계 안에 들어 있을 수도 있어 inferenceProvider 가 있는 객체를 찾는다.
    const find = (o, depth = 0) => {
      if (!o || typeof o !== 'object' || depth > 3) return null;
      if ('inferenceProvider' in o || 'inferenceGatewayBaseUrl' in o) return o;
      for (const v of Object.values(o)) {
        const hit = find(v, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    const c = find(cfg);
    if (!c) return;
    const v = {};
    if (c.inferenceProvider && !['gateway', 'anthropic'].includes(c.inferenceProvider)) {
      notes.push(`${where}: 연결 방식이 "${c.inferenceProvider}"입니다. 이 메모장은 사내 게이트웨이(gateway)와 Anthropic API만 지원합니다.`);
    }
    if (c.inferenceGatewayBaseUrl) v.baseURL = c.inferenceGatewayBaseUrl;
    v.authType = c.inferenceGatewayAuthScheme === 'x-api-key' ? 'x-api-key' : 'bearer';
    if (c.inferenceGatewayApiKey) v.apiKey = c.inferenceGatewayApiKey;
    v.models = modelNames(c.inferenceModels);
    v.model = v.models[0];
    if (c.inferenceCustomHeaders) v.extraHeaders = headersText(c.inferenceCustomHeaders);
    if (c.inferenceCredentialKind || c.inferenceCredentialHelper || c.inferenceGatewayOidc) {
      notes.push(`${where}: 키 대신 사내 로그인(SSO)이나 키 발급 프로그램을 쓰는 설정입니다. 받은 API 키가 있으면 직접 넣어 주세요.`);
    }
    apply(where, v);
  }

  function desktopLocalLibrary(dir) {
    let files;
    try {
      files = deps.listDir(dir).filter((f) => f.endsWith('.json') && f !== '_meta.json');
    } catch {
      return;
    }
    if (!files.length) return;
    // _meta.json 에 "적용 중인 설정" id 가 있다. 형식이 바뀌어도 되도록 파일 이름과 일치하는 문자열을 찾는다.
    let chosen = null;
    try {
      const metaText = deps.readFile(path.join(dir, '_meta.json'));
      chosen = files.find((f) => metaText.includes(`"${f.replace(/\.json$/, '')}"`));
    } catch {}
    if (!chosen) {
      chosen = files.slice().sort((a, b) => {
        try {
          return deps.mtime(path.join(dir, b)) - deps.mtime(path.join(dir, a));
        } catch {
          return 0;
        }
      })[0];
    }
    try {
      fromDesktopConfig(tryJson(deps.readFile(path.join(dir, chosen))), `Claude 데스크톱 앱 설정 — ${path.join(dir, chosen)}`);
    } catch {}
  }

  const { env, platform, home } = deps;

  // 1. 환경 변수
  apply('환경 변수', fromClaudeCodeEnv(env));

  // 2~3. Claude Code 설정 파일
  fromClaudeCodeSettings(path.join(home, '.claude', 'settings.json'), 'Claude Code 사용자 설정');
  const managed = {
    win32: ['C:\\Program Files\\ClaudeCode\\managed-settings.json'],
    darwin: ['/Library/Application Support/ClaudeCode/managed-settings.json'],
    linux: ['/etc/claude-code/managed-settings.json'],
  }[platform] || [];
  managed.forEach((f) => fromClaudeCodeSettings(f, 'Claude Code 관리자 설정'));

  // 4. Claude 데스크톱 앱 — 로컬 설정 다음에 관리자 설정 (관리자 설정이 이긴다)
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    desktopLocalLibrary(path.join(local, 'Claude-3p', 'configLibrary'));
    // HKLM(PC 전체) 정책이 있으면 HKCU(사용자) 정책은 무시된다.
    let policy = null;
    for (const key of ['HKLM\\SOFTWARE\\Policies\\Claude', 'HKCU\\SOFTWARE\\Policies\\Claude']) {
      try {
        const values = parseRegQuery(deps.readRegistry(key));
        if (Object.keys(values).length) {
          policy = { key, values };
          break;
        }
      } catch {}
    }
    if (policy) fromDesktopConfig(policy.values, `Claude 데스크톱 앱 관리자 정책 — 레지스트리 ${policy.key}`);
  } else if (platform === 'darwin') {
    desktopLocalLibrary(path.join(home, 'Library', 'Application Support', 'Claude-3p', 'configLibrary'));
    const user = path.basename(home);
    try {
      const plist = `/Library/Managed Preferences/${user}/com.anthropic.claudefordesktop.plist`;
      fromDesktopConfig(tryJson(deps.readPlist(plist)), `Claude 데스크톱 앱 관리자 프로필 — ${plist}`);
    } catch {}
  } else {
    desktopLocalLibrary(path.join(home, '.config', 'Claude-3p', 'configLibrary'));
    try {
      const f = '/etc/claude-desktop/managed-settings.json';
      fromDesktopConfig(tryJson(deps.readFile(f)), `Claude 데스크톱 앱 관리자 설정 — ${f}`);
    } catch {}
  }

  if (found.model === undefined && models.length) found.model = models[0];
  return { found, models, sources, notes };
}

module.exports = { importClaudeSettings, parseRegQuery, maskKey };
