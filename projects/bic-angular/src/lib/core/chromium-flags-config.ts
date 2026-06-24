export const BIC_CHROMIUM_FLAGS = [
  'CanvasDrawElement',
  'WebGPUDeveloperFeatures',
] as const;

export const BIC_CHROMIUM_SWITCHES = [
  ['enable-experimental-web-platform-features'],
  ['enable-unsafe-webgpu'],
  ['ignore-gpu-blocklist'],
  ['enable-features', BIC_CHROMIUM_FLAGS.join(',')],
] as const;
