import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'www');
const publicFiles = [
  'index.html',
  'styles.css',
  'app.js',
  'native-bundle.js',
  'config.js',
  'manifest.webmanifest',
  'sw.js',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of publicFiles) {
  await cp(join(root, file), join(output, file));
}

const generated = (await readdir(output)).sort();
const expected = [...publicFiles].sort();
if (JSON.stringify(generated) !== JSON.stringify(expected)) {
  throw new Error('Unexpected file set in www output.');
}

console.log(`Prepared ${generated.length} public files in www/.`);
