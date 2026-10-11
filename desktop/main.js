// SimGolf desktop: runs the web build (desktop/site, see
// scripts/prepare-site.mjs) in its own window instead of a browser tab.
//
// The page is served from app://simgolf/ rather than file://, so it gets a
// stable secure origin: the unpacked game (origin private file system) and the
// saves (IndexedDB) persist in the app's own profile
// (~/Library/Application Support/SimGolf on macOS), and fetch() and workers
// behave as they do on the web. Nothing is loaded from the network.

const { app, BrowserWindow, Menu, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'simgolf';
const ORIGIN = `${SCHEME}://${HOST}`;
const SITE = path.join(__dirname, 'site');
// Default window size. The game draws an 800 × 600 frame that the page
// scales (with its text and terrain redrawn at the window's resolution).
const GAME_W = 1024, GAME_H = 768;

// Smoke tests (scripts/smoke-test.mjs) run against a throwaway profile, with
// a driver script from the source tree (it isn't packaged).
const smoke = process.env.SIMGOLF_SMOKE ? JSON.parse(process.env.SIMGOLF_SMOKE) : null;
if (smoke && smoke.profile) app.setPath('userData', smoke.profile);

// The game is a single tight loop that yields to the event loop every frame;
// don't let Chromium slow it down when the window is hidden or covered.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

// Everything comes from the app itself. WebAssembly needs wasm-unsafe-eval;
// index.html has inline scripts and styles; videos, save downloads and the
// installer's output are blob: URLs.
const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'self' data: blob:", "object-src 'none'", "base-uri 'self'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.data': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('Not found', { status: 404 });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(SITE, '.' + rel);
  if (file !== SITE && !file.startsWith(SITE + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const body = await fs.promises.readFile(file);
    return new Response(body, {
      headers: {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    // The page asks for game/, assets/ and saves/ paths it then answers from
    // its own storage; a miss here is normal.
    return new Response('Not found', { status: 404 });
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

let win = null;
let quitting = false;

// Writes the game's pending saves to IndexedDB before the window goes away.
// The page itself does this half a second after each save and on pagehide;
// this covers quitting in between.
async function flushSaves() {
  if (!win || win.isDestroyed()) return;
  const flush = `new Promise((done) => {
    try {
      if (typeof Module === 'undefined' || !Module.persistFlush || typeof FS === 'undefined') return done(false);
      clearTimeout(Module.persistTimer);
      FS.syncfs(false, () => done(true));
    } catch (e) { done(false); }
  })`;
  try {
    await Promise.race([win.webContents.executeJavaScript(flush, true), new Promise((r) => setTimeout(r, 3000))]);
  } catch { /* page not ready: nothing to flush */ }
  await session.defaultSession.flushStorageData();
}

function createWindow() {
  win = new BrowserWindow({
    width: GAME_W,
    height: GAME_H,
    useContentSize: true,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#16122e',
    title: 'SimGolf',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  // The game is 4:3; keep the window that shape so it fills it edge to edge.
  win.setAspectRatio(GAME_W / GAME_H);
  if (smoke) win.showInactive(); else win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) { e.preventDefault(); openExternal(url); }
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    flushSaves().finally(() => { if (!win.isDestroyed()) win.destroy(); });
  });
  win.on('closed', () => { win = null; });

  win.loadURL(`${ORIGIN}/index.html`);
  if (smoke) require(smoke.driver)(win, smoke);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    {
      label: 'View',
      submenu: [
        {
          label: 'Default Size (1024 × 768)',
          click: () => { if (win && !win.isFullScreen()) win.setContentSize(GAME_W, GAME_H); },
        },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        // Reloading drops an unsaved game, so it's tucked away with the tools.
        { label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'SimGolf Web Port on GitHub', click: () => openExternal('https://github.com/RichardAtCT/simgolf-web') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!smoke && !app.requestSingleInstanceLock()) {
  // A second copy would share (and fight over) the same game files and saves.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);
    // Offline: the page's only network use is fonts (bundled instead), a
    // public play counter and links, which open in the default browser.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, cb) => cb({ cancel: true }));
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(['persistent-storage', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(permission));
    });
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());
}
