// 앱이 쓰는 파일 위치를 한곳에서 정한다. (main.js 와 scripts/llm-check.js 가 함께 쓴다)
const path = require('path');

function configurePaths(app) {
  app.setPath(
    'userData',
    process.env.COSMOS_USER_DATA || path.join(app.getPath('appData'), 'cosmos-notes'),
  );
  const dir = app.getPath('userData');
  return {
    userData: dir,
    notesFile: path.join(dir, 'notes.json'),
    windowFile: path.join(dir, 'window-state.json'),
    settingsFile: path.join(dir, 'settings.json'),
    logDir: path.join(dir, 'logs'),
  };
}

module.exports = { configurePaths };
