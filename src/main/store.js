// JSON 파일 기반 저장소. 쓰기는 임시 파일에 먼저 쓴 뒤 rename 해서
// 저장 도중 앱이 꺼져도 기존 파일이 깨지지 않게 한다.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 50 * 1024 * 1024;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // 손상된 파일은 덮어쓰기 전에 백업해 둔다.
      try {
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {}
      console.error(`[store] ${path.basename(file)} 읽기 실패:`, err.message);
    }
    return fallback;
  }
}

function writeJson(file, value) {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text) > MAX_BYTES) {
    throw new Error('저장할 데이터가 너무 큽니다.');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function isNotesData(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(value.notes)
  );
}

module.exports = { readJson, writeJson, isNotesData };
