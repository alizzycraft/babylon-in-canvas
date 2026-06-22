import { app, BrowserWindow, ipcMain, session, type Rectangle } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { applyExperimentalChromiumFlags } from './chromium-flags.js';

applyExperimentalChromiumFlags();

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['BIC_REMOTE_DEBUGGING_PORT'] ?? '9222');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const devServerUrl = 'http://127.0.0.1:4200';
const productionRenderer = app.isPackaged || process.env['BIC_ELECTRON_LOAD_FILE'] === '1';
const runtimeProofReportDirectory = join(process.cwd(), 'docs', 'runtime-proof-runs');
const visualRegressionDirectory = join(process.cwd(), 'docs', 'visual-regression-runs');
const productionCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');
const developmentCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:4200 ws://127.0.0.1:4200",
  "worker-src 'self' blob:",
].join('; ');
const rendererSecurityConfig = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  experimentalFeatures: true,
} as const;

interface RuntimeProofSaveRequest {
  readonly generatedAt: string;
  readonly summary: string;
  readonly results: readonly unknown[];
}

interface RuntimeProofSaveResponse {
  readonly jsonPath: string;
  readonly markdownPath: string;
}

interface VisualCaptureRequest {
  readonly label: string;
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface VisualCaptureResponse {
  readonly pngPath: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

ipcMain.handle('bic:runtime-proofs:save-run', async (_event, request: RuntimeProofSaveRequest): Promise<RuntimeProofSaveResponse> => {
  await mkdir(runtimeProofReportDirectory, { recursive: true });

  const timestamp = safeTimestamp(request.generatedAt);
  const baseName = `runtime-proof-${timestamp}`;
  const jsonPath = join(runtimeProofReportDirectory, `${baseName}.json`);
  const markdownPath = join(runtimeProofReportDirectory, `${baseName}.md`);

  await writeFile(jsonPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, formatRuntimeProofMarkdown(request), 'utf8');

  return {
    jsonPath,
    markdownPath,
  };
});

ipcMain.handle('bic:runtime-proofs:get-zoom-factor', (event): number =>
  event.sender.getZoomFactor()
);

ipcMain.handle('bic:runtime-proofs:set-zoom-factor', (event, factor: number): number => {
  if (!Number.isFinite(factor) || factor < 0.5 || factor > 3) {
    throw new Error(`Invalid runtime proof zoom factor: ${factor}`);
  }

  event.sender.setZoomFactor(factor);
  return event.sender.getZoomFactor();
});

ipcMain.handle('bic:runtime-proofs:get-security-state', () => {
  return {
    packaged: productionRenderer,
    ...rendererSecurityConfig,
    devTools: !productionRenderer,
    contentSecurityPolicy: productionRenderer ? productionCsp : developmentCsp,
    navigationLocked: true,
    permissionsDeniedByDefault: true,
  };
});

ipcMain.handle(
  'bic:runtime-proofs:capture-visual',
  async (event, request: VisualCaptureRequest): Promise<VisualCaptureResponse> => {
    const label = request.label.replaceAll(/[^a-z0-9-]/gi, '-').slice(0, 64);
    const clip = normalizeCaptureClip(request.clip);
    const image = await event.sender.capturePage(clip);
    const size = image.getSize();
    const timestamp = safeTimestamp(new Date().toISOString());
    const pngPath = join(visualRegressionDirectory, `${label}-${timestamp}.png`);

    await mkdir(visualRegressionDirectory, { recursive: true });
    await writeFile(pngPath, image.toPNG());

    return {
      pngPath,
      dataUrl: image.toDataURL(),
      width: size.width,
      height: size.height,
    };
  },
);

function createMainWindow(): BrowserWindow {
  const development = !productionRenderer;
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#0f1117',
    webPreferences: {
      ...rendererSecurityConfig,
      devTools: development,
      backgroundThrottling: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  configureWindowSecurity(win);

  if (productionRenderer) {
    void win.loadFile(join(__dirname, '../renderer/browser/index.html'));
  } else {
    void win.loadURL(devServerUrl);
  }

  if (development) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  win.webContents.on('console-message', (details) => {
    console.log(
      `[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`,
    );
  });

  return win;
}

app.whenReady().then(() => {
  configureSessionSecurity();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

function configureSessionSecurity(): void {
  const csp = productionRenderer ? productionCsp : developmentCsp;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function configureWindowSecurity(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = productionRenderer
      ? url.startsWith('file:')
      : url.startsWith(devServerUrl);

    if (!allowed) {
      event.preventDefault();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function safeTimestamp(value: string): string {
  const parsed = new Date(value);
  const date = Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function normalizeCaptureClip(clip: VisualCaptureRequest['clip']): Rectangle {
  const values = [clip.x, clip.y, clip.width, clip.height];

  if (!values.every(Number.isFinite) || clip.width <= 0 || clip.height <= 0) {
    throw new Error('Invalid visual-regression capture bounds.');
  }

  return {
    x: Math.max(0, Math.floor(clip.x)),
    y: Math.max(0, Math.floor(clip.y)),
    width: Math.max(1, Math.ceil(clip.width)),
    height: Math.max(1, Math.ceil(clip.height)),
  };
}

function formatRuntimeProofMarkdown(request: RuntimeProofSaveRequest): string {
  return [
    '# Babylon-in-Canvas Runtime Proof Run',
    '',
    `Generated: ${request.generatedAt}`,
    '',
    '## Summary',
    '',
    '```text',
    request.summary,
    '```',
    '',
    '## Results',
    '',
    '```json',
    JSON.stringify(request.results, null, 2),
    '```',
    '',
  ].join('\n');
}
