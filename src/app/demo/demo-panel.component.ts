import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'bic-demo-panel',
  template: `
    <article class="panel" (focusin)="focusedChange.emit(true)" (focusout)="focusedChange.emit(false)">
      <header class="panel__header">
        <div>
          <p class="panel__eyebrow">Babylon in Canvas</p>
          <h1>Electron surface proof</h1>
        </div>
        <span class="panel__status" [class.panel__status--active]="focused()">
          {{ focused() ? 'Focused' : 'Idle' }}
        </span>
      </header>

      <section class="panel__body">
        <label>
          Surface label
          <input value="Angular-managed DOM" />
        </label>

        <div class="panel__actions">
          <button type="button" (click)="nudge.emit('left')">Move left</button>
          <button type="button" (click)="nudge.emit('right')">Move right</button>
        </div>
      </section>
    </article>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }

    .panel {
      position: relative;
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      padding: 22px;
    }

    .panel__header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .panel__eyebrow {
      margin: 0 0 5px;
      color: #94b7ff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .panel__status {
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 999px;
      padding: 5px 10px;
      color: rgba(244, 247, 251, 0.68);
      font-size: 12px;
      font-weight: 700;
    }

    .panel__status--active {
      border-color: rgba(126, 170, 255, 0.88);
      color: #cfe0ff;
    }

    .panel__body {
      display: grid;
      align-content: center;
      gap: 18px;
    }

    label {
      display: grid;
      gap: 8px;
      color: rgba(244, 247, 251, 0.72);
      font-size: 13px;
      font-weight: 700;
    }

    input {
      width: 100%;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      padding: 11px 12px;
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      outline: none;
    }

    input:focus {
      border-color: rgba(126, 170, 255, 0.9);
      box-shadow: 0 0 0 3px rgba(126, 170, 255, 0.2);
    }

    .panel__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    button {
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      cursor: pointer;
    }

    button:hover {
      background: rgba(126, 170, 255, 0.2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoPanelComponent {
  readonly focused = input(false);
  readonly focusedChange = output<boolean>();
  readonly nudge = output<'left' | 'right'>();
}
