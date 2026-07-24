const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s),
  },
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    save: (n) => ipcRenderer.invoke('notes:save', n),
    delete: (id) => ipcRenderer.invoke('notes:delete', id),
    search: (q) => ipcRenderer.invoke('notes:search', q),
  },
  attach: {
    pick: () => ipcRenderer.invoke('attach:pick'),
    open: (p) => ipcRenderer.invoke('attach:open', p),
    reveal: (p) => ipcRenderer.invoke('attach:reveal', p),
    readImage: (p) => ipcRenderer.invoke('attach:readImage', p),
  },
  web: {
    search: (q) => ipcRenderer.invoke('web:search', q),
    open: (u) => ipcRenderer.invoke('web:open', u),
  },
  storage: {
    info: () => ipcRenderer.invoke('storage:info'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
});
