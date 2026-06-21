# @babylon-in-canvas/angular

Experimental Angular 22 components for projecting real Angular DOM/CSS surfaces
into a Babylon.js 9.12 WebGPU scene through Chromium's HTML-in-Canvas APIs.

## Runtime requirements

- Electron 42.4.0 or a compatible Chromium runtime
- WebGPU
- HTML-in-Canvas `layoutsubtree`, `paint`, copy, and transform capabilities
- Angular zoneless change detection

The library intentionally fails at startup when the required browser APIs are
missing. It does not provide a DOM-overlay, WebGL, or compatibility renderer.

## Angular API

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

`bic-surface` content remains live Angular-managed DOM. Position, rotation, and
size inputs can be driven by signals.

## SCSS effects

```scss
@use '@babylon-in-canvas/angular/effects' as bic;

.settings-surface {
  @include bic.depth(0.08);
  @include bic.glow($radius: 20px, $intensity: 0.5);
}
```

The mixins emit inspectable CSS custom properties. The runtime reads those
properties and updates Babylon depth geometry and glow effects.
