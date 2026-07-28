import type { ClientTokenId, ClientTokenRecord } from '@approval-mcp/contracts';
import { describe, expect, it } from 'vitest';

import {
  InMemoryTokenRepository,
  TokenService,
  type TokenRepository,
} from './token-service.js';

describe('TokenService', () => {
  it('returns plaintext once and stores only a salted scrypt verifier', async () => {
    const repository = new InMemoryTokenRepository();
    const service = new TokenService(repository);

    const created = await service.create('Personal chain');
    const stored = await repository.findById(created.record.id);

    expect(created.plaintext).toMatch(
      /^amcp_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/,
    );
    expect(stored).toEqual(created.record);
    expect(JSON.stringify(stored)).not.toContain(created.plaintext);
    expect(stored?.hash).toMatch(/^scrypt\$/);
    await expect(service.authenticate(created.plaintext)).resolves.toMatchObject({
      id: created.record.id,
    });
  });

  it('rejects malformed, unknown, and revoked tokens identically', async () => {
    const service = new TokenService(new InMemoryTokenRepository());
    const created = await service.create('Agent');

    await expect(service.authenticate('invalid')).resolves.toBeUndefined();
    await expect(
      service.authenticate(
        `amcp_00000000-0000-4000-8000-000000000000_${'A'.repeat(43)}`,
      ),
    ).resolves.toBeUndefined();
    await service.revoke(created.record.id);
    await expect(service.authenticate(created.plaintext)).resolves.toBeUndefined();
  });

  it('looks up exactly one token record before running scrypt', async () => {
    const repository = new InMemoryTokenRepository();
    const service = new TokenService(repository);
    await service.create('First');
    const second = await service.create('Second');
    let listCalls = 0;
    const indexedRepository: TokenRepository = {
      save: (record) => repository.save(record),
      findById: (id) => repository.findById(id),
      list: async () => {
        listCalls += 1;
        return repository.list();
      },
    };

    await expect(
      new TokenService(indexedRepository).authenticate(second.plaintext),
    ).resolves.toMatchObject({ id: second.record.id });
    expect(listCalls).toBe(0);
  });

  it('makes revocation durable before returning', async () => {
    let stored: ClientTokenRecord | undefined;
    const repository: TokenRepository = {
      save: async (record) => {
        stored = structuredClone(record);
      },
      findById: async (id) => (stored?.id === id ? structuredClone(stored) : undefined),
      list: async () => (stored === undefined ? [] : [structuredClone(stored)]),
    };
    const service = new TokenService(repository);
    const created = await service.create('Agent');

    await service.revoke(created.record.id);

    expect(stored?.revokedAt).toBeDefined();
    expect(stored?.id).toBe(created.record.id as ClientTokenId);
  });
});
