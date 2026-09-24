const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fluid', {
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  chooseOutputDir: (defaultPath) => ipcRenderer.invoke('dialog:chooseOutputDir', defaultPath),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  getDesktop: () => ipcRenderer.invoke('fs:getDesktop'),
  probe: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  convert: (options) => ipcRenderer.invoke('job:convert', options),
  cancel: () => ipcRenderer.invoke('job:cancel'),
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('job:progress', handler);
    return () => ipcRenderer.removeListener('job:progress', handler);
  },
  onLog: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('job:log', handler);
    return () => ipcRenderer.removeListener('job:log', handler);
  },
});
