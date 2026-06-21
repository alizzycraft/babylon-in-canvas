import { describe, expect, it } from 'vitest';
import { createHtmlInCanvasAdapter } from './html-in-canvas-adapter';

describe('HTML-in-Canvas capability failures', () => {
  it('fails clearly when required runtime APIs are missing', () => {
    const canvas = document.createElement('canvas');
    const adapter = createHtmlInCanvasAdapter(canvas);

    expect(() => adapter.assertCapabilities()).toThrowError(
      /Missing HTML-in-Canvas capabilities:/,
    );
  });
});
