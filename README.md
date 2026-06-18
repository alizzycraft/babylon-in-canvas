# Babylon in Canvas

Angular + BabylonJS + WebGPU surfaces  using HTML-in-Canvas.

## Runtime

This project intentionally starts with Electron, not a browser-only spike. Electron is the starting  host runtime as it allows for Electron specific issues to surface earily, so Electron-specific Chromium flags, WebGPU behavior, DevTools behavior, and packaging constraints.

Pinned core versions:

* Angular `22.0.1`
* BabylonJS `9.12.0`
* Electron `42.4.0`

Angular `22.0.1` requires Node `^22.22.3`, `^24.15.0`, or `>=26.0.0`.

## Architecture Defaults

* Zoneless Angular only: no `zone.js` import or dependency.
* `ChangeDetectionStrategy.OnPush` for Angular components.
* Signals-first state and derived view models.
* Domain-scoped reactive state machines.
* Pure transition/derivation functions inside the modules that own the state.
* Electron/Chromium runtime feature gates are explicit.
* HTML-in-Canvas browser signatures sit behind an adapter boundary.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

`pnpm dev` starts Angular's dev server, then launches Electron against it.
