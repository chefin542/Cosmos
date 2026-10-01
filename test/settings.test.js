const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSettings, saveSettings, publicSettings } = require('../src/main/settings');
const { redact } = require('../src/main/logger');

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-settings-')), 'settings.json');

// Electron safeStorage 흉내 (뒤집어서 저장)
const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from([...s].reverse().join('')),
  decryptString: (b) => [...b.toString()].reverse().join(''),
};

test('API 키는 암호화해서 저장하고 다시 읽을 수 있다', () => {
  const f = file();
  saveSettings(f, { llm: { enabled: true, model: 'm', apiKey: 'sk-secret' } }, fakeSafe);
  const onDisk = fs.readFileSync(f, 'utf8');
  assert.ok(!onDisk.includes('sk-secret'));
  assert.equal(loadSettings(f, fakeSafe).llm.apiKey, 'sk-secret');
});

test('암호화를 못 쓰면 평문으로 저장한다', () => {
  const f = file();
  saveSettings(f, { llm: { apiKey: 'plain' } }, { isEncryptionAvailable: () => false });
  assert.equal(loadSettings(f, null).llm.apiKey, 'plain');
});

test('이상한 값은 기본값으로 바뀌고, 화면용 설정에는 키가 없다', () => {
  const f = file();
  fs.writeFileSync(f, JSON.stringify({ llm: { format: 'weird', maxTokens: 'many', model: 'm' } }));
  const s = loadSettings(f, fakeSafe);
  assert.equal(s.llm.format, 'anthropic');
  assert.equal(s.llm.maxTokens, 8192);
  assert.equal(s.llm.model, 'm');
  const pub = publicSettings({ llm: { ...s.llm, apiKey: 'k' } });
  assert.equal(pub.llm.hasKey, true);
  assert.equal(pub.llm.apiKey, undefined);
});

test('로그에 남기기 전에 비밀 값을 가린다', () => {
  assert.deepEqual(redact({ apiKey: 'a', nested: { Authorization: 'b', model: 'm' } }), {
    apiKey: '***',
    nested: { Authorization: '***', model: 'm' },
  });
});
