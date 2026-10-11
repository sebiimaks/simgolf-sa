// Drives the app window for scripts/smoke-test.mjs (development only; not
// packaged). Picks the given game files on the setup screen, or presses Play
// when the game is already installed, then takes screenshots and quits.
// Options come from SIMGOLF_SMOKE (JSON): { driver, profile, files, shots,
// wait, every, clicks: ["x,y@seconds", ...], eval, quit }.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function drive(win, opt) {
  const wc = win.webContents;
  const t0 = Date.now();
  const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}] ${s}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code, true);
  const shots = opt.shots || path.join(opt.profile || app.getPath('temp'), 'shots');
  fs.mkdirSync(shots, { recursive: true });

  wc.on('console-message', (e, level, message) => {
    const text = typeof e.message === 'string' ? e.message : message;
    if (!/^fetch /.test(text)) log(`console: ${text}`);
  });
  wc.on('render-process-gone', (e, d) => { log(`renderer gone: ${d.reason}`); app.exit(2); });

  async function shot(name) {
    const img = await wc.capturePage();
    const file = path.join(shots, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    log(`screenshot ${file}`);
  }

  // Through DevTools input events, which reach the page whether or not the
  // window has focus (the test window opens without taking it).
  const cdp = (method, params) => wc.debugger.sendCommand(method, params);
  // Like tools/port/run.mjs: approach the spot, settle, then press.
  async function click(x, y) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3 });
    await sleep(100);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(150);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  // Frames per second the page gets from requestAnimationFrame over 3 s.
  const fps = () => js(`new Promise((done) => { let n = 0; const t = performance.now();
    (function f() { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else done(n / ((performance.now() - t) / 1000)); })(); })`);

  async function run() {
    wc.debugger.attach('1.3');
    for (let i = 0; !(await js("document.getElementById('setup').classList.contains('on')")); i++) {
      if (i > 100) throw new Error('setup screen never appeared');
      await sleep(100);
    }
    const installed = await js("!document.getElementById('ready').hidden");
    log(installed ? 'game already installed: pressing Play' : `installing from ${opt.files.join(', ')}`);
    await shot('0-setup');
    if (installed) {
      await js("document.getElementById('play').click()");
    } else {
      if (!opt.files || !opt.files.length) throw new Error('not installed and no files given');
      const { root } = await cdp('DOM.getDocument');
      const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#pick' });
      await cdp('DOM.setFileInputFiles', { nodeId, files: opt.files });
      let last = '';
      for (;;) {
        const s = await js("({ msg: document.getElementById('msg').textContent, bad: document.getElementById('msg').className === 'bad', on: document.getElementById('setup').classList.contains('on') })");
        if (s.msg !== last) { log(`setup: ${s.msg}`); last = s.msg; }
        if (s.bad) { await shot('install-error'); throw new Error(`install failed: ${s.msg}`); }
        if (!s.on) break;
        await sleep(500);
      }
      log('installed');
    }
    if (opt.pre) log(`pre: ${JSON.stringify(await js(opt.pre))}`);
    const wait = (opt.wait || 30) * 1000, every = (opt.every || 10) * 1000;
    const clicks = (opt.clicks || []).map((c) => {
      const [xy, at] = c.split('@');
      const [x, y] = xy.split(',').map(Number);
      return { x, y, at: +at * 1000 };
    }).sort((a, b) => a.at - b.at);
    const start = Date.now();
    let next = every, n = 1;
    while (Date.now() - start < wait) {
      const t = Date.now() - start;
      while (clicks.length && clicks[0].at <= t) { const c = clicks.shift(); log(`click ${c.x},${c.y}`); await click(c.x, c.y); }
      if (t >= next) { await shot(`${n++}-${Math.round(t / 1000)}s`); next += every; }
      await sleep(100);
    }
    if (opt.eval) {
      log(`eval: ${JSON.stringify(await js(opt.eval))}`);
      return;   // straight to quit, e.g. to check that a fresh write survives it
    }
    log(`requestAnimationFrame rate: ${(await fps()).toFixed(1)} fps`);
    await shot('final');
  }

  wc.once('did-finish-load', () => {
    run().then(() => { log('done'); if (opt.quit !== false) app.quit(); },
      (e) => { log(`FAILED: ${e.message}`); app.exit(1); });
  });
};
