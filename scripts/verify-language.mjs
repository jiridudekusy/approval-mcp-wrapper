import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

export function missingKeys(source, target) {
  return Object.keys(source)
    .filter((key) => !(key in target))
    .sort();
}

async function main() {
  const [englishSource, czechSource] = await Promise.all([
    readFile(new URL('../apps/web/src/i18n/en.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/src/i18n/cs.ts', import.meta.url), 'utf8'),
  ]);
  const keys = (source) =>
    Object.fromEntries(
      [...source.matchAll(/^\s*'([^']+)':/gm)].map((match) => [
        match[1],
        true,
      ]),
    );
  const missing = missingKeys(keys(englishSource), keys(czechSource));
  if (missing.length > 0) {
    throw new Error(`Czech catalog is missing keys: ${missing.join(', ')}`);
  }
  console.log('English and Czech built-in message catalogs are complete.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
