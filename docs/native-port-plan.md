# Plan: a native SimGolf (no browser engine)

Status: planned, not started. The Electron app in `desktop/` is the interim
standalone version; this is the follow-up that drops the browser engine
entirely for speed and smoothness. A ready-to-use prompt for starting the work
is at the end.

## Why it can't just be compiled natively

The game's C is generated from a Ghidra decompile of `golf.exe` and
`jgld.dll` (`docs/porting.md`). It assumes a 32-bit address space: each
module's image sits at its original virtual address (golf at `0x400000`,
jgld at `0x10000000`), globals are accessed as `*(T *)0x4e6d20`, pointers are
stored in 32-bit fields, address 0 is ordinary memory, and negative array
indices must wrap. wasm32 gives exactly that, which is why the port targets
WebAssembly.

A plain native build can't. On Apple Silicon, macOS reserves the whole low
4 GB (`__PAGEZERO`) for arm64 processes, so nothing can live at those
addresses, and 64-bit pointers don't fit the game's 32-bit fields anyway.

## Approach: wasm32 as the address space, wasm2c for native code

1. Compile the game and the port runtime to **wasm32** as today (same
   address layout, same semantics, same hand fixes), but against a small
   **host API** instead of Emscripten's browser glue.
2. Translate the module with **wasm2c** (WABT) into C and compile that with
   clang `-O2` for the host CPU. The game's memory is one 4 GB reservation
   with guard pages; every access is `base + offset`, so the 32-bit layout is
   kept exactly, at close to native speed.
3. A **native host** (C/C++, SDL2) implements the host API: window and input,
   GPU presentation, audio, files, time. Blocking calls just block: the
   game's main loop runs as written, with no JSPI and no event-loop round trips.

This keeps a single game codebase for web and native: only the platform layer
differs.

### What the host API has to cover

From a survey of the current code, the browser-specific surface is small:

| Area | Today (web) | Native host |
|---|---|---|
| Yield / frame | Win32 message functions suspend via JSPI (`src/port/win32.c`, `win32.h`) | `host_yield()`: pump SDL events, present, pace to the display |
| Input | SDL2 (Emscripten port) events in `pump_sdl()` | Real SDL2 events (same code, or forwarded as plain structs) |
| Time | `emscripten_get_now()` (timers and tick counts in `win32.c`) | `SDL_GetPerformanceCounter` |
| Display | `src/platform/hd_web.js`: WebGL2. The 800 × 600 RGB555 frame (R16UI texture, decoded in shaders, xBR filter), terrain triangles replayed at output resolution, game text drawn with Canvas2D in the game's fonts | Same pipeline in OpenGL 3.3 core (or SDL3 GPU / Metal later); text with `stb_truetype` (already in `third_party/stb`) and the fonts in `third_party/fonts`. 8 functions: `hd_js_active/terrain_on/text_on/font/text/texture/terrain/frame` |
| Sound | `src/platform/sound_web.js`: Web Audio. 6 functions: `snd_js_init/register/play/fade_out/stop/shutdown` | SDL2 audio callback with a small mixer (or miniaudio) |
| Video | `src/port/video.c`: a `<video>` element playing WebM made from the Bink files at install | Decode Bink with FFmpeg's libavcodec (it has a Bink decoder), or convert once at install |
| Files | `src/port/fs.c`: game files fetched on first open, saves mirrored to IndexedDB (IDBFS) | Plain files: the unpacked game in the app data folder, saves in a `Saves` folder there |
| Misc | `EM_ASM`/`EM_JS` debugging hooks in `runtime.c`, `gdi.c`, `port_main.c`, `hd.c` | Plain C or no-ops |

## Phases

### 0. Toolchain (Homebrew, about 1–2 GB)

`brew install ghidra openjdk@21 cmake wabt` (Ghidra 12.1.x is what the
scripts expect; `/opt/homebrew/opt/ghidra/...`). Also `emscripten`, to keep
the web build working and to compare against. The wasm32 compile for the
native path can use Homebrew's LLVM (`/opt/homebrew/opt/llvm`, has the wasm32
target and `wasm-ld`) with `wasi-libc`, or `emcc -sSTANDALONE_WASM`.

### 1. Rebuild the decompile (the long pole)

The generated C isn't in the repo and has to be regenerated from the user's
own `golf.exe` (v1.02 no-CD) and `jgld.dll` (from the disc install):

1. Unpack the game into `game/` (`unshield x data1.cab` on the disc, or copy
   from the Electron app's install).
2. Create the Ghidra project `~/ghidra_work/projects/SimGolfDeps` and import
   `golf_nocd.exe` (the no-CD `golf.exe`) and `jgld.dll`; run auto-analysis.
3. Undocumented steps to reconstruct (check each script's header and
   arguments): `projects_copy` with `RecoverFunctions.java` run on jgld; the
   `purges_golf.txt` / `purges_jgld.txt` bootstrap (`prepare-golf.sh` needs the
   jgld purges and `prepare-jgld.sh` the golf ones, so run `VtablePurges.java`
   on both first); `fixjumptables.txt`.
4. `tools/ghidra/prepare-jgld.sh`, `tools/ghidra/prepare-golf.sh` (about 1.5 h),
   `tools/translate/run.sh`. Then repeat prepare + translate while
   `build/gen/*/void_used.txt` keeps growing (each pass uncovers more), until
   it stops changing.
5. **Validate** before going native: build the existing web targets
   (`emcmake cmake -B build/web`, `tools/pages/build.sh`) and check the result
   plays like the published build. Point the Electron app at it with
   `npm run prepare-site -- --from build/pages/site` and run the smoke test.
   The patches in `tools/translate/*.json` are keyed to the decompiler's text,
   so failures to apply them show where this export differs from the original.

Fallback if the decompile can't be reproduced faithfully: wasm2c the
published `golf.wasm` and implement its Emscripten imports natively. That's
faster to start, but it ties the native app to a binary that can't be rebuilt
or fixed, so treat it as a last resort.

### 2. Platform seam (keeps the web build working)

Introduce `src/host/host.h` (yield, time, present, sound, video, file and
save hooks) and route the Emscripten-specific code above through it. The web
implementation stays as is (JS libraries, JSPI); a native implementation is
added beside it. Build both after each step.

### 3. Native build

- New CMake target `golf_native`: compile the generated C, `src/port/*` and
  the overrides to wasm32 with the same flags as today (`-O1 -fwrapv
  -fwrapv-pointer -fno-strict-aliasing -fno-delete-null-pointer-checks
  -fno-finite-loops`) and the same memory layout (`--global-base=272MB`,
  stack size, initial memory 384 MB).
- `wasm2c golf.wasm --num-outputs=8` (splits the output so it compiles in
  parallel), compile with `-O2`, link with WABT's `wasm-rt-impl.c`
  (`WASM_RT_MEMCHECK_GUARD_PAGES`) and the host.
- Host: SDL2 window (resizable, 4:3, fullscreen), GL 3.3 core port of
  `hd_web.js`'s three shaders (frame decode + xBR, terrain, text), SDL audio
  mixer for `sound.cpp`'s voices, libavcodec Bink playback, plain-file
  storage.

### 4. Native installer

Port `web/pages/install-worker.js` to C so the app still takes the user's own
files: 7z (LZMA SDK, public domain), raw BIN/CUE → ISO 9660 reader, unshield
(`third_party/unshield`, C), the SHA-1 check of the no-CD `golf.exe`, PE
mapping like `tools/pages/pe-image.mjs`, the jgld NOP runs from
`web/pages/jgld-nops.json`. Optionally import an existing install from the
Electron app's profile.

### 5. Package

macOS `.app` via CMake `MACOSX_BUNDLE` (ad-hoc signed; Developer ID +
notarization to share), then Windows (clang-cl or MinGW, SDL2) and Linux
(AppImage). Same game-file rule as now: no game data in the package.

## Testing

- Same scenario as `desktop/scripts/smoke-test.mjs` (install → intro → new
  game → course view), compared screenshot by screenshot with the Electron
  build.
- Saves made in one build load in the other (same `.sve` files).
- Frame pacing: frame time histogram while scrolling a full course; sound
  sync; video playback.

## Risks

- Reproducing the decompile exactly (Ghidra version, analysis options, the
  undocumented steps). It's the main schedule risk; phase 1 validates it
  before anything else depends on it.
- wasm2c output is large. Split outputs and `-O2` (not `-O3`) keep compile
  times reasonable.
- macOS has deprecated OpenGL (it still works). If that becomes a problem,
  move presentation to SDL3's GPU API (Metal).

---

## Prompt for starting the native port

Paste this into a new Claude Code session in this folder:

```text
I want to build a true native version of SimGolf (no browser engine) from
this repo, following docs/native-port-plan.md. Read that plan, plus
docs/porting.md, docs/building.md and desktop/README.md, before doing
anything.

Context and constraints:
- Work locally only: don't commit, push or open PRs on the GitHub repo.
- Never bundle or commit game files. My own copies for testing are in the
  repo root: "Sid Meier's SimGolf (USA) (Rerelease) (20031103).7z" and
  SIMGOLF.102.ENG.MYTH.NOCD/golf.exe. The finished app must ask the player
  for their own copies, like the web and desktop versions do.
- The Electron app in desktop/ is the working reference: same game, run its
  smoke test (desktop/scripts/smoke-test.mjs) to compare behaviour and
  screenshots.
- Target macOS on Apple Silicon first, structured so Windows and Linux can
  follow.

Start with phases 0 and 1: install the toolchain with Homebrew (tell me the
sizes first), regenerate the Ghidra decompile and translation, reconstructing
the undocumented steps the plan lists, and validate it by building the
existing web/Pages targets and running them through the Electron app. Report
back before starting phase 2. Keep a running log of the steps you had to
reconstruct in docs/native-port-log.md so the decompile can be reproduced
later.
```
