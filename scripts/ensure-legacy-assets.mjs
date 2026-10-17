import { copyFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const outputDirectory = 'dist/assets';
const legacyEntry = await readFile('src/legacy-cloud/index-XHVaOVd2.js', 'utf8');
const referencedAssets = [...legacyEntry.matchAll(/"assets\/([^\"]+\.(?:js|css))"/g)]
  .map((match) => match[1]);
const builtAssets = await readdir(outputDirectory);

for (const legacyName of referencedAssets) {
  if (builtAssets.includes(legacyName)) continue;

  const extension = legacyName.slice(legacyName.lastIndexOf('.'));
  const prefix = legacyName.slice(0, -extension.length);
  let builtName = builtAssets.find((name) => name.startsWith(`${prefix}-`) && name.endsWith(extension));

  // The legacy bundle's CSS was folded into Vite's entry stylesheet.
  if (!builtName && extension === '.css') {
    builtName = builtAssets.find((name) => name.startsWith('index-') && name.endsWith('.css'));
  }

  if (!builtName) {
    throw new Error(`Could not find a built asset for legacy preload: ${legacyName}`);
  }

  await copyFile(join(outputDirectory, builtName), join(outputDirectory, legacyName));
  console.log(`Added legacy preload alias: ${legacyName}`);
}
