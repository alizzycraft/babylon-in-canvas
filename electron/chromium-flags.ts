import { app } from 'electron';
import { chromiumSwitches } from './chromium-flags.constants.js';

export function applyExperimentalChromiumFlags(): void {
  for (const [name, value] of chromiumSwitches) {
    if (value === undefined) {
      app.commandLine.appendSwitch(name);
      continue;
    }

    app.commandLine.appendSwitch(name, value);
  }
}
