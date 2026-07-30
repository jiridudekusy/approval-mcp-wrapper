import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n.js';
import { ActiveGrants, type GrantView } from './active-grants.js';

describe('active grants UI', () => {
  it('shows who can use which tool, the expiry, condition, and revoke action', () => {
    const grant: GrantView = {
      id: 'grant-1',
      clientTokenId: 'token-1',
      tokenLabel: 'Claude Code',
      upstreamId: 'upstream-1',
      upstreamAlias: 'signal',
      toolName: 'get_conversations',
      predicates: [{ path: '/groupId', operator: 'exists' }],
      scope: 'until',
      createdAt: '2026-07-30T08:28:22.098Z',
      expiresAt: '2026-07-30T09:28:22.098Z',
      version: 1,
    };

    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(ActiveGrants, {
          grants: [grant],
          revokingId: undefined,
          onRevoke: () => undefined,
        }),
      ),
    );

    expect(html).toContain('Claude Code');
    expect(html).toContain('signal');
    expect(html).toContain('get_conversations');
    expect(html).toContain('/groupId');
    expect(html).toContain('Revoke');
    expect(html).toContain('2026');
  });
});
