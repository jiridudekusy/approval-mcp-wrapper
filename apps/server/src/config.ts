import { isAbsolute } from 'node:path';

import { z } from 'zod';

const environmentSchema = z.object({
  APPROVAL_MCP_PUBLIC_URL: z.url(),
  APPROVAL_MCP_DATA_DIR: z.string().min(1),
  APPROVAL_MCP_MASTER_KEY: z.string().min(1),
  APPROVAL_MCP_VAPID_SUBJECT: z.string().min(1).optional(),
});

export interface ServerConfig {
  publicUrl: URL;
  dataDir: string;
  masterKey: Buffer;
  rpId: string;
  expectedOrigin: string;
  secureCookies: boolean;
  vapidSubject: string;
}

function assertVapidSubject(value: string): void {
  if (/^mailto:[^\s@]+@[^\s@]+$/.test(value)) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
    ) return;
  } catch {
    // The shared error below keeps configuration failures actionable.
  }
  throw new Error(
    'APPROVAL_MCP_VAPID_SUBJECT must be a mailto address or HTTPS URL',
  );
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): ServerConfig {
  const value = environmentSchema.parse(environment);
  const publicUrl = new URL(value.APPROVAL_MCP_PUBLIC_URL);
  const loopback =
    publicUrl.hostname === 'localhost' || publicUrl.hostname === '127.0.0.1';
  if (publicUrl.protocol !== 'https:' && !(loopback && publicUrl.protocol === 'http:')) {
    throw new Error(
      'APPROVAL_MCP_PUBLIC_URL must use HTTPS except on exact loopback hosts',
    );
  }
  if (
    publicUrl.username !== '' ||
    publicUrl.password !== '' ||
    publicUrl.search !== '' ||
    publicUrl.hash !== ''
  ) {
    throw new Error('APPROVAL_MCP_PUBLIC_URL must be a clean public origin');
  }
  if (!isAbsolute(value.APPROVAL_MCP_DATA_DIR)) {
    throw new Error('APPROVAL_MCP_DATA_DIR must be an absolute path');
  }
  const masterKey = Buffer.from(value.APPROVAL_MCP_MASTER_KEY, 'base64');
  if (
    masterKey.byteLength !== 32 ||
    masterKey.toString('base64') !== value.APPROVAL_MCP_MASTER_KEY
  ) {
    throw new Error(
      'APPROVAL_MCP_MASTER_KEY must be a canonical base64-encoded 32-byte key',
    );
  }
  const vapidSubject =
    value.APPROVAL_MCP_VAPID_SUBJECT ??
    (publicUrl.protocol === 'https:'
      ? publicUrl.origin
      : 'mailto:approval-mcp@example.com');
  assertVapidSubject(vapidSubject);
  return {
    publicUrl,
    dataDir: value.APPROVAL_MCP_DATA_DIR,
    masterKey,
    rpId: publicUrl.hostname,
    expectedOrigin: publicUrl.origin,
    secureCookies: publicUrl.protocol === 'https:',
    vapidSubject,
  };
}
