import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { applyExperimentalChromiumFlags } from './chromium-flags.js';

applyExperimentalChromiumFlags();

const __dirname = dirname(fileURLToPath(import.meta.url));
const devServerUrl = 'http://127.0.0.1:4200';
const runtimeProofReportDirectory = join(process.cwd(), 'docs', 'runtime-proof-runs');

interface RuntimeProofSaveRequest {
  readonly generatedAt: string;
  readonly summary: string;
  readonly results: readonly unknown[];
}

interface RuntimeProofSaveResponse {
  readonly jsonPath: string;
  readonly markdownPath: string;
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

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#0f1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
      experimentalFeatures: true,
      backgroundThrottling: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  if (process.env['BIC_ELECTRON_LOAD_FILE'] === '1') {
    void win.loadFile(join(__dirname, '../renderer/browser/index.html'));
  } else {
    void win.loadURL(devServerUrl);
  }

  win.webContents.openDevTools({ mode: 'detach' });

  return win;
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

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
