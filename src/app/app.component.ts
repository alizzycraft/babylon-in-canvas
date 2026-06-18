import { ChangeDetectionStrategy, Component, computed, isDevMode, linkedSignal, signal } from '@angular/core';
import { BicSceneComponent } from './bic/angular/bic-scene.component';
import { DemoPanelComponent } from './demo/demo-panel.component';
import { createSurfaceMachine, moveSurface, setSurfaceFocus } from './bic/core/surface-machine';
import { RuntimeProofPanelComponent } from './discovery/runtime-proof-panel.component';

@Component({
  selector: 'bic-root',
  imports: [
    BicSceneComponent,
    DemoPanelComponent,
    RuntimeProofPanelComponent,
  ],
  template: `
    <bic-scene [surface]="surfaceSnapshot()">
      <bic-demo-panel
        [focused]="surfaceSnapshot().focused"
        (focusedChange)="setFocused($event)"
        (nudge)="nudgePanel($event)"
      />
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

  setFocused(focused: boolean): void {
    this.surface.update((state) => setSurfaceFocus(state, focused));
  }

  nudgePanel(direction: 'left' | 'right'): void {
    const delta = direction === 'left' ? -0.16 : 0.16;
    this.surface.update((state) => moveSurface(state, { x: delta, y: 0, z: 0 }));
  }
}
