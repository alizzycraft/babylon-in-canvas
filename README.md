# Babylon in Canvas

Angular 22 library and Electron demo for projecting real Angular DOM/CSS
surfaces into Babylon.js 9.12 WebGPU scenes through HTML-in-Canvas.

The MVP library package is built as `@babylon-in-canvas/angular`.

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

## Library API

```ts
import {
  BicSceneComponent,
  BicSurfaceComponent,
} from '@babylon-in-canvas/angular';
```

```html
<bic-scene>
  <bic-surface
    class="settings-surface"
    [position]="position()"
    [rotation]="rotation()"
    [size]="size()"
  >
    <app-settings-panel />
  </bic-surface>
</bic-scene>
```

```scss
@use '@babylon-in-canvas/angular/effects' as bic;

.settings-surface {
  @include bic.depth(0.08);
  @include bic.glow($radius: 20px, $intensity: 0.5);
}
```

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test:library
```

`pnpm dev` starts Angular's dev server, then launches Electron against it.
`pnpm build` creates the packaged Angular library, verifies its JavaScript,
declarations and SCSS exports, and builds the renderer and Electron host.

The implementation status and acceptance evidence are in
[`docs/mvp-runtime-report.md`](docs/mvp-runtime-report.md).
