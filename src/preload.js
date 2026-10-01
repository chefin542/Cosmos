const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cosmos', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  saveDataSync: (data) => ipcRenderer.sendSync('data:save-sync', data),

  getWindowState: () => ipcRenderer.invoke('win:get-state'),
  windowAction: (name) => ipcRenderer.send('win:action', name),
  onWindowState: (callback) => {
    ipcRenderer.on('win:state', (_event, state) => callback(state));
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  // purpose: 'test' | 'summary'. 결과: { ok: true, text, ... } 또는 { ok: false, error: { kind, message, detail } }
  llmComplete: (payload) => ipcRenderer.invoke('llm:complete', payload),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  getDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),

  onNewNote: (callback) => {
    ipcRenderer.on('app:new-note', () => callback());
  },
});
