import { cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packagedLibrary = fileURLToPath(new URL('../dist/bic-angular/', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('../integration/angular-consumer/', import.meta.url));
const fixturePackage = fileURLToPath(
  new URL('../integration/angular-consumer/node_modules/@babylon-in-canvas/angular/', import.meta.url),
);
const ngc = fileURLToPath(
  new URL('../node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js', import.meta.url),
);

await rm(fixturePackage, { recursive: true, force: true });
await mkdir(fixturePackage, { recursive: true });
await cp(packagedLibrary, fixturePackage, { recursive: true });

await run(process.execPath, [ngc, '-p', `${fixtureRoot}/tsconfig.json`]);

console.log('Verified isolated Angular consumer against the packaged library.');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Consumer fixture compiler exited with code ${code}.`));
      }
    });
  });
}
