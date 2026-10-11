#!/usr/bin/env node
// Runs the app against a throwaway profile: installs the game from the given
// files (or presses Play if --profile already has it), waits, screenshots.
//   node scripts/smoke-test.mjs <disc.7z|.iso> <golf.exe|nocd.zip> [--wait=60] [--every=10]
//        [--profile=<dir>] [--shots=<dir>] [--click=x,y@seconds ...]
//        [--pre=<js run in the page once the game starts>] [--eval=<js run in the page at the end>]
//        [--app=<packaged SimGolf.app>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const args = process.argv.slice(2);
const opts = {};
const clicks = [];
for (const a of args.filter((a) => a.startsWith('--'))) {
  const eq = a.indexOf('=');
  const [k, v] = eq < 0 ? [a.slice(2), ''] : [a.slice(2, eq), a.slice(eq + 1)];
  if (k === 'click') clicks.push(v); else opts[k] = v;
}
const files = args.filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
const profile = opts.profile ? path.resolve(opts.profile) : fs.mkdtempSync(path.join(os.tmpdir(), 'simgolf-smoke-'));
const shots = path.resolve(opts.shots || path.join(profile, 'shots'));
const driver = path.join(desktop, 'scripts/smoke-driver.js');
const smoke = { driver, profile, files, shots, wait: +(opts.wait ?? 60), every: +(opts.every || 10), clicks, pre: opts.pre, eval: opts.eval };
console.log(`profile ${profile}\nscreenshots ${shots}`);
// The packaged app (--app) or the source tree under the development Electron
let cmd = electron, cmdArgs = [desktop];
if (opts.app) {
  cmd = path.join(path.resolve(opts.app), 'Contents/MacOS', path.basename(opts.app, '.app'));
  cmdArgs = [];
}
const child = spawn(cmd, cmdArgs, { stdio: 'inherit', env: { ...process.env, SIMGOLF_SMOKE: JSON.stringify(smoke) } });
child.on('exit', (code) => process.exit(code ?? 1));
