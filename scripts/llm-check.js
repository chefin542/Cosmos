// AI 연결 진단 도구 — 앱을 띄우지 않고 터미널에서 AI 연결만 확인한다.
//
//   npm run llm:check                 앱에 저장된 설정으로 테스트
//   npm run llm:check -- "질문 내용"   원하는 문장을 보내 본다
//
// 환경 변수로 설정을 덮어쓸 수 있다 (저장된 설정보다 우선):
//   COSMOS_LLM_FORMAT=anthropic|openai   COSMOS_LLM_BASE_URL=...   COSMOS_LLM_MODEL=...
//   COSMOS_LLM_API_KEY=...               COSMOS_LLM_AUTH=bearer|x-api-key
//
// 앱과 똑같이 Electron의 네트워크(net.fetch: 시스템 프록시·인증서 사용)로 요청한다.
const { app, net, safeStorage } = require('electron');
const { configurePaths } = require('../src/main/paths');
const { loadSettings } = require('../src/main/settings');
const llm = require('../src/main/llm');

const paths = configurePaths(app);

function withEnvOverrides(settings) {
  const env = process.env;
  const out = { ...settings };
  if (env.COSMOS_LLM_FORMAT) out.format = env.COSMOS_LLM_FORMAT;
  if (env.COSMOS_LLM_BASE_URL) out.baseURL = env.COSMOS_LLM_BASE_URL;
  if (env.COSMOS_LLM_MODEL) out.model = env.COSMOS_LLM_MODEL;
  if (env.COSMOS_LLM_API_KEY) out.apiKey = env.COSMOS_LLM_API_KEY;
  if (env.COSMOS_LLM_AUTH) out.authType = env.COSMOS_LLM_AUTH;
  return out;
}

app.whenReady().then(async () => {
  const settings = withEnvOverrides(loadSettings(paths.settingsFile, safeStorage).llm);
  const question = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.js'));
  const request = question ? { system: '한국어로 짧게 답해.', prompt: question } : llm.TEST_REQUEST;

  console.log('설정 파일:', paths.settingsFile);
  console.log('사용할 설정:', JSON.stringify(llm.describe(settings), null, 2));
  console.log('보내는 질문:', request.prompt);
  try {
    const result = await llm.complete(settings, request, { fetch: net.fetch });
    console.log(`\n✅ 성공 (${result.ms}ms, 모델: ${result.model}, 종료 이유: ${result.stopReason})`);
    console.log(result.text);
    app.exit(0);
  } catch (err) {
    console.error(`\n❌ 실패 [${err.kind || 'unknown'}] ${err.message}`);
    if (err.detail) console.error('자세한 내용:', err.detail);
    if (!(err instanceof llm.LlmError)) console.error(err.stack);
    app.exit(1);
  }
});
