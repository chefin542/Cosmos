// 설정 파일(settings.json) 읽기/쓰기.
// API 키는 운영체제 보안 저장소(Electron safeStorage)로 암호화해서 apiKeyEnc 에 저장한다.
// 암호화를 쓸 수 없는 환경이면 apiKeyPlain 에 평문으로 저장한다.
const { readJson, writeJson } = require('./store');
const { DEFAULT_LLM } = require('./llm');

function decryptKey(llm, safeStorage) {
  if (llm.apiKeyEnc && safeStorage?.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(llm.apiKeyEnc, 'base64'));
    } catch {
      return '';
    }
  }
  return typeof llm.apiKeyPlain === 'string' ? llm.apiKeyPlain : '';
}

function pickLlm(raw = {}) {
  const out = { ...DEFAULT_LLM };
  for (const key of Object.keys(DEFAULT_LLM)) {
    if (typeof raw[key] === typeof DEFAULT_LLM[key]) out[key] = raw[key];
  }
  if (!['anthropic', 'openai'].includes(out.format)) out.format = DEFAULT_LLM.format;
  if (!['x-api-key', 'bearer'].includes(out.authType)) out.authType = DEFAULT_LLM.authType;
  return out;
}

// 반환값의 llm.apiKey 는 복호화된 평문 키다. 화면(렌더러)에는 절대 그대로 보내지 않는다.
function loadSettings(file, safeStorage) {
  const raw = readJson(file, {}) || {};
  const llm = pickLlm(raw.llm);
  llm.apiKey = decryptKey(raw.llm || {}, safeStorage);
  return { llm };
}

function saveSettings(file, settings, safeStorage) {
  const { apiKey = '', ...rest } = settings.llm;
  const llm = pickLlm(rest);
  if (apiKey) {
    if (safeStorage?.isEncryptionAvailable()) {
      llm.apiKeyEnc = safeStorage.encryptString(apiKey).toString('base64');
    } else {
      llm.apiKeyPlain = apiKey;
    }
  }
  writeJson(file, { llm });
}

// 화면에 보내는 설정: API 키 대신 "저장된 키가 있는지"만 알려 준다.
function publicSettings(settings) {
  const { apiKey, ...llm } = settings.llm;
  return { llm: { ...llm, hasKey: Boolean(apiKey) } };
}

module.exports = { loadSettings, saveSettings, publicSettings, pickLlm };
