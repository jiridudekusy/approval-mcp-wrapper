import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n.js';
import { ProfileMatrix, updateVisibleSelection } from './profile-matrix.js';

describe('profile tool matrix', () => {
  it('removes only tools visible under the active filter', () => {
    expect([...updateVisibleSelection(new Set(['visible', 'hidden']), ['visible'], false)]).toEqual(['hidden']);
  });
  it('groups tools by MCP server and exposes server, tool, and bulk controls', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(ProfileMatrix, {
          upstreams: [{ id: 'signal', alias: 'Signal MCP' }],
          catalogs: {
            signal: {
              upstreamId: 'signal',
              refreshedAt: '2026-07-30T00:00:00.000Z',
              tools: [
                { name: 'get_messages', inputSchema: {} },
                { name: 'send_message', inputSchema: {} },
              ],
            },
          },
          rules: [
            {
              id: 'server-rule',
              profileId: 'profile-1',
              upstreamId: 'signal',
              outcome: 'allow',
            },
            {
              id: 'tool-rule',
              profileId: 'profile-1',
              upstreamId: 'signal',
              toolName: 'send_message',
              outcome: 'require_approval',
            },
          ],
          busy: false,
          onSetRule: () => undefined,
          onSetRules: async () => undefined,
          onRemoveRule: () => undefined,
        }),
      ),
    );

    expect(html).toContain('Signal MCP');
    expect(html).toContain('All tools');
    expect(html).toContain('get_messages');
    expect(html).toContain('send_message');
    expect(html).toContain('Select all visible tools');
    expect(html).toContain('Require approval');
    expect(html).toContain('via server rule');
    expect(html).toContain('OVERRIDE');
    expect(html).toContain('aria-pressed="true"');
  });
});
