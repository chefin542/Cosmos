// 파일 로그. 문제가 생기면 이 파일을 보면 된다 (설정 → "로그 폴더 열기").
// 형식: 2026-10-01T14:00:00.000Z [ERROR] 메시지 {"추가":"정보"}
// API 키·토큰 같은 비밀 값은 redact()로 가린 뒤에만 기록한다.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024; // 넘으면 cosmos.log → cosmos.log.1 로 넘긴다
const SECRET_KEY = /key|token|secret|authorization|password/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) && v ? '***' : redact(v);
    }
    return out;
  }
  return value;
}

function createLogger(dir, { echo = true } = {}) {
  const file = path.join(dir, 'cosmos.log');

  function write(level, message, extra) {
    const line = `${new Date().toISOString()} [${level}] ${message}${
      extra === undefined ? '' : ` ${JSON.stringify(redact(extra))}`
    }\n`;
    if (echo) (level === 'ERROR' ? console.error : console.log)(line.trimEnd());
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, line, 'utf8');
    } catch {
      // 로그를 못 쓴다고 앱이 멈추면 안 된다.
    }
  }

  return {
    file,
    dir,
    info: (msg, extra) => write('INFO', msg, extra),
    warn: (msg, extra) => write('WARN', msg, extra),
    error: (msg, extra) => write('ERROR', msg, extra),
  };
}

module.exports = { createLogger, redact };
