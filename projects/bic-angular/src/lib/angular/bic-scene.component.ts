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
import type { WebGPUEngineOptions } from '@babylonjs/core/pure.js';
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
          <strong class="bic-error-title">Babylon-in-Canvas could not start.</strong>
          <span class="bic-error-msg">{{ failureMessage() }}</span>
          
          @if (missingCaps().length > 0) {
            <div class="bic-caps-audit">
              <div class="bic-cap-row">
                <span class="bic-cap-label">WebGPU (navigator.gpu)</span>
                <span class="bic-cap-status" [class.passed]="hasCap('webGpu')">{{ hasCap('webGpu') ? 'PASS' : 'FAIL' }}</span>
              </div>
              <div class="bic-cap-row">
                <span class="bic-cap-label">Canvas Subtree (layoutsubtree)</span>
                <span class="bic-cap-status" [class.passed]="hasCap('layoutSubtree')">{{ hasCap('layoutSubtree') ? 'PASS' : 'FAIL' }}</span>
              </div>
              <div class="bic-cap-row">
                <span class="bic-cap-label">Paint Event (onpaint)</span>
                <span class="bic-cap-status" [class.passed]="hasCap('paintEvent')">{{ hasCap('paintEvent') ? 'PASS' : 'FAIL' }}</span>
              </div>
              <div class="bic-cap-row">
                <span class="bic-cap-label">GPU Copy Primitive</span>
                <span class="bic-cap-status" [class.passed]="hasCap('copyPrimitive')">{{ hasCap('copyPrimitive') ? 'PASS' : 'FAIL' }}</span>
              </div>
              <div class="bic-cap-row">
                <span class="bic-cap-label">Element Transform (getElementTransform)</span>
                <span class="bic-cap-status" [class.passed]="hasCap('getElementTransform')">{{ hasCap('getElementTransform') ? 'PASS' : 'FAIL' }}</span>
              </div>
            </div>
            <p class="bic-error-hint">
              Ensure your Electron configuration registers the required flags or uses the exported switches.
            </p>
          }
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
      gap: 12px;
      border-color: rgba(255, 110, 110, 0.6);
      background: rgba(12, 14, 22, 0.95);
      border-radius: 12px;
      padding: 16px 20px;
      width: 420px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .bic-error-title {
      font-size: 14px;
      color: #ff8080;
      font-weight: bold;
    }

    .bic-error-msg {
      font-size: 12px;
      color: #cbd5e1;
    }

    .bic-caps-audit {
      display: grid;
      gap: 6px;
      background: rgba(255, 255, 255, 0.04);
      padding: 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .bic-cap-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
    }

    .bic-cap-label {
      color: #94a3b8;
    }

    .bic-cap-status {
      font-weight: bold;
      color: #f87171;
    }

    .bic-cap-status.passed {
      color: #4ade80;
    }

    .bic-error-hint {
      margin: 0;
      font-size: 10px;
      color: #64748b;
      line-height: 1.4;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BicSceneComponent implements AfterViewInit, OnDestroy {
  readonly runtime = inject(BicSceneRuntime);
  readonly engineOptions = input<WebGPUEngineOptions>({});
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
  readonly missingCaps = computed(() => {
    const status = this.status();
    return status.kind === 'failed' ? (status.missingCapabilities ?? []) : [];
  });

  hasCap(capName: string): boolean {
    const status = this.status();
    if (status.kind !== 'failed') return true;
    if (status.auditedCapabilities) {
      return !!status.auditedCapabilities[capName];
    }
    return !status.missingCapabilities?.includes(capName);
  }
 
  async ngAfterViewInit(): Promise<void> {
    try {
      await this.runtime.initialize(
        this.canvasRef().nativeElement,
        this.surfaceCanvasRef().nativeElement,
        { engineOptions: this.engineOptions() },
      );
      if (this.status().kind === 'ready') {
        this.ready.emit();
      } else {
        const status = this.status();
        if (status.kind === 'failed') {
          this.runtimeError.emit(status.message);
        }
      }
    } catch (error) {
      this.runtimeError.emit(error instanceof Error ? error.message : String(error));
    }
  }
 
  ngOnDestroy(): void {
    this.runtime.dispose();
  }
}

export type { BicSceneRuntimeStatus };
