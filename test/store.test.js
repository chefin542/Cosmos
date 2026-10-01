const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson, writeJson, isNotesData } = require('../src/main/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-store-'));

test('저장한 JSON을 그대로 읽어 온다', () => {
  const file = path.join(tmpDir(), 'sub', 'notes.json');
  writeJson(file, { notes: [{ id: 'a', title: '별' }] });
  assert.deepEqual(readJson(file, null), { notes: [{ id: 'a', title: '별' }] });
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('파일이 없으면 기본값을 돌려준다', () => {
  assert.equal(readJson(path.join(tmpDir(), 'none.json'), 'fallback'), 'fallback');
});

test('손상된 파일은 백업해 두고 기본값을 돌려준다', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.json');
  fs.writeFileSync(file, '{ broken');
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal(readJson(file, null), null);
  } finally {
    console.error = origError;
  }
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('notes.json.corrupt-')));
});

test('메모 데이터 형식만 저장을 허용한다', () => {
  assert.equal(isNotesData({ notes: [] }), true);
  assert.equal(isNotesData(null), false);
  assert.equal(isNotesData([]), false);
  assert.equal(isNotesData({ notes: {} }), false);
});
