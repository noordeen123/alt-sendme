# e2e

Browser end-to-end tests for the web build. Every transfer test moves real
bytes through the real WASM engine and the public iroh relay network, then
asserts SHA-256 equality between what was sent and what arrived — "the UI
said complete" is never the assertion.

## Run

```sh
pnpm build:wasm          # once; the suite refuses to run against a stale/missing bundle
pnpm test:e2e            # chromium: core + errors + interop  (~5 min)
pnpm test:e2e:engines    # firefox + webkit core, webkit->firefox cross-engine
pnpm test:e2e:scale      # 50 MB transfer, 240s budget
pnpm test:e2e:all        # everything
```

Failure artifacts (traces, screenshots, HTML report) land in `e2e/.artifacts/`.

## Layout

```
playwright.config.ts   port 3199 (strict, 127.0.0.1-pinned), one worker, 5 projects
global-setup.ts        preflight: wasm bundle exists, network reachable
fixtures/
  app.ts               page helpers + the blob-capture hook (see below)
  native-peer.ts       builds and drives engine/e2e-harness (binary: e2e-interop)
  test.ts              per-test isolated sender/receiver BrowserContexts
specs/
  core.spec.ts         happy path, metadata preview, share lifecycle   @core
  errors.spec.ts       garbage/dead tickets, closed sender, reload
  interop.spec.ts      web<->native both directions, Id-ticket UX
  cross-engine.spec.ts webkit sender -> firefox receiver          @cross-engine
  scale.spec.ts        50 MB regression floor                          @scale
```

## How integrity is asserted

Headless browsers don't persist anchor-click downloads. `fixtures/app.ts`
installs an init script that wraps `URL.createObjectURL` and records the
SHA-256 + length of every Blob the page mints — the receiver's browser-download
fallback funnels the received file through exactly that call, so the digest of
the delivered bytes is captured without touching the download machinery.

The native side (`engine/e2e-harness`) writes to a real temp dir and is
checksummed from Node.

## Operational notes

- **Real network dependency.** Transfers round-trip through public iroh
  relays: expect ~2–30 s per transfer and occasional relay-side slowness.
  Tests run serially (`workers: 1`) for this reason. Treat this suite as an
  integration gate (local + nightly), not a merge-blocking unit check, until
  a self-hosted relay exists for CI.
- **Port 3199, IPv4-pinned.** `localhost` resolves per-browser (::1 vs
  127.0.0.1); a different service bound on the other stack of the same port
  will silently answer instead. The config pins `--host 127.0.0.1` and the
  baseURL to match.
- **Interop tests need a rust toolchain** (they build `engine/e2e-harness`
  on first run, seconds when warm). They self-skip when `cargo` is absent.
- **CI needs the wasm toolchain** to produce the bundle first:
  `rustup target add wasm32-unknown-unknown`, LLVM clang (`ring` compiles C
  for wasm32; Apple clang can't), and `wasm-bindgen-cli` matching the
  `wasm-bindgen` version in `wasm-bridge/Cargo.lock`.
