# SimGolf desktop app

SimGolf in its own window instead of a browser tab. It's the same WebAssembly
build as the web version, packaged with Electron so it:

- runs offline: nothing is loaded from the network (fonts are bundled, the
  play counter is blocked, links open in your default browser);
- never gets throttled when the window is in the background or covered;
- keeps a fixed, known-good Chromium (JSPI support), whatever browser you use;
- keeps the game files and saves in the app's own profile
  (`~/Library/Application Support/SimGolf` on macOS), not in a browser.

Like the web version, **the app contains none of the game's files**. On first
run it asks for your own SimGolf disc image (the Internet Archive `.7z`, or an
`.iso`) and the v1.02 no-CD `golf.exe` (or its zip), unpacks them in about a
minute and keeps the result. Saves work as on the web: **Ctrl+F8** in the game
opens the saves panel (export/import `.sve` files, start over with different
game files).

## Build

Needs Node 20+. From `desktop/`:

```sh
npm install
npm run prepare-site     # fills desktop/site with the web build (see below)
npm start                # run from source
npm run dist:mac         # dist/SimGolf-<version>-arm64.dmg and .zip
npm run dist             # just dist/mac-arm64/SimGolf.app
```

`prepare-site` takes the web build from, in order:

1. `--from <dir>`: any Pages build;
2. `build/pages/site` in this repo, if you've built it from source
   (`tools/pages/build.sh`, which needs the Ghidra decompile; see
   `docs/building.md`);
3. otherwise the published build (`RichardAtCT/simgolf-web`, branch
   `gh-pages`), fetched with git. Pass `--upstream` to force this.

It refuses a build whose `golf.data` holds anything but fonts, so a
development build (`build/web`, which preloads the decompiled module images)
can't end up in the app. `site/desktop-site.json` records which build went in.

The icon is drawn by `scripts/make-icon.js` (`npm run icon`) into
`resources/icon.png`.

Builds are ad-hoc signed, which is enough to run on the Mac that built them.
To hand the app to others without Gatekeeper warnings it needs a Developer ID
signature and notarization (`mac.identity` and `notarize` in `package.json`).

## Windows and Linux

`package.json` already has `win` (NSIS installer, x64) and `linux` (AppImage)
targets, and nothing in `main.js` is macOS-only. Build them on those systems
with `npm run dist:win` / `npm run dist:linux`. Not tested yet.

## Testing

`scripts/smoke-test.mjs` runs the app against a throwaway profile, installs
the game from the files you give it, clicks where you tell it and takes
screenshots:

```sh
node scripts/smoke-test.mjs "../Sid Meier's SimGolf (USA) (Rerelease) (20031103).7z" \
  ../SIMGOLF.102.ENG.MYTH.NOCD/golf.exe --wait=40
# then, reusing the installed profile: skip the intro, Start New Game, Easy, first course
node scripts/smoke-test.mjs --profile=<dir printed above> --wait=60 \
  --click=512,384@3 --click=729,143@12 --click=497,160@20 --click=351,49@30
```

Add `--app=dist/mac-arm64/SimGolf.app` to test the packaged app instead.
Other options: `--every=<s>` (screenshot interval), `--shots=<dir>`,
`--pre=<js>` / `--eval=<js>` (run in the page after start / at the end).
Clicks are in pixels of the default 1024 × 768 window.

## Files

| File | What it does |
|---|---|
| `main.js` | Main process: serves `site/` on `app://simgolf/`, the window (4:3, 1024 × 768 to start), menus, offline lock-down, flushing saves on quit |
| `preload.js` | Rewords the setup page for an app ("this browser" → "this computer"), hides the play counter |
| `scripts/prepare-site.mjs` | Copies a web build into `site/`, bundles the fonts, checks no game data is included |
| `scripts/smoke-test.mjs`, `scripts/smoke-driver.js` | Automated install / play / screenshot runs |
| `scripts/make-icon.js` | Draws `resources/icon.png` |

The longer-term plan, a native build without a browser engine, is in
[`docs/native-port-plan.md`](../docs/native-port-plan.md).
