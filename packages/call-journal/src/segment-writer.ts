import { open, stat } from 'node:fs/promises';

export async function appendDurable(path: string, contents: string): Promise<number> {
  let offset = 0;
  try {
    offset = (await stat(path)).size;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      (error as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      throw error;
    }
  }
  const file = await open(path, 'a', 0o600);
  try {
    await file.writeFile(contents, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  return offset;
}
