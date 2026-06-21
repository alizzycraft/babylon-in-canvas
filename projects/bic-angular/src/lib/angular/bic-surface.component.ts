import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
} from '@angular/core';
import { BicSceneRuntime } from '../runtime/bic-scene-runtime';
import { SurfaceSize, SurfaceState, Vec3 } from '../core/surface-types';

const defaultPosition: Vec3 = { x: 0, y: 0, z: 2.8 };
const defaultRotation: Vec3 = { x: 0, y: 0, z: 0 };
const defaultSize: SurfaceSize = { width: 640, height: 420 };
let nextSurfaceId = 1;

@Component({
  selector: 'bic-surface',
  template: `
    <div
      class="bic-surface-content"
      [style.width.px]="size().width"
      [style.height.px]="size().height"
      [style.transform]="contentTransform()"
    >
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      left: 0;
      top: 0;
      display: block;
      overflow: hidden;
      contain: layout paint style;
      pointer-events: auto;
      transform-origin: 0 0;
      will-change: transform;
    }

    .bic-surface-content {
      transform-origin: 0 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BicSurfaceComponent implements AfterViewInit, OnDestroy {
  readonly id = input(`bic-surface-${nextSurfaceId++}`);
  readonly position = input<Vec3>(defaultPosition);
  readonly rotation = input<Vec3>(defaultRotation);
  readonly size = input<SurfaceSize>(defaultSize);
  readonly focused = input(false);

  readonly state = computed<SurfaceState>(() => ({
    id: this.id(),
    position: this.position(),
    rotation: this.rotation(),
    size: this.size(),
    focused: this.focused(),
    revision: 0,
  }));
  readonly contentTransform = computed(() => `scale(${this.runtime.devicePixelRatio()})`);

  private stopRegistration: (() => void) | null = null;

  constructor(
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly runtime: BicSceneRuntime,
  ) {
    effect(() => {
      const state = this.state();
      const host = this.elementRef.nativeElement;
      const devicePixelRatio = this.runtime.devicePixelRatio();

      host.style.width = `${Math.ceil(state.size.width * devicePixelRatio)}px`;
      host.style.height = `${Math.ceil(state.size.height * devicePixelRatio)}px`;
      host.dataset['bicSurface'] = state.id;
      host.dataset['bicFocused'] = String(state.focused);
      host.dataset['bicDevicePixelRatio'] = String(devicePixelRatio);
      host.classList.toggle('bic-surface--focused', state.focused);
      this.runtime.update(state.id, state);
    });
  }

  ngAfterViewInit(): void {
    this.stopRegistration = this.runtime.register({
      host: this.elementRef.nativeElement,
      state: this.state(),
    });
  }

  ngOnDestroy(): void {
    this.stopRegistration?.();
    this.stopRegistration = null;
  }
}
