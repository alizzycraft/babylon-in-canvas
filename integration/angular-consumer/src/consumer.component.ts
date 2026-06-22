import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  BicSceneComponent,
  BicSurfaceComponent,
  SurfacePrimitive,
  createSurfaceMachine,
} from '@babylon-in-canvas/angular';

@Component({
  selector: 'bic-consumer-fixture',
  imports: [BicSceneComponent, BicSurfaceComponent],
  template: `
    <bic-scene>
      <bic-surface
        id="consumer-plane"
        [position]="surface.position"
        [rotation]="surface.rotation"
        [size]="surface.size"
      >
        <button type="button">Packaged plane</button>
      </bic-surface>

      <bic-surface
        id="consumer-cylinder"
        [position]="curvedPosition"
        [rotation]="surface.rotation"
        [size]="curvedSize"
        [primitive]="curvedPrimitive"
        interaction="none"
      >
        <strong>Packaged curved surface</strong>
      </bic-surface>
    </bic-scene>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsumerComponent {
  readonly surface = createSurfaceMachine();
  readonly curvedPosition = { x: -1.2, y: 0.6, z: 3 };
  readonly curvedSize = { width: 300, height: 140 };
  readonly curvedPrimitive: SurfacePrimitive = {
    kind: 'cylinder',
    arc: 0.8,
    tessellation: 32,
  };
}
