// LLM 연결 (주간·연간 정리의 AI 요약용).
//
// 지원하는 API 형식
//   - 'anthropic': Anthropic Messages API (POST {baseURL}/v1/messages)
//       공식 Claude API, 그리고 Claude Code가 붙는 사내 LLM 게이트웨이(ANTHROPIC_BASE_URL)가 이 형식이다.
//       baseURL 끝에 /v1 을 붙이지 않는다 (SDK가 붙인다).
//   - 'openai': OpenAI 호환 Chat Completions API (POST {baseURL}/chat/completions)
//       vLLM, Ollama, LiteLLM 등 많은 사내 LLM이 이 형식이다. baseURL은 보통 /v1 까지 포함한다.
//
// 이 파일은 electron을 직접 불러오지 않는다. 네트워크 함수(fetch)를 밖에서 받아서
// 앱에서는 Electron의 net.fetch(시스템 프록시·인증서 사용)를, 테스트에서는 Node fetch를 쓴다.
const Anthropic = require('@anthropic-ai/sdk').default;

const DEFAULT_LLM = {
  enabled: false,
  format: 'anthropic', // 'anthropic' | 'openai'
  baseURL: '', // 비우면 공식 API (https://api.anthropic.com)
  authType: 'x-api-key', // 'x-api-key' | 'bearer'
  model: '',
  maxTokens: 8192,
  timeoutSec: 180,
  extraHeaders: '', // 한 줄에 하나씩 "이름: 값"
  // 정리 요약 때 한 번에 보내는 최대 글자 수. 사내 오픈 모델은 받을 수 있는 양(컨텍스트)이 작은 경우가 많다.
  maxPromptChars: 20000,
};

const OFFICIAL_ANTHROPIC_URL = 'https://api.anthropic.com';

// 주소 끝에 경로를 더 붙여 넣은 경우를 바로잡는다.
//   anthropic: SDK가 /v1/messages 를 붙이므로 끝의 /v1, /v1/messages 를 뗀다
//              (Claude 데스크톱 앱 설정에는 /v1 까지 적혀 있는 경우가 있다)
//   openai:    /chat/completions 를 붙이므로 그 부분을 뗀다
function normalizeBaseURL(format, url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (format === 'openai') return u.replace(/\/chat\/completions$/i, '');
  u = u.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '').replace(/\/v1$/i, '');
  return u;
}

// 추론(생각) 모델이 답 앞에 붙이는 <think>…</think> 를 지운다 (Qwen, DeepSeek 등).
// 여는 태그 없이 </think> 만 오는 경우도 있어 마지막 </think> 뒤만 남긴다.
function stripThinking(text) {
  let t = String(text || '').replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '');
  const close = t.search(/<\/(think|thinking)>(?![\s\S]*<\/(think|thinking)>)/i);
  if (close !== -1) t = t.slice(t.indexOf('>', close) + 1);
  return t.trim();
}

class LlmError extends Error {
  // kind: config | auth | not_found | bad_request | rate_limit | server | network | timeout | refusal | bad_response
  constructor(kind, message, { status = null, detail = '' } = {}) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
    this.detail = String(detail || '').slice(0, 2000);
  }

  toJSON() {
    return { kind: this.kind, message: this.message, status: this.status, detail: this.detail };
  }
}

function parseExtraHeaders(text) {
  const headers = {};
  for (const [i, raw] of String(text || '').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) {
      throw new LlmError('config', `추가 헤더 ${i + 1}번째 줄 형식이 잘못되었습니다. "이름: 값" 형태로 써 주세요.`);
    }
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function validate(llm) {
  if (!llm.model.trim()) throw new LlmError('config', '모델 이름을 입력하세요.');
  if (!llm.apiKey) throw new LlmError('config', 'API 키를 입력하세요.');
  if (llm.format === 'openai' && !llm.baseURL.trim()) {
    throw new LlmError('config', 'OpenAI 호환 형식은 서버 주소가 필요합니다.');
  }
  if (llm.baseURL.trim() && !/^https?:\/\//i.test(llm.baseURL.trim())) {
    throw new LlmError('config', '서버 주소는 http:// 또는 https:// 로 시작해야 합니다.');
  }
}

// 로그와 진단 정보에 남겨도 되는 설정 요약 (키 값은 넣지 않는다)
function describe(llm) {
  let headerNames = [];
  try {
    headerNames = Object.keys(parseExtraHeaders(llm.extraHeaders));
  } catch {
    headerNames = ['(형식 오류)'];
  }
  return {
    format: llm.format,
    baseURL: llm.baseURL || (llm.format === 'anthropic' ? `${OFFICIAL_ANTHROPIC_URL} (기본값)` : ''),
    authType: llm.authType,
    model: llm.model,
    maxTokens: llm.maxTokens,
    timeoutSec: llm.timeoutSec,
    hasApiKey: Boolean(llm.apiKey),
    extraHeaderNames: headerNames,
  };
}

const HINT = {
  auth: '인증에 실패했습니다. API 키와 인증 방식(Bearer / x-api-key)을 확인하세요.',
  not_found:
    '주소나 모델을 찾을 수 없습니다. 서버 주소, API 형식, 모델 이름을 확인하세요. (Anthropic 형식은 주소 끝에 /v1을 붙이지 않습니다)',
  bad_request: '서버가 요청을 거절했습니다. 모델 이름과 최대 출력 토큰 설정을 확인하세요.',
  too_long: "보낼 내용이 모델이 한 번에 받을 수 있는 양보다 많습니다. 고급 설정에서 '최대 전송 글자 수'나 '최대 출력 토큰'을 줄이세요.",
  rate_limit: '요청이 너무 많거나 사용 한도를 넘었습니다. 잠시 후 다시 시도하세요.',
  server: '서버 쪽 오류입니다. 잠시 후 다시 시도하세요.',
};

// 400 중에서 "입력이 너무 길다"는 오류는 따로 안내한다.
function httpError(status, detail) {
  let kind = kindForStatus(status);
  let hint = HINT[kind];
  if (kind === 'bad_request' && /context|too long|maximum.*(length|token)|token.*(limit|exceed)|max_tokens/i.test(detail)) {
    hint = HINT.too_long;
  }
  return new LlmError(kind, `${hint} (HTTP ${status})`, { status, detail });
}

function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function networkError(err) {
  const cause = err.cause?.message || err.cause?.code || err.message || '';
  if (/certificate|CERT|SSL|TLS/i.test(cause)) {
    return new LlmError('network', '보안 인증서 문제로 연결하지 못했습니다. 사내 인증서·프록시 설정을 확인하세요.', { detail: cause });
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED/i.test(cause)) {
    return new LlmError('network', '서버 주소를 찾을 수 없습니다. 주소 철자와 사내망(VPN) 연결을 확인하세요.', { detail: cause });
  }
  return new LlmError('network', `서버에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.`, { detail: cause });
}

function timeoutError(timeoutSec) {
  return new LlmError('timeout', `${timeoutSec}초 안에 응답이 없어 중단했습니다. 고급 설정에서 시간 제한을 늘릴 수 있습니다.`);
}

function anthropicClient(llm, fetchImpl) {
  return new Anthropic({
    // null 을 명시해야 환경 변수(ANTHROPIC_API_KEY 등)를 몰래 읽지 않는다.
    apiKey: llm.authType === 'x-api-key' ? llm.apiKey : null,
    authToken: llm.authType === 'bearer' ? llm.apiKey : null,
    baseURL: normalizeBaseURL('anthropic', llm.baseURL) || OFFICIAL_ANTHROPIC_URL,
    defaultHeaders: parseExtraHeaders(llm.extraHeaders),
    timeout: llm.timeoutSec * 1000,
    maxRetries: 1,
    fetch: fetchImpl,
  });
}

function mapSdkError(err, llm) {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return timeoutError(llm.timeoutSec);
  if (err instanceof Anthropic.APIConnectionError) return networkError(err, llm.timeoutSec);
  if (err instanceof Anthropic.APIError && err.status) return httpError(err.status, err.message);
  return err;
}

async function completeAnthropic(llm, { system, prompt }, fetchImpl) {
  const client = anthropicClient(llm, fetchImpl);
  let res;
  try {
    res = await client.messages.create({
      model: llm.model.trim(),
      max_tokens: llm.maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw mapSdkError(err, llm);
  }

  if (res.stop_reason === 'refusal') {
    throw new LlmError('refusal', '모델이 이 요청에 답하지 않았습니다.', { detail: JSON.stringify(res.stop_details ?? '') });
  }
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { text, model: res.model, stopReason: res.stop_reason, truncated: res.stop_reason === 'max_tokens', usage: res.usage };
}

function openAiHeaders(llm) {
  const headers = { 'content-type': 'application/json', ...parseExtraHeaders(llm.extraHeaders) };
  if (llm.authType === 'bearer') headers.authorization = `Bearer ${llm.apiKey}`;
  else headers['x-api-key'] = llm.apiKey;
  return headers;
}

async function completeOpenAi(llm, { system, prompt }, fetchImpl) {
  const url = `${normalizeBaseURL('openai', llm.baseURL)}/chat/completions`;
  const headers = openAiHeaders(llm);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llm.timeoutSec * 1000);
  let res;
  let bodyText;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: llm.model.trim(),
        max_tokens: llm.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    bodyText = await res.text();
  } catch (err) {
    if (controller.signal.aborted) throw timeoutError(llm.timeoutSec);
    throw networkError(err, llm.timeoutSec);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw httpError(res.status, bodyText);
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new LlmError('bad_response', '서버 응답이 JSON 형식이 아닙니다. 서버 주소와 API 형식을 확인하세요.', { detail: bodyText });
  }
  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  const text = (Array.isArray(content) ? content.map((c) => c.text || '').join('') : content || '').trim();
  return { text, model: json.model, stopReason: choice?.finish_reason, truncated: choice?.finish_reason === 'length', usage: json.usage };
}

// 한 번 요청하고 텍스트를 돌려준다. 실패하면 LlmError를 던진다.
async function complete(llm, request, { fetch: fetchImpl = globalThis.fetch } = {}) {
  validate(llm);
  const started = Date.now();
  const result =
    llm.format === 'openai'
      ? await completeOpenAi(llm, request, fetchImpl)
      : await completeAnthropic(llm, request, fetchImpl);
  if (!result.text) {
    throw new LlmError(
      'bad_response',
      result.truncated
        ? '답변이 나오기 전에 최대 출력 토큰에 도달했습니다. 고급 설정에서 최대 출력 토큰을 늘리세요.'
        : '서버가 빈 답변을 보냈습니다.',
      { detail: JSON.stringify({ stopReason: result.stopReason, model: result.model }) },
    );
  }
  return { ...result, text: stripThinking(result.text), rawLength: result.text.length, ms: Date.now() - started };
}

// 서버가 제공하는 모델 목록 (GET /v1/models). 서버가 지원하지 않으면 오류.
async function listModels(llm, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!llm.apiKey) throw new LlmError('config', 'API 키를 먼저 입력하세요.');
  if (llm.format === 'openai' && !llm.baseURL.trim()) throw new LlmError('config', '서버 주소를 먼저 입력하세요.');
  const ids = [];
  if (llm.format === 'openai') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(llm.timeoutSec, 30) * 1000);
    let res;
    let bodyText;
    try {
      res = await fetchImpl(`${normalizeBaseURL('openai', llm.baseURL)}/models`, {
        headers: openAiHeaders(llm),
        signal: controller.signal,
      });
      bodyText = await res.text();
    } catch (err) {
      if (controller.signal.aborted) throw timeoutError(Math.min(llm.timeoutSec, 30));
      throw networkError(err);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw httpError(res.status, bodyText);
    const json = (() => {
      try {
        return JSON.parse(bodyText);
      } catch {
        return null;
      }
    })();
    for (const m of json?.data ?? []) if (m?.id) ids.push(m.id);
  } else {
    try {
      for await (const m of anthropicClient({ ...llm, timeoutSec: Math.min(llm.timeoutSec, 30) }, fetchImpl).models.list()) {
        if (m?.id) ids.push(m.id);
        if (ids.length >= 500) break;
      }
    } catch (err) {
      throw mapSdkError(err, llm);
    }
  }
  if (!ids.length) throw new LlmError('bad_response', '서버가 모델 목록을 비워서 보냈습니다. 모델 이름을 직접 입력하세요.');
  return ids;
}

const TEST_REQUEST = {
  system: '너는 연결 테스트에 답하는 도우미다.',
  prompt: '연결 테스트입니다. "연결 성공"이라고만 답해 주세요.',
};

module.exports = {
  DEFAULT_LLM,
  LlmError,
  complete,
  listModels,
  describe,
  parseExtraHeaders,
  normalizeBaseURL,
  stripThinking,
  TEST_REQUEST,
};
