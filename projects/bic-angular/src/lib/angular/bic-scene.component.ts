import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import * as BABYLON from '@babylonjs/core';
import {
  BicSceneRuntime,
  BicSceneRuntimeStatus,
} from '../runtime/bic-scene-runtime';

@Component({
  selector: 'bic-scene',
  providers: [BicSceneRuntime],
  template: `
    <section class="bic-scene-shell">
      <canvas #canvas class="bic-scene-canvas"></canvas>
      <canvas #surfaceCanvas class="bic-surface-canvas" layoutsubtree>
        <ng-content />
      </canvas>

      @if (status().kind === 'failed') {
        <div class="bic-runtime-error" role="alert">
          <strong>Babylon-in-Canvas could not start.</strong>
          <span>{{ failureMessage() }}</span>
        </div>
      }

      @if (diagnostics()) {
        <output class="bic-diagnostics">
          {{ diagnosticText() }}
        </output>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .bic-scene-shell {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .bic-scene-canvas,
    .bic-surface-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    .bic-scene-canvas {
      z-index: 1;
      display: block;
    }

    .bic-surface-canvas {
      z-index: 2;
      pointer-events: none;
    }

    .bic-runtime-error,
    .bic-diagnostics {
      position: absolute;
      z-index: 20;
      left: 16px;
      bottom: 16px;
      max-width: min(640px, calc(100% - 32px));
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(8, 10, 16, 0.9);
      color: #f5f7fb;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .bic-runtime-error {
      display: grid;
      gap: 4px;
      border-color: rgba(255, 110, 110, 0.6);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BicSceneComponent implements AfterViewInit, OnDestroy {
  readonly runtime = inject(BicSceneRuntime);
  readonly engineOptions = input<BABYLON.WebGPUEngineOptions>({});
  readonly diagnostics = input(false);
  readonly ready = output<void>();
  readonly runtimeError = output<string>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly surfaceCanvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('surfaceCanvas');

  readonly status = this.runtime.status.asReadonly();
  readonly failureMessage = computed(() => {
    const status = this.status();
    return status.kind === 'failed' ? status.message : '';
  });
  readonly diagnosticText = computed(() => JSON.stringify({
    status: this.status(),
    surfaces: this.runtime.snapshots(),
  }));

  async ngAfterViewInit(): Promise<void> {
    try {
      await this.runtime.initialize(
        this.canvasRef().nativeElement,
        this.surfaceCanvasRef().nativeElement,
        { engineOptions: this.engineOptions() },
      );
      this.ready.emit();
    } catch (error) {
      this.runtimeError.emit(error instanceof Error ? error.message : String(error));
    }
  }

  ngOnDestroy(): void {
    this.runtime.dispose();
  }
}

export type { BicSceneRuntimeStatus };
