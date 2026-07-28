import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import type { ConfigStateStore } from '@approval-mcp/state-store';

export interface BackupManifest {
  schemaVersion: 1;
  createdAt: string;
  files: { path: string; bytes: number; sha256: string }[];
}

async function filesBelow(root: string, current = root): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) results.push(...(await filesBelow(root, path)));
    else if (entry.isFile()) results.push(path);
  }
  return results.sort();
}

async function checksum(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function durableCopy(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  const file = await open(destination, 'r');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function createBackup(options: {
  dataDir: string;
  output: string;
  stateStore: ConfigStateStore;
  now?: () => Date;
}): Promise<BackupManifest> {
  const dataDir = resolve(options.dataDir);
  const output = resolve(options.output);
  if (output === dataDir || output.startsWith(`${dataDir}/`)) {
    throw new Error('Backup output must be outside the data directory');
  }
  await options.stateStore.snapshot();
  const temporary = join(
    dirname(output),
    `.${relative(dirname(output), output)}.${randomUUID()}.tmp`,
  );
  await mkdir(temporary, { recursive: false, mode: 0o700 });
  try {
    const files = await filesBelow(dataDir);
    const manifest: BackupManifest = {
      schemaVersion: 1,
      createdAt: (options.now?.() ?? new Date()).toISOString(),
      files: [],
    };
    for (const source of files) {
      const path = relative(dataDir, source);
      const destination = join(temporary, path);
      await durableCopy(source, destination);
      manifest.files.push({
        path,
        bytes: (await stat(destination)).size,
        sha256: await checksum(destination),
      });
    }
    const manifestPath = join(temporary, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const manifestFile = await open(manifestPath, 'r');
    try {
      await manifestFile.sync();
    } finally {
      await manifestFile.close();
    }
    const directory = await open(temporary, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    await rename(temporary, output);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export { checksum, durableCopy };
