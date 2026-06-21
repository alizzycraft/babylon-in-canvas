import { ChangeDetectionStrategy, Component, computed, isDevMode, linkedSignal, signal } from '@angular/core';
import {
  BicSceneComponent,
  BicSurfaceComponent,
  createSurfaceMachine,
  moveSurface,
  resizeSurface,
  rotateSurface,
  setSurfaceFocus,
} from '@babylon-in-canvas/angular';
import { DemoPanelComponent } from './demo/demo-panel.component';
import { RuntimeProofPanelComponent } from './discovery/runtime-proof-panel.component';

@Component({
  selector: 'bic-root',
  imports: [
    BicSceneComponent,
    BicSurfaceComponent,
    DemoPanelComponent,
    RuntimeProofPanelComponent,
  ],
  template: `
    <bic-scene [diagnostics]="false">
      <bic-surface
        class="demo-surface"
        [id]="surfaceSnapshot().id"
        [position]="surfaceSnapshot().position"
        [rotation]="surfaceSnapshot().rotation"
        [size]="surfaceSnapshot().size"
        [focused]="surfaceSnapshot().focused"
      >
        <bic-demo-panel
          [focused]="surfaceSnapshot().focused"
          (focusedChange)="setFocused($event)"
          (nudge)="nudgePanel($event)"
          (rotate)="rotatePanel($event)"
          (resize)="resizePanel($event)"
        />
      </bic-surface>

      <bic-surface
        class="demo-status-surface"
        id="runtime-status"
        [position]="statusPosition"
        [rotation]="statusRotation"
        [size]="statusSize"
      >
        <aside class="runtime-card">
          <strong>MVP library</strong>
          <span>Two Angular surfaces</span>
          <span>DOM → WebGPU → Babylon</span>
        </aside>
      </bic-surface>
    </bic-scene>

    @if (showRuntimeProofPanel) {
      <bic-runtime-proof-panel />
    }
  `,
  styles: `
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly showRuntimeProofPanel = isDevMode();
  private readonly initialSurface = signal(createSurfaceMachine());
  private readonly surface = linkedSignal(() => this.initialSurface());

  readonly surfaceSnapshot = computed(() => this.surface());
  readonly statusPosition = { x: 1.55, y: 1.05, z: 3.15 };
  readonly statusRotation = { x: 0, y: -0.16, z: 0 };
  readonly statusSize = { width: 260, height: 120 };

  setFocused(focused: boolean): void {
    this.surface.update((state) => setSurfaceFocus(state, focused));
  }

  nudgePanel(direction: 'left' | 'right'): void {
    const delta = direction === 'left' ? -0.16 : 0.16;
    this.surface.update((state) => moveSurface(state, { x: delta, y: 0, z: 0 }));
  }

  rotatePanel(direction: 'left' | 'right'): void {
    const delta = direction === 'left' ? -0.08 : 0.08;
    this.surface.update((state) => rotateSurface(state, { x: 0, y: delta, z: 0 }));
  }

  resizePanel(direction: 'grow' | 'shrink'): void {
    const factor = direction === 'grow' ? 1 : -1;
    this.surface.update((state) => resizeSurface(state, {
      width: factor * 40,
      height: factor * 24,
    }));
  }
}
