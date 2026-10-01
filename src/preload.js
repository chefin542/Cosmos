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
  onNewNote: (callback) => {
    ipcRenderer.on('app:new-note', () => callback());
  },
});
