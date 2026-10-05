import { describe, expect, it, vi } from 'vitest';

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
      expect.objectContaining({ value: { id: recipient, name: null } }),
      expect.objectContaining({ value: 'Ahoj, zítra v deset.' }),
    ]));
    expect(result.proposedScopes).toEqual([
      expect.objectContaining({
        predicates: [{ path: '/recipient', operator: 'equals', value: recipient }],
        durations: ['hour'],
      }),
    ]);
  });

  it('shows a verified contact name with the immutable WhatsApp recipient ID', async () => {
    const recipient = '420777123456@s.whatsapp.net';
    const findContact = vi.fn().mockResolvedValue({
      content: [{ text: JSON.stringify({ contacts: [
        { jid: '420999111222@s.whatsapp.net', name: 'Wrong contact' },
        { jid: recipient, name: 'Jana Nováková' },
      ] }) }],
    });
    const plugin = new ConnectedApprovalPlugin('whatsapp', { findContact });
    const result = await plugin.describe(input('send_message', { recipient, message: 'Ahoj' }));

    expect(findContact).toHaveBeenCalledWith('upstream-1', 'whatsapp', recipient);
    expect(result.title.params?.['target']).toBe(`Jana Nováková (${recipient})`);
    expect(result.sections[0]?.fields[0]?.value).toEqual({ id: recipient, name: 'Jana Nováková' });
    expect(result.proposedScopes[0]?.predicates).toEqual([
      { path: '/recipient', operator: 'equals', value: recipient },
    ]);
  });

  it('resolves a WhatsApp LID chat and scopes history sync to that chat', async () => {
    const chatJid = '159472202842303@lid';
    const findContact = vi.fn().mockRejectedValue(new Error('Not in contacts'));
    const findChat = vi.fn().mockResolvedValue({ structuredContent: {
      chat: { jid: chatJid, name: 'Rodina' },
    } });
    const plugin = new ConnectedApprovalPlugin('whatsapp', { findContact, findChat });
    const result = await plugin.describe(input('sync_chat_history', { chat_jid: chatJid, count: 50 }));

    expect(findChat).toHaveBeenCalledWith('upstream-1', chatJid);
    expect(result.title.params?.['target']).toBe(`Rodina (${chatJid})`);
    expect(result.sections[0]?.fields[0]?.value).toEqual({ id: chatJid, name: 'Rodina' });
    expect(result.proposedScopes[0]?.predicates).toEqual([
      { path: '/chat_jid', operator: 'equals', value: chatJid },
    ]);
  });

  it('shows the referenced message and offers only a chat-scoped media grant', async () => {
    const chatJid = '159472202842303@lid';
    const plugin = new ConnectedApprovalPlugin('whatsapp', {
      findContact: vi.fn(),
      findChat: vi.fn().mockResolvedValue({ chat: { jid: chatJid, name: 'Rodina' } }),
      findMessage: vi.fn().mockResolvedValue({ message: {
        message_id: 'message-1', chat_jid: chatJid, body: 'Tady je dokument.',
      } }),
    });
    const result = await plugin.describe(input('download_media', {
      chat_jid: chatJid, message_id: 'message-1',
    }));

    expect(result.sections[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'Tady je dokument.' }),
      expect.objectContaining({ value: { id: chatJid, name: 'Rodina' } }),
    ]));
    expect(result.proposedScopes[0]?.predicates).toEqual([
      { path: '/chat_jid', operator: 'equals', value: chatJid },
    ]);
  });

  it('does not display a contact name from an unrelated search result', async () => {
    const plugin = new ConnectedApprovalPlugin('whatsapp', {
      findContact: vi.fn().mockResolvedValue({ contacts: [{ jid: 'other@lid', name: 'Cizí kontakt' }] }),
    });
    const result = await plugin.describe(input('send_message', { recipient: 'target@lid', message: 'Ahoj' }));

    expect(result.sections[0]?.fields[0]?.value).toEqual({ id: 'target@lid', name: null });
    expect(result.title.params?.['target']).toBe('target@lid');
  });

  it('shows the contact name for a macOS phone call when the number matches', async () => {
    const plugin = new ConnectedApprovalPlugin('imcp', {
      findContact: vi.fn().mockResolvedValue({ structuredContent: {
        contacts: [{ displayName: 'Petr Svoboda', phoneNumbers: [{ value: '+420 777 123 456' }] }],
      } }),
    });
    const result = await plugin.describe(input('phone_call', { phoneNumber: '+420777123456' }));

    expect(result.sections[0]?.fields[0]?.value).toEqual({ id: '+420777123456', name: 'Petr Svoboda' });
    expect(result.title.params?.['target']).toBe('Petr Svoboda (+420777123456)');
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
