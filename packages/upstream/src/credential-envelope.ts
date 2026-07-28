import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import type {
  EncryptedCredentialEnvelope,
  UpstreamId,
} from '@approval-mcp/contracts';

export interface UpstreamCredentials {
  authorization?: string;
  headers?: Record<string, string>;
}

function authenticatedData(upstreamId: UpstreamId): Buffer {
  return Buffer.from(`approval-mcp:upstream:${upstreamId}:credential:v1`, 'utf8');
}

export class CredentialVault {
  readonly #masterKey: Buffer;

  constructor(masterKey: Uint8Array) {
    if (masterKey.byteLength !== 32) {
      throw new Error('Credential master key must be exactly 32 bytes');
    }
    this.#masterKey = Buffer.from(masterKey);
  }

  static fromEnvironment(
    value = process.env['APPROVAL_MCP_MASTER_KEY'],
  ): CredentialVault {
    if (value === undefined) {
      throw new Error('APPROVAL_MCP_MASTER_KEY is required');
    }
    const key = Buffer.from(value, 'base64');
    if (key.byteLength !== 32 || key.toString('base64') !== value) {
      throw new Error(
        'APPROVAL_MCP_MASTER_KEY must be a canonical base64-encoded 32-byte key',
      );
    }
    return new CredentialVault(key);
  }

  encrypt(
    upstreamId: UpstreamId,
    credentials: UpstreamCredentials,
  ): EncryptedCredentialEnvelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#masterKey, nonce);
    cipher.setAAD(authenticatedData(upstreamId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    return {
      algorithm: 'aes-256-gcm',
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      version: 1,
    };
  }

  decrypt(
    upstreamId: UpstreamId,
    envelope: EncryptedCredentialEnvelope,
  ): UpstreamCredentials {
    if (envelope.algorithm !== 'aes-256-gcm' || envelope.version !== 1) {
      throw new Error('Unsupported credential envelope');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.#masterKey,
      Buffer.from(envelope.nonce, 'base64'),
    );
    decipher.setAAD(authenticatedData(upstreamId));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid decrypted credential payload');
    }
    return parsed as UpstreamCredentials;
  }
}
