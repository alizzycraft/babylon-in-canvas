import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { BicSceneComponent } from '@babylon-in-canvas/angular';
import { RuntimeProofRunnerService } from './runtime-proof-runner.service';
import { RuntimeProofResult, RuntimeProofStatus } from './runtime-proof.types';
import '../bic/core/runtime-environment';

@Component({
  selector: 'bic-runtime-proof-panel',
  template: `
    <aside class="proof-panel">
      <header class="proof-panel__header">
        <div>
          <p class="proof-panel__eyebrow">Discovery</p>
          <h2>Runtime proofs</h2>
        </div>
        <div class="proof-panel__actions">
          @if (!collapsed()) {
            <button type="button" (click)="runProofs()" [disabled]="running()">
              {{ running() ? 'Running' : 'Run proofs' }}
            </button>
          }
          <button
            type="button"
            aria-controls="runtime-proof-results"
            [attr.aria-expanded]="!collapsed()"
            (click)="collapsed.update(value => !value)"
          >
            {{ collapsed() ? 'Expand' : 'Collapse' }}
          </button>
        </div>
      </header>

      @if (!collapsed()) {
        <ol id="runtime-proof-results" class="proof-list">
          @if (lastSavedPath()) {
            <li class="proof-list__saved">Saved latest run to {{ lastSavedPath() }}</li>
          }

          @for (proof of results(); track proof.name) {
            <li class="proof-list__item" [class]="statusClass(proof.status)">
              <span class="proof-list__status">{{ statusIcon(proof.status) }}</span>
              <div>
                <strong>{{ proof.name }}</strong>
                <pre>{{ stringify(proof) }}</pre>
              </div>
            </li>
          } @empty {
            <li class="proof-list__empty">Run the proofs to collect runtime evidence.</li>
          }
        </ol>
      }

      <canvas #babylonProofCanvas class="proof-canvas" aria-hidden="true"></canvas>
      <canvas #htmlProofCanvas class="proof-canvas" layoutsubtree aria-hidden="true">
        <div #copySurface class="copy-surface">
          <span class="copy-surface__marker copy-surface__marker--tl">TL</span>
          <span class="copy-surface__marker copy-surface__marker--tr">TR</span>
          <span class="copy-surface__marker copy-surface__marker--bl">BL</span>
          <span class="copy-surface__marker copy-surface__marker--br">BR</span>
          <strong>Copy proof</strong>
          <span>HTML-in-Canvas to WebGPU</span>
        </div>
      </canvas>

      <div #domSurface class="proof-dom-surface">
        <button type="button">Click me</button>
        <input value="edit me" />
        <select>
          <option>One</option>
          <option>Two</option>
        </select>
      </div>
    </aside>
  `,
  styles: `
    .proof-panel {
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 10;
      display: grid;
      gap: 12px;
      width: min(460px, calc(100vw - 32px));
      box-sizing: border-box;
      max-height: calc(100vh - 32px);
      overflow-x: hidden;
      overflow-y: auto;
      scrollbar-gutter: stable;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      background: rgba(10, 13, 20, 0.84);
      color: #f4f7fb;
      font-size: 12px;
      backdrop-filter: blur(16px);
    }

    .proof-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }

    .proof-panel__actions {
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
      padding-right: 2px;
    }

    .proof-panel__eyebrow {
      margin: 0 0 3px;
      color: #94b7ff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h2 {
      margin: 0;
      font-size: 16px;
      letter-spacing: 0;
    }

    button {
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      cursor: pointer;
    }

    button:disabled {
      cursor: progress;
      opacity: 0.68;
    }

    .proof-list {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 0;
      margin: 0;
      list-style: none;
    }

    .proof-list__item {
      display: grid;
      grid-template-columns: 24px 1fr;
      gap: 8px;
      min-width: 0;
      padding: 9px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
    }

    .proof-list__item--pass {
      border-color: rgba(98, 210, 145, 0.36);
    }

    .proof-list__item--partial,
    .proof-list__item--blocked {
      border-color: rgba(245, 194, 92, 0.38);
    }

    .proof-list__item--fail {
      border-color: rgba(255, 112, 112, 0.42);
    }

    .proof-list__status {
      font-weight: 700;
    }

    .proof-list__item > div {
      min-width: 0;
    }

    .proof-list__empty {
      color: rgba(244, 247, 251, 0.68);
    }

    .proof-list__saved {
      color: rgba(161, 210, 255, 0.8);
      overflow-wrap: anywhere;
    }

    pre {
      width: 100%;
      min-width: 0;
      max-height: 180px;
      overflow-x: hidden;
      overflow-y: auto;
      margin: 7px 0 0;
      color: rgba(244, 247, 251, 0.7);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .proof-canvas {
      width: 128px;
      height: 96px;
      opacity: 0.01;
      pointer-events: none;
      position: absolute;
      left: 12px;
      bottom: 12px;
    }

    .proof-dom-surface {
      position: absolute;
      left: -2000px;
      top: 0;
      display: grid;
      gap: 8px;
      width: 220px;
      padding: 12px;
      background: #182034;
      color: #ffffff;
    }

    .copy-surface {
      position: relative;
      display: grid;
      align-content: center;
      gap: 4px;
      width: 128px;
      height: 96px;
      padding: 10px;
      border: 3px solid #ffffff;
      background: linear-gradient(135deg, #2458ff, #27d17f);
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
    }

    .copy-surface > span:not(.copy-surface__marker) {
      color: rgba(255, 255, 255, 0.82);
      font-size: 10px;
    }

    .copy-surface__marker {
      position: absolute;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      color: #000000;
      font: 800 9px/1 sans-serif;
    }

    .copy-surface__marker--tl {
      top: 0;
      left: 0;
      background: #ff0000;
    }

    .copy-surface__marker--tr {
      top: 0;
      right: 0;
      background: #00ff00;
    }

    .copy-surface__marker--bl {
      bottom: 0;
      left: 0;
      background: #0000ff;
      color: #ffffff;
    }

    .copy-surface__marker--br {
      right: 0;
      bottom: 0;
      background: #ffff00;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuntimeProofPanelComponent implements AfterViewInit {
  readonly scene = input<BicSceneComponent | null>(null);
  private readonly runner = inject(RuntimeProofRunnerService);
  private readonly babylonProofCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('babylonProofCanvas');
  private readonly htmlProofCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('htmlProofCanvas');
  private readonly copySurface = viewChild.required<ElementRef<HTMLElement>>('copySurface');
  private readonly domSurface = viewChild.required<ElementRef<HTMLElement>>('domSurface');

  readonly results = signal<readonly RuntimeProofResult[]>([]);
  readonly running = signal(false);
  readonly lastSavedPath = signal<string | null>(null);
  readonly collapsed = signal(true);
  readonly latestSummary = computed(() => this.results().map((result) => `${result.name}:${result.status}`).join(', '));

  ngAfterViewInit(): void {
    queueMicrotask(() => void this.runProofs());
  }

  async runProofs(): Promise<void> {
    if (this.running()) {
      return;
    }

    this.running.set(true);

    try {
      const results = await this.runner.runAll({
        babylonCanvas: this.babylonProofCanvas().nativeElement,
        htmlCanvas: this.htmlProofCanvas().nativeElement,
        copySurface: this.copySurface().nativeElement,
        domSurface: this.domSurface().nativeElement,
        sceneRuntime: this.scene()?.runtime,
      });

      this.results.set(results);
      console.info('[runtime-proof] summary', this.latestSummary());
      await this.saveProofRun(results);
    } finally {
      this.running.set(false);
    }
  }

  stringify(result: RuntimeProofResult): string {
    return JSON.stringify(result, null, 2);
  }

  statusClass(status: RuntimeProofStatus): string {
    return `proof-list__item--${status}`;
  }

  statusIcon(status: RuntimeProofStatus): string {
    return {
      pass: 'PASS',
      partial: 'PART',
      fail: 'FAIL',
      blocked: 'BLKD',
    }[status];
  }

  private async saveProofRun(results: readonly RuntimeProofResult[]): Promise<void> {
    const saveRun = window.bicRuntimeProofs?.saveRun;

    if (!saveRun) {
      console.info('[runtime-proof] save skipped; Electron proof persistence API is unavailable.');
      this.lastSavedPath.set(null);
      return;
    }

    const generatedAt = new Date().toISOString();
    const response = await saveRun({
      generatedAt,
      summary: summarizeProofResults(results),
      results,
    });

    this.lastSavedPath.set(response.markdownPath);
    console.info('[runtime-proof] saved', response);
  }
}

function summarizeProofResults(results: readonly RuntimeProofResult[]): string {
  return results.map((result) => `${result.name}:${result.status}`).join(', ');
}
