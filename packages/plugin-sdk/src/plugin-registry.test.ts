import { describe, expect, it } from 'vitest';

import { createGenericDescription } from './generic-plugin.js';
import { PluginRegistry } from './plugin-registry.js';
import { validatePluginDescription } from './validate-output.js';
import type { ApprovalPlugin, PluginCallInput } from './contracts.js';

const input: PluginCallInput = {
  upstreamAlias: 'signal',
  toolName: 'send_message',
  toolDescription: 'Send a message',
  arguments: { groupId: 'family', message: 'hello' },
};

describe('plugin output validation', () => {
  it('rejects a localized message without an English fallback', () => {
    const invalid = createGenericDescription(input) as unknown as {
      title: { key: string; fallback: { cs: string } };
    };
    invalid.title = { key: 'plugin.title', fallback: { cs: 'Název' } };

    expect(() => validatePluginDescription(invalid)).toThrow('English fallback');
  });

  it('rejects sensitive paths that are not JSON pointers', () => {
    const invalid = {
      ...createGenericDescription(input),
      sensitivePaths: ['arguments.secret'],
    };

    expect(() => validatePluginDescription(invalid)).toThrow('JSON pointer');
  });
});

describe('PluginRegistry', () => {
  it('returns a generic descriptor when a plugin throws', async () => {
    const plugin: ApprovalPlugin = {
      id: 'signal',
      version: '1.0.0',
      normalizationVersion: 1,
      async describe() {
        throw new Error('plugin failure');
      },
    };
    const registry = new PluginRegistry([plugin]);

    const result = await registry.describe(
      { id: 'signal', version: '1.0.0' },
      input,
    );

    expect(result).toMatchObject({
      source: 'generic',
      title: { fallback: { en: 'Signal: send_message' } },
    });
  });

  it('requires an exact pinned plugin version', async () => {
    const registry = new PluginRegistry([]);

    await expect(
      registry.describe({ id: 'signal', version: '1.0.0' }, input),
    ).resolves.toMatchObject({
      source: 'generic',
      reasonCode: 'plugin.not_found',
    });
  });
});
