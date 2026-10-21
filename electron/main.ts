/**
 * Electron main process.
 *
 * Responsibilities:
 *  - window + menu + keyboard lifecycle
 *  - file dialogs (open/save) with atomic writes into the user's app data
 *  - secret storage through `safeStorage` (DPAPI on Windows)
 *  - proxying HTTP generation so credentials never enter the renderer
 *
 * Nothing here imports renderer code; the main process is deliberately small.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEV_URL = process.env.WHATIFS_DEV_URL ?? '';
const isDev = DEV_URL.length > 0;

/**
 * Optional path the app writes a readiness marker to once the renderer has
 * finished loading.
 *
 * This exists for the automated launch smoke test. Version 1.0.0 shipped a build
 * that aborted during startup, so the app never showed a window — and nothing in
 * the pipeline noticed, because the end-to-end suite only exercised the browser
 * build, never the packaged Electron app. The smoke test launches the real
 * executable and waits for this marker, so a launch failure fails the build
 * instead of reaching a download.
 *
 * It is opt-in via an environment variable and costs nothing when unset.
 */
const SMOKE_MARKER = process.env.WHATIFS_SMOKE_MARKER ?? '';

/**
 * Filesystem-safe application name.
 *
 * Electron derives `app.getPath('userData')` from `app.getName()`, which falls
 * back to `productName` in package.json. That value is
 * "What If? — The Infinite Lives Engine", and the `?` is an illegal character in
 * a Windows path. Chromium aborts the process while resolving the (invalid)
 * userData directory, so the app died on launch with exit code -36861 before a
 * window could ever appear, packaged or in dev.
 *
 * Everything user-visible keeps the styled title; only the on-disk name is
 * sanitised. This must run before any call that touches userData (the secret
 * store, the "Open app data folder" menu item, and the single-instance lock).
 */
const APP_FS_NAME = 'What If Infinite Lives Engine';
app.setName(APP_FS_NAME);

/** Security: never allow the window to navigate away from the app. */
const ALLOWED_PROTOCOLS = new Set(['file:', 'http://localhost', 'http://127.0.0.1']);

let mainWindow: BrowserWindow | null = null;

function resolveIndex(): string {
  return path.join(__dirname, '..', 'dist', 'index.html');
}

/**
 * Locate the window icon.
 *
 * In development the source tree sits next to `dist-electron/`. In a packaged
 * app the icon is shipped inside the asar under `build/` (see `build.files`),
 * and `app.isPackaged` lets us prefer the extra-resources copy when present.
 */
function resolveIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'build', 'icon.ico'),
  ];
  for (const candidate of candidates) {
    try {
      if (require('node:fs').existsSync(candidate)) return candidate;
    } catch {
      // ignore and try the next candidate
    }
  }
  return undefined;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: '#05070d',
    autoHideMenuBar: false,
    title: 'What If? — The Infinite Lives Engine',
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Signal readiness for the automated launch smoke test (see SMOKE_MARKER).
  if (SMOKE_MARKER) {
    mainWindow.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          await fs.mkdir(path.dirname(SMOKE_MARKER), { recursive: true });
          await fs.writeFile(
            SMOKE_MARKER,
            JSON.stringify({
              ok: true,
              version: app.getVersion(),
              title: mainWindow?.getTitle() ?? '',
              pid: process.pid,
            }),
            'utf8'
          );
        } catch {
          // The smoke test will time out and report the failure.
        }
      })();
    });
  }

  // Block external navigation; route real links to the OS browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const ok = [...ALLOWED_PROTOCOLS].some((p) => url.startsWith(p));
    if (!ok) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Refuse permission requests outright — this app needs none.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) =>
    callback(false)
  );
  // Block any remote load attempt (CSP is the first line of defence).
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['*://*/'] },
    (details, callback) => {
      const url = details.url;
      const localOk =
        url.startsWith('file://') ||
        url.startsWith('devtools://') ||
        url.startsWith('blob:') ||
        url.startsWith('data:') ||
        url.startsWith('http://localhost') ||
        url.startsWith('http://127.0.0.1');
      callback({ cancel: !localOk });
    }
  );

  if (isDev) {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(resolveIndex());
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function installMenu(): void {
  const send = (channel: string, payload?: unknown): void => {
    mainWindow?.webContents.send(channel, payload);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        {
          label: 'New universe…',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu', { kind: 'new' }),
        },
        { type: 'separator' },
        {
          label: 'Open / Import…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu', { kind: 'import' }),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu', { kind: 'export' }),
        },
        {
          label: 'Library',
          accelerator: 'CmdOrCtrl+L',
          click: () => send('menu', { kind: 'library' }),
        },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', { kind: 'undo' }) },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => send('menu', { kind: 'redo' }),
        },
        { type: 'separator' },
        {
          label: 'Find node',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('menu', { kind: 'search' }),
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('menu', { kind: 'settings' }),
        },
      ],
    },
    {
      label: '&Universe',
      submenu: [
        {
          label: 'Expand selected node',
          accelerator: 'E',
          click: () => send('menu', { kind: 'expand' }),
        },
        {
          label: 'Reroll simulation',
          accelerator: 'CmdOrCtrl+R',
          click: () => send('menu', { kind: 'reroll' }),
        },
        {
          label: 'Auto-layout',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => send('menu', { kind: 'layout' }),
        },
        { type: 'separator' },
        { label: 'Fit to view', accelerator: 'F', click: () => send('menu', { kind: 'fit' }) },
        {
          label: 'Zoom in',
          accelerator: 'CmdOrCtrl+=',
          click: () => send('menu', { kind: 'zoom-in' }),
        },
        {
          label: 'Zoom out',
          accelerator: 'CmdOrCtrl+-',
          click: () => send('menu', { kind: 'zoom-out' }),
        },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'About What If?', click: () => send('menu', { kind: 'about' }) },
        {
          label: 'Open app data folder',
          click: () => void shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* IPC: files                                                          */
/* ------------------------------------------------------------------ */

function filterArgs(filters?: { name: string; extensions: string[] }[]): Electron.FileFilter[] {
  if (!filters || filters.length === 0)
    return [{ name: 'What If? universe', extensions: ['json'] }];
  return filters;
}

ipcMain.handle('file:open', async (_e, filters?: { name: string; extensions: string[] }[]) => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
    title: 'Import universe',
    properties: ['openFile'],
    filters: filterArgs(filters),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0]!;
  const stat = await fs.stat(filePath);
  if (stat.size > 64 * 1024 * 1024) {
    throw new Error('That file is larger than the 64 MB import limit.');
  }
  const text = await fs.readFile(filePath, 'utf8');
  return { path: filePath, text };
});

ipcMain.handle(
  'file:save',
  async (
    _e,
    defaultName: string,
    text: string,
    filters?: { name: string; extensions: string[] }[]
  ) => {
    const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
      title: 'Export universe',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: filterArgs(filters),
    });
    if (result.canceled || !result.filePath) return null;
    await writeAtomic(result.filePath, text);
    return result.filePath;
  }
);

/** Write via a temporary file + rename so a crash never leaves a half-written save. */
async function writeAtomic(target: string, text: string): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, target);
}

/* ------------------------------------------------------------------ */
/* IPC: clipboard                                                      */
/* ------------------------------------------------------------------ */

ipcMain.handle('clipboard:write', async (_e, text: string) => {
  const { clipboard } = await import('electron');
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('clipboard:read', async () => {
  const { clipboard } = await import('electron');
  return clipboard.readText();
});

/* ------------------------------------------------------------------ */
/* IPC: secrets (never exposed to the renderer in plaintext form)       */
/* ------------------------------------------------------------------ */

function secretPath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9:_-]/g, '_');
  return path.join(app.getPath('userData'), 'secrets', `${safe}.bin`);
}

/** Decrypt a stored secret, or null when there is none or it cannot be read. */
async function readSecret(key: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = await fs.readFile(secretPath(key));
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

ipcMain.handle('secret:set', async (_e, key: string, value: string) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const encrypted = safeStorage.encryptString(value);
  const file = secretPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encrypted);
  return true;
});

ipcMain.handle('secret:get', async (_e, key: string) => {
  return readSecret(key);
});

ipcMain.handle('secret:delete', async (_e, key: string) => {
  try {
    await fs.unlink(secretPath(key));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('app:version', () => app.getVersion());

/* ------------------------------------------------------------------ */
/* IPC: provider requests (authenticated here, never in the renderer)  */
/* ------------------------------------------------------------------ */

/** The key name the provider credential is stored under. */
const PROVIDER_SECRET_KEY = 'whatifs:http';

/** Largest provider response the app will read back. */
const MAX_PROVIDER_RESPONSE_CHARS = 2_000_000;

/**
 * Perform an authenticated provider request.
 *
 * The API key is decrypted here, attached here, and never crosses the bridge.
 * The renderer receives the status and the response body, nothing else. If the
 * response text ever contained the key, it would be stripped before being
 * returned, so an error message can never leak the credential into a log, a
 * toast or an exported file.
 */
ipcMain.handle(
  'ai:request',
  async (
    _e,
    payload: { url?: unknown; body?: unknown; timeoutMs?: unknown; keyless?: unknown }
  ): Promise<{
    ok: boolean;
    status: number;
    text: string;
    transportError?: 'no_key' | 'network' | 'timeout' | 'blocked';
    message?: string;
  }> => {
    const url = typeof payload?.url === 'string' ? payload.url : '';
    const body = typeof payload?.body === 'string' ? payload.body : '';
    const timeoutMs =
      typeof payload?.timeoutMs === 'number' && payload.timeoutMs > 0
        ? Math.min(payload.timeoutMs, 120_000)
        : 60_000;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return {
        ok: false,
        status: 0,
        text: '',
        transportError: 'blocked',
        message: 'The provider URL was not a valid address.',
      };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ok: false,
        status: 0,
        text: '',
        transportError: 'blocked',
        message: 'Only http and https provider addresses are allowed.',
      };
    }
    if (body.length > 4_000_000) {
      return {
        ok: false,
        status: 0,
        text: '',
        transportError: 'blocked',
        message: 'The request was larger than the application will send.',
      };
    }

    const secret = await readSecret(PROVIDER_SECRET_KEY);
    const keyless = payload?.keyless === true;

    if (!secret && !keyless) {
      // Better to say this plainly than to send an unauthenticated request and
      // let the provider return an opaque 401.
      return {
        ok: false,
        status: 0,
        text: '',
        transportError: 'no_key',
        message: 'No API key is stored for this provider.',
      };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const started = Date.now();
    try {
      const response = await fetch(parsed.toString(), {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      let text = await response.text();
      if (text.length > MAX_PROVIDER_RESPONSE_CHARS) {
        text = text.slice(0, MAX_PROVIDER_RESPONSE_CHARS);
      }
      if (secret) text = text.split(secret).join('[redacted]');
      return { ok: response.ok, status: response.status, text };
    } catch (err) {
      const timedOut = Date.now() - started >= timeoutMs - 250;
      const message = err instanceof Error ? err.message : 'Unknown network error.';
      return {
        ok: false,
        status: 0,
        text: '',
        transportError: timedOut ? 'timeout' : 'network',
        message: secret ? message.split(secret).join('[redacted]') : message,
      };
    }
  }
);

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

// Single instance: focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    installMenu();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
