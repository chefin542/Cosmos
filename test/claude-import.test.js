const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { importClaudeSettings, parseRegQuery, maskKey } = require('../src/main/claude-import');

// 가짜 파일 시스템: { 경로: 내용 }
function deps({ files = {}, env = {}, platform = 'win32', registry = {}, home = 'C:\\Users\\me' } = {}) {
  const norm = (p) => p.replace(/\\/g, '/');
  const table = Object.fromEntries(Object.entries(files).map(([k, v]) => [norm(k), v]));
  return {
    env,
    platform,
    home,
    readFile: (p) => {
      if (!(norm(p) in table)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return table[norm(p)];
    },
    listDir: (dir) => {
      const prefix = `${norm(dir)}/`;
      const names = Object.keys(table).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
      if (!names.length) throw new Error('ENOENT');
      return names;
    },
    mtime: () => 0,
    readRegistry: (key) => {
      if (!(key in registry)) throw new Error('not found');
      return registry[key];
    },
    readPlist: () => {
      throw new Error('no plist');
    },
  };
}

test('Claude Code 사용자 설정(~/.claude/settings.json)의 env 를 읽는다', () => {
  const settings = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: 'https://llm.corp.com',
      ANTHROPIC_AUTH_TOKEN: 'tok-1234',
      ANTHROPIC_MODEL: 'corp-large',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'corp-small',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Team: a',
    },
  });
  const r = importClaudeSettings(deps({ files: { [path.join('C:\\Users\\me', '.claude', 'settings.json')]: settings } }));
  assert.deepEqual(r.found, {
    format: 'anthropic',
    baseURL: 'https://llm.corp.com',
    apiKey: 'tok-1234',
    authType: 'bearer',
    model: 'corp-large',
    extraHeaders: 'X-Team: a',
  });
  assert.deepEqual(r.models, ['corp-large', 'corp-small']);
  assert.match(r.sources[0].where, /Claude Code 사용자 설정/);
  assert.ok(r.sources[0].got.some((g) => g.includes('…1234')));
  assert.ok(!JSON.stringify(r.sources).includes('tok-1234'));
});

test('환경 변수 → 사용자 설정 → 관리자 설정 순서로 덮어쓴다', () => {
  const r = importClaudeSettings(
    deps({
      env: { ANTHROPIC_BASE_URL: 'https://env', ANTHROPIC_API_KEY: 'k-env', ANTHROPIC_MODEL: 'm-env' },
      files: {
        'C:\\Users\\me\\.claude\\settings.json': JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://user' } }),
        'C:\\Program Files\\ClaudeCode\\managed-settings.json': JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://managed' } }),
      },
    }),
  );
  assert.equal(r.found.baseURL, 'https://managed');
  assert.equal(r.found.apiKey, 'k-env');
  assert.equal(r.found.authType, 'x-api-key');
  assert.equal(r.found.model, 'm-env');
  assert.equal(r.sources.length, 3);
});

test('모델 별칭(sonnet 등)은 기본 모델로 쓰지 않는다', () => {
  const r = importClaudeSettings(
    deps({ files: { 'C:\\Users\\me\\.claude\\settings.json': JSON.stringify({ model: 'sonnet', env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'corp-mid' } }) } }),
  );
  assert.equal(r.found.model, 'corp-mid');
});

test('Claude 데스크톱 앱의 로컬 설정(configLibrary)에서 게이트웨이 설정을 읽는다', () => {
  const lib = 'C:\\Users\\me\\AppData\\Local\\Claude-3p\\configLibrary';
  const r = importClaudeSettings(
    deps({
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      files: {
        [`${lib}\\_meta.json`]: JSON.stringify({ appliedId: 'cfg-b' }),
        [`${lib}\\cfg-a.json`]: JSON.stringify({ inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'https://old' }),
        [`${lib}\\cfg-b.json`]: JSON.stringify({
          name: '회사',
          config: {
            inferenceProvider: 'gateway',
            inferenceGatewayBaseUrl: 'https://gw.corp/v1',
            inferenceGatewayApiKey: 'sk-gw-9999',
            inferenceModels: '["corp-a", {"name": "corp-b", "supports1m": true}]',
            inferenceCustomHeaders: { 'X-Tenant-Id': 'acme' },
          },
        }),
      },
    }),
  );
  assert.equal(r.found.baseURL, 'https://gw.corp/v1');
  assert.equal(r.found.apiKey, 'sk-gw-9999');
  assert.equal(r.found.authType, 'bearer'); // 데스크톱 앱 게이트웨이의 기본값
  assert.equal(r.found.model, 'corp-a');
  assert.deepEqual(r.models, ['corp-a', 'corp-b']);
  assert.equal(r.found.extraHeaders, 'X-Tenant-Id: acme');
  assert.match(r.sources[0].where, /cfg-b\.json/);
});

test('Windows 레지스트리 정책: HKLM 이 있으면 HKCU 는 무시한다', () => {
  const reg = (url) => `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Claude\r\n    inferenceProvider    REG_SZ    gateway\r\n    inferenceGatewayBaseUrl    REG_SZ    ${url}\r\n    inferenceGatewayAuthScheme    REG_SZ    x-api-key\r\n`;
  const r = importClaudeSettings(
    deps({ registry: { 'HKLM\\SOFTWARE\\Policies\\Claude': reg('https://machine'), 'HKCU\\SOFTWARE\\Policies\\Claude': reg('https://user') } }),
  );
  assert.equal(r.found.baseURL, 'https://machine');
  assert.equal(r.found.authType, 'x-api-key');
  assert.equal(r.found.apiKey, undefined);
  assert.deepEqual(parseRegQuery('    a    REG_DWORD    0x1\n    b    REG_SZ    x y\n'), { a: '1', b: 'x y' });
});

test('키 대신 사내 로그인을 쓰는 설정이면 안내를 남긴다', () => {
  const r = importClaudeSettings(
    deps({
      platform: 'linux',
      home: '/home/me',
      files: { '/etc/claude-desktop/managed-settings.json': JSON.stringify({ inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'https://gw', inferenceCredentialKind: 'interactive' }) },
    }),
  );
  assert.equal(r.found.baseURL, 'https://gw');
  assert.ok(r.notes.some((n) => /사내 로그인/.test(n)));
});

test('아무것도 없으면 빈 결과', () => {
  const r = importClaudeSettings(deps());
  assert.deepEqual(r.sources, []);
  assert.equal(r.found.baseURL, undefined);
  assert.equal(maskKey('abcdef'), '…cdef');
});
