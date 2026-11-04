import { contextBridge, ipcRenderer } from 'electron';

type Filter = { name: string; extensions: string[] };

contextBridge.exposeInMainWorld('cocoa', {
  open: (filters: Filter[], multi = false) => ipcRenderer.invoke('open', filters, multi),
  save: (name: string, filters: Filter[]) => ipcRenderer.invoke('save', name, filters),
  folder: () => ipcRenderer.invoke('folder'),
  write: (path: string, bytes: Uint8Array) => ipcRenderer.invoke('write', path, bytes),
  writeIn: (folder: string, name: string, bytes: Uint8Array) => ipcRenderer.invoke('writeIn', folder, name, bytes),
  read: (path: string) => ipcRenderer.invoke('read', path),
  recent: () => ipcRenderer.invoke('recent'),
  recovery: {
    write: (bytes: Uint8Array) => ipcRenderer.invoke('recovery:write', bytes),
    read: () => ipcRenderer.invoke('recovery:read'),
    clear: () => ipcRenderer.invoke('recovery:clear'),
  },
  title: (t: string) => ipcRenderer.invoke('title', t),
});
