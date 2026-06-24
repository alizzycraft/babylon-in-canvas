# Babylon-in-Canvas

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Angular 22 library for projecting real Angular DOM/CSS surfaces into Babylon.js
9.12 WebGPU scenes through Chromium's HTML-in-Canvas APIs.

The published package is [`@babylon-in-canvas/angular`](projects/bic-angular/README.md).

## What this repo contains

| Path | Purpose |
|---|---|
| `projects/bic-angular/` | The library (what gets published) |
| `projects/bic-docs/` | Documentation site (deployed to GitHub Pages) |
| `src/` | Electron-based dev harness / demo app |
| `electron/` | Electron main process for the dev harness |
| `integration/angular-consumer/` | Compile-time fixture that verifies the published package is importable from a fresh Angular project |

The dev harness uses Electron because it's the most straightforward way to
enable the required experimental Chromium flags locally. The library itself
has no dependency on Electron — consumers bring their own runtime and apply
`BIC_CHROMIUM_SWITCHES` however suits their environment.

## Architecture principles

- Zoneless Angular only — no `zone.js`
- `ChangeDetectionStrategy.OnPush` throughout
- Signals-first state and derived view models
- HTML-in-Canvas browser APIs sit behind an adapter boundary
- Clean startup failure with capability audit UI when required APIs are missing

## Pinned versions

| Package | Version |
|---|---|
| Angular | `22.0.1` |
| BabylonJS | `9.12.0` |
| Electron (dev harness) | `42.4.0` |
| Node | `^22.22.3 \| ^24.15.0 \| >=26.0.0` |

## Dev setup

```bash
pnpm install
pnpm dev          # starts Angular dev server + Electron
pnpm build        # library + renderer + electron
pnpm build:docs   # docs site → dist/docs
pnpm typecheck    # tsc across all projects
pnpm test:library # unit tests
```

`pnpm dev` starts Angular's dev server then launches Electron against it.
`pnpm build` builds the library (with package verification), the renderer,
and the Electron host.

## Documentation

- [Library README](projects/bic-angular/README.md) — installation, API reference, usage examples
- [`docs/mvp-runtime-report.md`](docs/mvp-runtime-report.md) — implementation status and acceptance evidence
- [`docs/runtime-resilience-report.md`](docs/runtime-resilience-report.md) — device loss recovery architecture

## License

[AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0) © alizzycraft
