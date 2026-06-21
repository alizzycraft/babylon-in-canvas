import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as sass from 'sass';

const packageRoot = new URL('../dist/bic-angular/', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
const declarations = await readFile(
  new URL(packageJson.exports['.'].types, packageRoot),
  'utf8',
);

for (const publicSymbol of [
  'BicSceneComponent',
  'BicSurfaceComponent',
  'createSurfaceMachine',
  'moveSurface',
  'rotateSurface',
  'resizeSurface',
]) {
  if (!declarations.includes(publicSymbol)) {
    throw new Error(`Packaged declarations are missing ${publicSymbol}.`);
  }
}

const moduleUrl = pathToFileURL(
  fileURLToPath(new URL(packageJson.exports['.'].default, packageRoot)),
).href;
await import('@angular/compiler');
const library = await import(moduleUrl);

if (!library.BicSceneComponent || !library.BicSurfaceComponent) {
  throw new Error('Packaged JavaScript is missing the Angular scene or surface component.');
}

const compiledEffects = sass.compileString(`
  @use 'effects' as bic;
  .surface {
    @include bic.depth(0.08);
    @include bic.glow($radius: 20px, $intensity: 0.5);
  }
`, {
  loadPaths: [fileURLToPath(packageRoot)],
}).css;

for (const property of ['--bic-depth', '--bic-glow-radius', '--bic-glow-intensity']) {
  if (!compiledEffects.includes(property)) {
    throw new Error(`Packaged SCSS did not emit ${property}.`);
  }
}

console.log('Verified packaged Angular API and SCSS effects.');
