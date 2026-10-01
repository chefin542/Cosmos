const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { DEFAULT_LLM, complete, describe, parseExtraHeaders } = require('../src/main/llm');

// 요청을 기록하고, handler가 정한 응답을 돌려주는 가짜 LLM 서버
async function mockServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      requests.push(entry);
      const { status = 200, json, delayMs = 0 } = handler(entry);
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      }, delayMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}

const anthropicReply = (text, stop = 'end_turn') => ({
  json: {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'internal-model',
    content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text }],
    stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 },
  },
});

const settings = (over) => ({ ...DEFAULT_LLM, enabled: true, model: 'internal-model', apiKey: 'sk-test', ...over });
const req = { system: '시스템', prompt: '안녕' };

test('Anthropic 형식: /v1/messages 로 보내고, Bearer 인증과 추가 헤더를 붙인다', async () => {
  const srv = await mockServer(() => anthropicReply('연결 성공'));
  try {
    const out = await complete(
      settings({ baseURL: srv.url, authType: 'bearer', extraHeaders: 'X-Team: cosmos\n# 주석\n' }),
      req,
    );
    assert.equal(out.text, '연결 성공');
    const [r] = srv.requests;
    assert.equal(r.url, '/v1/messages');
    assert.equal(r.headers.authorization, 'Bearer sk-test');
    assert.equal(r.headers['x-api-key'], undefined);
    assert.equal(r.headers['x-team'], 'cosmos');
    assert.ok(r.headers['anthropic-version']);
    assert.equal(r.body.model, 'internal-model');
    assert.equal(r.body.system, '시스템');
    assert.deepEqual(r.body.messages, [{ role: 'user', content: '안녕' }]);
  } finally {
    await srv.close();
  }
});

test('Anthropic 형식: x-api-key 인증', async () => {
  const srv = await mockServer(() => anthropicReply('ok'));
  try {
    await complete(settings({ baseURL: srv.url, authType: 'x-api-key' }), req);
    assert.equal(srv.requests[0].headers['x-api-key'], 'sk-test');
    assert.equal(srv.requests[0].headers.authorization, undefined);
  } finally {
    await srv.close();
  }
});

test('OpenAI 호환 형식: /chat/completions 로 보내고 system 메시지를 앞에 넣는다', async () => {
  const srv = await mockServer(() => ({
    json: { model: 'm', choices: [{ message: { role: 'assistant', content: '요약' }, finish_reason: 'stop' }] },
  }));
  try {
    const out = await complete(settings({ format: 'openai', baseURL: `${srv.url}/v1/`, authType: 'bearer' }), req);
    assert.equal(out.text, '요약');
    const [r] = srv.requests;
    assert.equal(r.url, '/v1/chat/completions');
    assert.equal(r.headers.authorization, 'Bearer sk-test');
    assert.deepEqual(r.body.messages.map((m) => m.role), ['system', 'user']);
  } finally {
    await srv.close();
  }
});

test('HTTP 오류는 원인별 한국어 안내로 바뀐다', async () => {
  for (const [status, kind] of [[401, 'auth'], [404, 'not_found'], [400, 'bad_request']]) {
    const srv = await mockServer(() => ({ status, json: { type: 'error', error: { type: 'x', message: '서버 메시지' } } }));
    try {
      await assert.rejects(complete(settings({ baseURL: srv.url }), req), (err) => {
        assert.equal(err.kind, kind);
        assert.equal(err.status, status);
        assert.match(err.message, new RegExp(`HTTP ${status}`));
        assert.match(err.detail, /서버 메시지/);
        return true;
      });
    } finally {
      await srv.close();
    }
  }
});

test('출력 토큰이 모자라 빈 답이 오면 알려 준다', async () => {
  const srv = await mockServer(() => ({
    json: { ...anthropicReply('').json, content: [{ type: 'thinking', thinking: '', signature: 'x' }], stop_reason: 'max_tokens' },
  }));
  try {
    await assert.rejects(complete(settings({ baseURL: srv.url }), req), /최대 출력 토큰/);
  } finally {
    await srv.close();
  }
});

test('시간 제한을 넘기면 timeout 오류', async () => {
  const srv = await mockServer(() => ({ ...anthropicReply('늦음'), delayMs: 2500 }));
  try {
    await assert.rejects(complete(settings({ baseURL: srv.url, timeoutSec: 1 }), req), (err) => err.kind === 'timeout');
  } finally {
    await srv.close();
  }
});

test('서버가 없으면 network 오류', async () => {
  await assert.rejects(complete(settings({ baseURL: 'http://127.0.0.1:9', timeoutSec: 5 }), req), (err) => err.kind === 'network');
});

test('설정이 빠지면 요청하기 전에 알려 준다', async () => {
  await assert.rejects(complete(settings({ model: '' }), req), /모델 이름/);
  await assert.rejects(complete(settings({ apiKey: '' }), req), /API 키/);
  await assert.rejects(complete(settings({ format: 'openai', baseURL: '' }), req), /서버 주소/);
  await assert.rejects(complete(settings({ baseURL: 'llm.company.com' }), req), /http/);
  assert.throws(() => parseExtraHeaders('잘못된줄'), /1번째 줄/);
});

test('describe()에는 키 값이 들어가지 않는다', () => {
  const d = describe(settings({ extraHeaders: 'X-Secret-Token: abc' }));
  assert.equal(d.hasApiKey, true);
  assert.ok(!JSON.stringify(d).includes('sk-test'));
  assert.ok(!JSON.stringify(d).includes('abc'));
  assert.deepEqual(d.extraHeaderNames, ['X-Secret-Token']);
});
