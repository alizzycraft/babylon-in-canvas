import { ChangeDetectionStrategy, Component, signal, computed } from '@angular/core';

type Section = 'intro' | 'setup' | 'usage' | 'effects' | 'api';

@Component({
  selector: 'app-root',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="docs-shell">
      <header class="docs-header">
        <div class="docs-header-inner">
          <a class="docs-logo" href="./">
            <span class="logo-icon">◆</span>
            <span class="logo-text">Babylon-in-Canvas</span>
          </a>
          <nav class="docs-nav">
            @for (item of navItems(); track item.id) {
              <button
                class="nav-link"
                [class.active]="activeSection() === item.id"
                (click)="activeSection.set(item.id)"
              >{{ item.label }}</button>
            }
          </nav>
          <a
            class="release-link"
            href="https://github.com/AliStarr/babylon-in-canvas/releases/latest"
            target="_blank"
            rel="noopener"
          >Latest Release ↗</a>
        </div>
      </header>

      <main class="docs-main">
        @switch (activeSection()) {
          @case ('intro') {
            <section class="docs-section">
              <div class="hero">
                <div class="hero-badge">Experimental</div>
                <h1 class="hero-title">
                  Angular Surfaces<br>
                  <span class="hero-accent">for WebGPU Scenes</span>
                </h1>
                <p class="hero-subtitle">
                  Project real Angular DOM and CSS into BabylonJS WebGPU scenes
                  using the emerging HTML-in-Canvas browser APIs.
                </p>
                <div class="hero-actions">
                  <button class="btn btn-primary" (click)="activeSection.set('setup')">Get Started</button>
                  <a class="btn btn-ghost"
                    href="https://github.com/AliStarr/babylon-in-canvas"
                    target="_blank" rel="noopener">GitHub ↗</a>
                </div>
              </div>

              <div class="feature-grid">
                <div class="feature-card">
                  <div class="feature-icon">🎨</div>
                  <h3>Real CSS Layout</h3>
                  <p>Grid, flexbox, custom properties, pseudo-classes — the browser handles all layout and styling.</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">⚡</div>
                  <h3>Zero-Readback GPU</h3>
                  <p>DOM surfaces copy directly to WebGPU textures. No CPU readbacks. No canvas.toDataURL().</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">🔍</div>
                  <h3>DevTools Inspectable</h3>
                  <p>Every projected surface remains a live DOM subtree — fully inspectable and editable in Chrome DevTools.</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">🔄</div>
                  <h3>Signals-First</h3>
                  <p>Angular signals coordinate DOM and Babylon scene objects with no brittle mutation loops.</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">🛡️</div>
                  <h3>Resilient Runtime</h3>
                  <p>Automatic recovery from WebGPU device loss, DPR changes, and rapid DOM update pressure.</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">🧩</div>
                  <h3>Spatial CSS Effects</h3>
                  <p>SCSS mixins compile to CSS custom properties that drive 3D depth, glow, and future spatial effects.</p>
                </div>
              </div>
            </section>
          }

          @case ('setup') {
            <section class="docs-section">
              <h2 class="section-title">Installation &amp; Setup</h2>

              <div class="content-card">
                <h3>1. Install the package</h3>
                <pre><code>npm install &#64;babylon-in-canvas/angular</code></pre>
                <p class="content-note">Peer dependencies: Angular 22+, BabylonJS 9.12+</p>
              </div>

              <div class="content-card">
                <h3>2. Configure Electron Chromium flags</h3>
                <p>The library exports the required Chromium switches. Apply them in your Electron main process:</p>
                <pre><code>import &#123; app &#125; from 'electron';
import &#123; BIC_CHROMIUM_SWITCHES &#125; from '&#64;babylon-in-canvas/angular';

for (const entry of BIC_CHROMIUM_SWITCHES) &#123;
  if (entry.length === 1) &#123;
    app.commandLine.appendSwitch(entry[0]);
  &#125; else &#123;
    app.commandLine.appendSwitch(entry[0], entry[1]);
  &#125;
&#125;</code></pre>
              </div>

              <div class="content-card">
                <h3>3. Bootstrap with zoneless change detection</h3>
                <pre><code>import &#123; bootstrapApplication &#125; from '&#64;angular/platform-browser';
import &#123; provideZonelessChangeDetection &#125; from '&#64;angular/core';
import &#123; AppComponent &#125; from './app/app.component';

bootstrapApplication(AppComponent, &#123;
  providers: [provideZonelessChangeDetection()],
&#125;);</code></pre>
              </div>

              <div class="content-card">
                <h3>4. Configure SCSS imports</h3>
                <p>Import the effects SCSS module for spatial CSS mixins:</p>
                <pre><code>&#64;use '&#64;babylon-in-canvas/angular/effects' as bic;</code></pre>
              </div>
            </section>
          }

          @case ('usage') {
            <section class="docs-section">
              <h2 class="section-title">Usage Guide</h2>

              <div class="content-card">
                <h3>Basic scene with a surface</h3>
                <pre><code>&lt;bic-scene&gt;
  &lt;bic-surface
    class="my-panel"
    [position]="panelPosition()"
    [rotation]="panelRotation()"
    [size]="panelSize()"
  &gt;
    &lt;my-settings-panel /&gt;
  &lt;/bic-surface&gt;
&lt;/bic-scene&gt;</code></pre>
              </div>

              <div class="content-card">
                <h3>Signal-driven state with the surface machine</h3>
                <pre><code>import &#123;
  createSurfaceMachine,
  moveSurface,
  rotateSurface,
  resizeSurface,
  setSurfaceFocus,
&#125; from '&#64;babylon-in-canvas/angular';

const panel = createSurfaceMachine();

// Update position
const moved = moveSurface(panel, &#123; x: 0.5, y: 0, z: 0 &#125;);

// Toggle focus
const focused = setSurfaceFocus(panel, true);</code></pre>
              </div>

              <div class="content-card">
                <h3>Multiple surfaces</h3>
                <p>Each <code>&lt;bic-surface&gt;</code> creates an independent DOM host and Babylon mesh.
                  Surfaces are automatically sorted by camera distance, and occluded surfaces
                  are made inert for hit testing.</p>
                <pre><code>&lt;bic-scene&gt;
  &lt;bic-surface id="main-panel" [position]="mainPos()" [size]="mainSize()"&gt;
    &lt;app-main-panel /&gt;
  &lt;/bic-surface&gt;

  &lt;bic-surface id="status-card" [position]="statusPos()" [size]="statusSize()"&gt;
    &lt;app-status-card /&gt;
  &lt;/bic-surface&gt;
&lt;/bic-scene&gt;</code></pre>
              </div>

              <div class="content-card">
                <h3>Curved primitives (visual-only)</h3>
                <pre><code>&lt;bic-surface
  [primitive]="&#123; kind: 'cylinder', arc: 0.9, tessellation: 36 &#125;"
  interaction="none"
  [position]="curvedPos()"
  [size]="curvedSize()"
&gt;
  &lt;div class="curved-content"&gt;Visual-only curved surface&lt;/div&gt;
&lt;/bic-surface&gt;</code></pre>
              </div>
            </section>
          }

          @case ('effects') {
            <section class="docs-section">
              <h2 class="section-title">Spatial CSS Effects</h2>

              <div class="content-card">
                <h3>How it works</h3>
                <p>SCSS mixins compile to CSS custom properties. The library reads
                  <code>getComputedStyle()</code> at runtime and applies the corresponding
                  Babylon/WebGPU effect. The browser's CSS cascade controls everything —
                  including responsive rules, pseudo-classes, and animations.</p>
              </div>

              <div class="content-card">
                <h3>depth</h3>
                <p>Adds thickness geometry behind the surface plane.</p>
                <pre><code>&#64;use '&#64;babylon-in-canvas/angular/effects' as bic;

.my-panel &#123;
  &#64;include bic.depth(0.08);
&#125;

// Compiles to:
// .my-panel &#123; --bic-depth: 0.08; &#125;</code></pre>
              </div>

              <div class="content-card">
                <h3>glow</h3>
                <p>Creates a spatial glow effect around the surface using Babylon's GlowLayer.</p>
                <pre><code>.my-panel &#123;
  &#64;include bic.glow($radius: 18px, $intensity: 0.6);
&#125;

// Compiles to:
// .my-panel &#123;
//   --bic-glow-radius: 18px;
//   --bic-glow-intensity: 0.6;
// &#125;</code></pre>
              </div>

              <div class="content-card">
                <h3>Conditional effects with CSS</h3>
                <p>Because the runtime contract is CSS custom properties, you can use
                  standard CSS to conditionally change effects:</p>
                <pre><code>.my-panel &#123;
  &#64;include bic.depth(0.04);
  &#64;include bic.glow($radius: 12px, $intensity: 0.2);
&#125;

.my-panel:focus-within &#123;
  &#64;include bic.depth(0.1);
  &#64;include bic.glow($radius: 28px, $intensity: 0.7);
&#125;</code></pre>
              </div>
            </section>
          }

          @case ('api') {
            <section class="docs-section">
              <h2 class="section-title">API Reference</h2>

              <div class="content-card">
                <h3>Components</h3>
                <div class="api-table">
                  <div class="api-row">
                    <code>BicSceneComponent</code>
                    <span>Root scene host. Creates WebGPU engine, camera, lights, and the HTML-in-Canvas surface canvas.</span>
                  </div>
                  <div class="api-row">
                    <code>BicSurfaceComponent</code>
                    <span>Projected surface. Wraps Angular content and projects it as a Babylon mesh with synchronized DOM transforms.</span>
                  </div>
                </div>
              </div>

              <div class="content-card">
                <h3>Surface inputs</h3>
                <div class="api-table">
                  <div class="api-row"><code>[position]</code><span>Vec3 — world position &#123; x, y, z &#125;</span></div>
                  <div class="api-row"><code>[rotation]</code><span>Vec3 — euler rotation &#123; x, y, z &#125;</span></div>
                  <div class="api-row"><code>[size]</code><span>SurfaceSize — logical CSS &#123; width, height &#125;</span></div>
                  <div class="api-row"><code>[focused]</code><span>boolean — drives CSS class and effect intensity</span></div>
                  <div class="api-row"><code>[primitive]</code><span>SurfacePrimitive — 'plane' (default) or &#123; kind: 'cylinder', arc, tessellation &#125;</span></div>
                  <div class="api-row"><code>[interaction]</code><span>'auto' | 'none' — controls DOM pointer-events and inert state</span></div>
                  <div class="api-row"><code>[occlusion]</code><span>'auto' | 'none' — controls occlusion-based inert detection</span></div>
                </div>
              </div>

              <div class="content-card">
                <h3>State machine helpers</h3>
                <div class="api-table">
                  <div class="api-row"><code>createSurfaceMachine()</code><span>Returns a new SurfaceState with sensible defaults.</span></div>
                  <div class="api-row"><code>moveSurface(state, delta)</code><span>Returns a new state with position offset by delta.</span></div>
                  <div class="api-row"><code>rotateSurface(state, delta)</code><span>Returns a new state with rotation offset by delta.</span></div>
                  <div class="api-row"><code>resizeSurface(state, delta)</code><span>Returns a new state with size adjusted by delta.</span></div>
                  <div class="api-row"><code>setSurfaceFocus(state, focused)</code><span>Returns a new state with focus toggled.</span></div>
                </div>
              </div>

              <div class="content-card">
                <h3>Electron configuration exports</h3>
                <div class="api-table">
                  <div class="api-row"><code>BIC_CHROMIUM_FLAGS</code><span>Array of Chromium feature flag names.</span></div>
                  <div class="api-row"><code>BIC_CHROMIUM_SWITCHES</code><span>Array of [switch, value?] tuples for app.commandLine.appendSwitch().</span></div>
                  <div class="api-row"><code>auditPreflightCapabilities(canvas)</code><span>Returns &#123; supported, details &#125; describing runtime feature availability.</span></div>
                </div>
              </div>
            </section>
          }
        }
      </main>

      <footer class="docs-footer">
        <span>Babylon-in-Canvas · Angular 22 · BabylonJS 9.12 · Electron 42</span>
        <a
          href="https://github.com/AliStarr/babylon-in-canvas"
          target="_blank"
          rel="noopener"
        >GitHub</a>
      </footer>
    </div>
  `,
  styles: `
    .docs-shell {
      display: grid;
      grid-template-rows: auto 1fr auto;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Header ── */
    .docs-header {
      border-bottom: 1px solid var(--border-color);
      background: rgba(10, 11, 16, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      z-index: 10;
    }

    .docs-header-inner {
      display: flex;
      align-items: center;
      gap: 24px;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
      height: 56px;
    }

    .docs-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 16px;
      color: var(--text-primary);
      white-space: nowrap;
    }

    .logo-icon {
      color: var(--color-teal);
      font-size: 18px;
    }

    .docs-nav {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }

    .nav-link {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        color: var(--text-primary);
        background: rgba(255, 255, 255, 0.05);
      }

      &.active {
        color: var(--color-teal);
        background: var(--color-teal-glow);
      }
    }

    .release-link {
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-secondary);
      text-decoration: none;
      transition: all 0.15s ease;
      white-space: nowrap;

      &:hover {
        border-color: var(--color-teal);
        color: var(--color-teal);
      }
    }

    /* ── Main ── */
    .docs-main {
      overflow-y: auto;
      scroll-behavior: smooth;
    }

    .docs-section {
      max-width: 860px;
      margin: 0 auto;
      padding: 48px 24px 64px;
    }

    /* ── Hero ── */
    .hero {
      text-align: center;
      padding: 48px 0 56px;
    }

    .hero-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-teal);
      background: var(--color-teal-glow);
      border: 1px solid rgba(20, 184, 166, 0.25);
      border-radius: 20px;
      padding: 4px 14px;
      margin-bottom: 20px;
    }

    .hero-title {
      font-family: var(--font-display);
      font-size: clamp(2rem, 5vw, 3.2rem);
      font-weight: 800;
      line-height: 1.15;
      color: var(--text-primary);
      margin-bottom: 16px;
    }

    .hero-accent {
      background: linear-gradient(135deg, var(--color-teal), var(--color-blue));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-subtitle {
      max-width: 520px;
      margin: 0 auto 28px;
      font-size: 16px;
      line-height: 1.6;
      color: var(--text-secondary);
    }

    .hero-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
    }

    .btn {
      font-family: var(--font-sans);
      font-size: 14px;
      font-weight: 600;
      padding: 10px 22px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s ease;
    }

    .btn-primary {
      background: var(--color-teal);
      color: #0a0b10;

      &:hover {
        background: #0ea39a;
        box-shadow: 0 0 20px var(--color-teal-glow);
      }
    }

    .btn-ghost {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border-color);

      &:hover {
        border-color: var(--border-color-hover);
        color: var(--text-primary);
      }
    }

    /* ── Feature grid ── */
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-top: 8px;
    }

    .feature-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 22px;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;

      &:hover {
        border-color: var(--border-color-hover);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
      }

      h3 {
        font-family: var(--font-display);
        font-size: 15px;
        font-weight: 600;
        margin: 10px 0 6px;
        color: var(--text-primary);
      }

      p {
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-secondary);
      }
    }

    .feature-icon {
      font-size: 22px;
    }

    /* ── Content cards ── */
    .section-title {
      font-family: var(--font-display);
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 28px;
      color: var(--text-primary);
    }

    .content-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;

      h3 {
        font-family: var(--font-display);
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 10px;
        color: var(--text-primary);
      }

      p {
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-secondary);
        margin-bottom: 8px;
      }
    }

    .content-note {
      font-size: 12px !important;
      color: var(--text-muted) !important;
      margin-top: 6px;
    }

    /* ── API table ── */
    .api-table {
      display: grid;
      gap: 1px;
      background: var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .api-row {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 16px;
      padding: 10px 14px;
      background: var(--bg-secondary);
      font-size: 13px;
      align-items: center;

      code {
        color: var(--color-teal);
        font-size: 12px;
      }

      span {
        color: var(--text-secondary);
      }
    }

    /* ── Footer ── */
    .docs-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      font-size: 12px;
      color: var(--text-muted);
      border-top: 1px solid var(--border-color);

      a {
        color: var(--text-secondary);
        text-decoration: none;
        &:hover { color: var(--color-teal); }
      }
    }
  `,
})
export class App {
  readonly activeSection = signal<Section>('intro');

  readonly navItems = computed(() => [
    { id: 'intro' as Section, label: 'Introduction' },
    { id: 'setup' as Section, label: 'Setup' },
    { id: 'usage' as Section, label: 'Usage' },
    { id: 'effects' as Section, label: 'Effects' },
    { id: 'api' as Section, label: 'API' },
  ]);
}
