import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Filter = { name: string; extensions: string[] };

let win: BrowserWindow | null = null;
/** Paths the renderer may read or write: ones a dialog gave, recent projects, and export folders. */
const allowed = new Set<string>();
const folders = new Set<string>();

const dataDir = () => app.getPath('userData');
const recoveryFile = () => path.join(dataDir(), 'recovery.cocoasurf');
const recentFile = () => path.join(dataDir(), 'recent.json');

async function recent(): Promise<string[]> {
  try {
    const v = JSON.parse(await readFile(recentFile(), 'utf8')) as unknown;
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && existsSync(p)).slice(0, 10) : [];
  } catch {
    return [];
  }
}

async function addRecent(p: string): Promise<void> {
  const list = [p, ...(await recent()).filter((x) => x !== p)].slice(0, 10);
  await mkdir(dataDir(), { recursive: true });
  await writeFile(recentFile(), JSON.stringify(list));
}

function inFolder(folder: string, name: string): string | null {
  if (!folders.has(folder) || /[\\/]|^\.\.?$/.test(name)) return null;
  return path.join(folder, name);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#121212',
    title: 'CocoaSurface',
    // The app's own top bar is the title bar; the system draws its window buttons over its right end (left on macOS).
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: '#1a1a1a', symbolColor: '#e8e8e8', height: 38 },
    icon: path.join(__dirname, '../../build/icon.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win!, {
      type: 'question',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'The project has unsaved changes.',
      detail: 'A recovery copy is kept, but changes since it was made will be lost.',
    });
    if (r === 0) e.preventDefault();
  });
  const dev = process.env.CS_DEV_URL;
  if (dev) void win.loadURL(dev);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('closed', () => (win = null));
}

ipcMain.handle('open', async (_e, filters: Filter[], multi: boolean) => {
  const r = await dialog.showOpenDialog(win!, { filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] });
  if (r.canceled) return [];
  return Promise.all(
    r.filePaths.map(async (p) => {
      allowed.add(p);
      return { path: p, name: path.basename(p), bytes: new Uint8Array(await readFile(p)) };
    }),
  );
});

ipcMain.handle('save', async (_e, name: string, filters: Filter[]) => {
  const r = await dialog.showSaveDialog(win!, { defaultPath: name, filters });
  if (r.canceled || !r.filePath) return null;
  allowed.add(r.filePath);
  return r.filePath;
});

ipcMain.handle('folder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  folders.add(r.filePaths[0]);
  return r.filePaths[0];
});

ipcMain.handle('write', async (_e, p: string, bytes: Uint8Array) => {
  if (!allowed.has(p)) throw new Error('Not allowed.');
  const tmp = `${p}.saving`;
  await writeFile(tmp, bytes);
  await rename(tmp, p);
  if (p.endsWith('.cocoasurf')) await addRecent(p);
});

ipcMain.handle('writeIn', async (_e, folder: string, name: string, bytes: Uint8Array) => {
  const p = inFolder(folder, name);
  if (!p) throw new Error('Not allowed.');
  await writeFile(p, bytes);
});

ipcMain.handle('read', async (_e, p: string) => {
  if (!allowed.has(p) && !(await recent()).includes(p)) throw new Error('Not allowed.');
  allowed.add(p);
  return { path: p, name: path.basename(p), bytes: new Uint8Array(await readFile(p)) };
});

ipcMain.handle('recent', () => recent());
ipcMain.handle('recovery:write', async (_e, bytes: Uint8Array) => {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(recoveryFile(), bytes);
});
ipcMain.handle('recovery:read', async () => (existsSync(recoveryFile()) ? new Uint8Array(await readFile(recoveryFile())) : null));
ipcMain.handle('recovery:clear', () => rm(recoveryFile(), { force: true }));
ipcMain.handle('title', (_e, t: string) => win?.setTitle(t));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
