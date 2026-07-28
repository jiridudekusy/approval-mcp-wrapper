import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validateExactVersions(dependencies) {
  return Object.entries(dependencies)
    .filter(([, version]) => !EXACT_VERSION.test(version))
    .map(([name]) => name)
    .sort();
}

export function missingAdmissionRecords(dependencies, markdown) {
  return Object.entries(dependencies)
    .filter(([name, version]) => !markdown.includes(`## ${name}@${version}`))
    .map(([name]) => name)
    .sort();
}

async function main() {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const dependencies = packageJson.dependencies ?? {};
  const invalidVersions = validateExactVersions(dependencies);
  const records = await readFile(
    new URL('../docs/dependencies/initial-runtime-packages.md', import.meta.url),
    'utf8',
  );
  const missingRecords = missingAdmissionRecords(dependencies, records);

  if (invalidVersions.length > 0 || missingRecords.length > 0) {
    if (invalidVersions.length > 0) {
      console.error(`Runtime dependencies without exact versions: ${invalidVersions.join(', ')}`);
    }
    if (missingRecords.length > 0) {
      console.error(`Runtime dependencies without admission records: ${missingRecords.join(', ')}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
