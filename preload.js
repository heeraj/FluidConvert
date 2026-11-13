const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel) {
  return (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('fluid', {
  // Electron 32+ removed File.path; resolve dropped files here.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; }
  },
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  chooseOutputDir: (defaultPath) => ipcRenderer.invoke('dialog:chooseOutputDir', defaultPath),
  expand: (paths) => ipcRenderer.invoke('fs:expand', paths),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  probe: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  detectHw: (force) => ipcRenderer.invoke('hw:detect', force),
  convert: (options) => ipcRenderer.invoke('job:convert', options),
  cancel: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  resolveTheme: () => ipcRenderer.invoke('theme:resolve'),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  version: () => ipcRenderer.invoke('app:version'),
  onProgress: on('job:progress'),
  onLog: on('job:log'),
  onThemeChanged: on('theme:changed'),
});
