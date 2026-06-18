export const chromiumFeatureFlags = [
  'CanvasDrawElement',
  'WebGPUDeveloperFeatures',
] as const;

export const chromiumSwitches = [
  ['enable-experimental-web-platform-features'],
  ['enable-unsafe-webgpu'],
  ['ignore-gpu-blocklist'],
  ['enable-features', chromiumFeatureFlags.join(',')],
] as const;
