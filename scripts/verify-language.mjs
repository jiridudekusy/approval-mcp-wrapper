import { pathToFileURL } from 'node:url';

export function missingKeys(source, target) {
  return Object.keys(source)
    .filter((key) => !(key in target))
    .sort();
}

async function main() {
  console.log('Language catalogs are introduced in Task 11; source-language checks are active.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
