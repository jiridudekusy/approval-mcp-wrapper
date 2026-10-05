import { describe, expect, it } from 'vitest';

import { validatePluginDescription } from '@approval-mcp/plugin-sdk';

import {
  CONNECTED_TOOL_DEFINITIONS,
  ConnectedApprovalPlugin,
  connectedApprovalPlugins,
  type ConnectedPluginId,
} from './connected-plugins.js';

function input(toolName: string, args: Record<string, unknown> = {}) {
  return {
    upstreamId: 'upstream-1',
    upstreamAlias: 'connected',
    toolName,
    arguments: args as Record<string, string | boolean | number>,
  };
}

describe('connected approval plugins', () => {
  it('registers five separate plugins and validates every known tool presentation', async () => {
    expect(connectedApprovalPlugins().map((plugin) => plugin.id)).toEqual([
      'email', 'geo', 'imcp', 'krkonoskewellness', 'whatsapp',
    ]);
    for (const [id, definitions] of Object.entries(CONNECTED_TOOL_DEFINITIONS)) {
      const plugin = new ConnectedApprovalPlugin(id as ConnectedPluginId);
      for (const name of Object.keys(definitions)) {
        const result = validatePluginDescription(await plugin.describe(input(name)));
        expect(result.source).toBe('plugin');
        expect(result.title.fallback.en).toBeTruthy();
        expect(result.title.fallback.cs).toBeTruthy();
      }
    }
  });

  it('shows the full WhatsApp message and scopes repeated approval to the exact recipient', async () => {
    const plugin = new ConnectedApprovalPlugin('whatsapp');
    const recipient = `${'1234567890'.repeat(12)}@s.whatsapp.net`;
    const result = await plugin.describe(input('send_message', {
      recipient,
      message: 'Ahoj, zítra v deset.',
    }));

    expect(result.sections[0]?.risk).toBe('warning');
    expect(result.sections[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: recipient }),
      expect.objectContaining({ value: 'Ahoj, zítra v deset.' }),
    ]));
    expect(result.proposedScopes).toEqual([
      expect.objectContaining({
        predicates: [{ path: '/recipient', operator: 'equals', value: recipient }],
        durations: ['hour'],
      }),
    ]);
  });

  it('distinguishes wellness dry run from a binding booking and offers no reusable scope', async () => {
    const plugin = new ConnectedApprovalPlugin('krkonoskewellness');
    const args = { service_id: 42, start: '2026-10-15T14:30', note: 'Pokoj 5' };
    const preview = await plugin.describe(input('book', args));
    const booking = await plugin.describe(input('book', { ...args, confirm: true }));

    expect(preview.sections[0]?.risk).toBe('info');
    expect(preview.title.fallback.en).toContain('Preview');
    expect(booking.sections[0]?.risk).toBe('danger');
    expect(booking.sections[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'Pokoj 5' }),
      expect.objectContaining({ value: true }),
    ]));
    expect(booking.proposedScopes).toEqual([]);
  });

  it('limits location approval to one person for one hour', async () => {
    const result = await new ConnectedApprovalPlugin('geo').describe(input('where_is', {
      person: 'iva',
      refresh: true,
    }));
    expect(result.sections[0]?.risk).toBe('warning');
    expect(result.proposedScopes).toEqual([
      expect.objectContaining({
        predicates: [{ path: '/person', operator: 'equals', value: 'iva' }],
        durations: ['hour'],
      }),
    ]);
  });

  it('falls back to the generic presentation for an unknown operation', async () => {
    const result = await new ConnectedApprovalPlugin('email').describe(input('unknown_tool', { id: '1' }));
    expect(result).toMatchObject({ source: 'generic', reasonCode: 'plugin.tool_unknown' });
  });
});
