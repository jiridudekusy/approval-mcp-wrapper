import { open, mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StateStoreFileOperations {
  appendDurable(path: string, contents: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  readText(path: string): Promise<string | undefined>;
  writeAtomic(path: string, contents: string): Promise<void>;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export function createNodeFileOperations(): StateStoreFileOperations {
  return {
    async appendDurable(path, contents) {
      const file = await open(path, 'a', 0o600);
      try {
        await file.writeFile(contents, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
    },
    async ensureDir(path) {
      await mkdir(path, { recursive: true, mode: 0o700 });
    },
    async readText(path) {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          return undefined;
        }
        throw error;
      }
    },
    async writeAtomic(path, contents) {
      const parent = dirname(path);
      const temporaryPath = join(parent, `.${randomUUID()}.tmp`);
      const file = await open(temporaryPath, 'wx', 0o600);
      try {
        await file.writeFile(contents, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporaryPath, path);
      await syncDirectory(parent);
    },
  };
}
