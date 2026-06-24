# @babylon-in-canvas/angular

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Angular 22 components for projecting real Angular DOM/CSS surfaces into
Babylon.js 9.12 WebGPU scenes through Chromium's HTML-in-Canvas APIs.

> **Experimental** — depends on non-standard Chromium APIs not yet available
> in stable browsers. See [Runtime requirements](#runtime-requirements) below.

## Installation

```bash
npm install @babylon-in-canvas/angular
```

Peer dependencies: `@angular/core ^22.0.0`, `@angular/common ^22.0.0`,
`@babylonjs/core ^9.12.0`

## Runtime requirements

The library requires a Chromium-based runtime with the following experimental
features enabled:

| Capability | API |
|---|---|
| WebGPU | `navigator.gpu` |
| Canvas subtree layout | `layoutsubtree` attribute |
| Paint event | `onpaint` / `paint` event |
| GPU copy primitive | `GPUQueue.copyElementImageToTexture` (or equivalent) |
| Element transform | `canvas.getElementTransform` |

These are available in Chromium with the right flags. The library exports the
required switches so you can apply them in whatever host environment you use:

```ts
import { BIC_CHROMIUM_SWITCHES } from '@babylon-in-canvas/angular';

// Electron example
for (const [flag, value] of BIC_CHROMIUM_SWITCHES) {
  app.commandLine.appendSwitch(flag, value ?? '');
}
```

The library **does not** provide a DOM-overlay, WebGL, or compatibility
renderer. It fails cleanly at startup with a capability audit UI when required
APIs are missing — no silent crashes.

## Basic usage

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
    id="settings"
    [position]="position()"
    [rotation]="rotation()"
    [size]="size()"
  >
    <app-settings-panel />
  </bic-surface>
</bic-scene>
```

`bic-surface` content is live Angular-managed DOM — signals, bindings, and
CSS all work normally. Position, rotation, and size are driven by signals.

### Curved surfaces

```html
<bic-surface
  [primitive]="{ kind: 'cylinder', arc: 0.9, tessellation: 36 }"
  interaction="none"
  [position]="pos()"
  [size]="size()"
>
  <div class="curved-bg">Visual-only curved surface</div>
</bic-surface>
```

## SCSS effects

```scss
@use '@babylon-in-canvas/angular/effects' as bic;

.settings-surface {
  @include bic.depth(0.08);
  @include bic.glow($radius: 20px, $intensity: 0.5);
}

// Focus state drives effect intensity via standard CSS cascade
.settings-surface:focus-within {
  @include bic.depth(0.14);
  @include bic.glow($radius: 32px, $intensity: 0.8);
}
```

Mixins emit CSS custom properties (`--bic-depth`, `--bic-glow-radius`, etc).
The runtime reads them via `getComputedStyle` and applies the corresponding
Babylon geometry and glow effects.

## Surface inputs

| Input | Type | Description |
|---|---|---|
| `[position]` | `{ x, y, z }` | World-space position |
| `[rotation]` | `{ x, y, z }` | Euler rotation (radians) |
| `[size]` | `{ width, height }` | Logical CSS size in pixels |
| `[focused]` | `boolean` | Drives CSS class and effect intensity |
| `[primitive]` | `SurfacePrimitive` | `{ kind: 'plane' }` (default) or `{ kind: 'cylinder', arc, tessellation }` |
| `[interaction]` | `'auto' \| 'none'` | Controls pointer-events and inert state |
| `[occlusion]` | `'auto' \| 'none'` | Controls occlusion-based inert detection |

## State machine helpers

```ts
import {
  createSurfaceMachine,
  moveSurface,
  rotateSurface,
  resizeSurface,
  setSurfaceFocus,
} from '@babylon-in-canvas/angular';

const state = createSurfaceMachine();
const moved = moveSurface(state, { x: 0.5, y: 0, z: 0 });
const focused = setSurfaceFocus(moved, true);
```

## Pre-flight audit

```ts
import { auditPreflightCapabilities } from '@babylon-in-canvas/angular';

const audit = auditPreflightCapabilities(canvasElement);
console.log(audit.supported);  // true if all capabilities present
console.log(audit.details);    // { webGpu, layoutSubtree, paintEvent, copyPrimitive, getElementTransform }
```

## Electron configuration exports

```ts
import { BIC_CHROMIUM_FLAGS, BIC_CHROMIUM_SWITCHES } from '@babylon-in-canvas/angular';

// BIC_CHROMIUM_FLAGS — feature flag names
// ['CanvasDrawElement', 'WebGPUDeveloperFeatures']

// BIC_CHROMIUM_SWITCHES — [switch, value?] tuples for app.commandLine.appendSwitch()
```

## License

[AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0) © alizzycraft
