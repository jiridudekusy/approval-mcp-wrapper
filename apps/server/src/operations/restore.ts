import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

import { createConfigStateStore } from '@approval-mcp/state-store';

import {
  checksum,
  durableCopy,
  type BackupManifest,
} from './backup.js';

function safePath(root: string, path: string): string {
  const normalized = normalize(path);
  if (
    normalized === '..' ||
    normalized.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    resolve(root, normalized) === resolve(root)
  ) {
    throw new Error(`Unsafe backup path: ${path}`);
  }
  const destination = resolve(root, normalized);
  if (!destination.startsWith(`${resolve(root)}/`)) {
    throw new Error(`Unsafe backup path: ${path}`);
  }
  return destination;
}

export async function restoreBackup(options: {
  input: string;
  target: string;
  dryRun: boolean;
}): Promise<{ valid: true; fileCount: number }> {
  const input = resolve(options.input);
  const manifest = JSON.parse(
    await readFile(join(input, 'manifest.json'), 'utf8'),
  ) as BackupManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Unsupported backup manifest');
  }
  for (const file of manifest.files) {
    const source = safePath(input, file.path);
    if (
      (await stat(source)).size !== file.bytes ||
      (await checksum(source)) !== file.sha256
    ) {
      throw new Error(`Backup checksum mismatch: ${file.path}`);
    }
  }

  const temporary = await mkdtemp(join(dirname(resolve(options.target)), '.restore-'));
  try {
    for (const file of manifest.files) {
      await durableCopy(
        safePath(input, file.path),
        safePath(temporary, file.path),
      );
    }
    const store = await createConfigStateStore(temporary);
    await store.close();
    if (!options.dryRun) {
      await mkdir(dirname(resolve(options.target)), {
        recursive: true,
        mode: 0o700,
      });
      await rename(temporary, resolve(options.target));
    }
    return { valid: true, fileCount: manifest.files.length };
  } finally {
    if (options.dryRun) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
