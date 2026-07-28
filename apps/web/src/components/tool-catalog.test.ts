import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n.js';
import { PolicyEditor } from './policy-editor.js';
import { ToolCatalogPanel } from './tool-catalog.js';

const tools = [
  {
    name: 'signal_send_message',
    description: 'Send a message',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
    },
  },
];

describe('tool catalog UI', () => {
  it('renders discovered tool metadata and schema as inert text', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(ToolCatalogPanel, {
          tools,
          loading: false,
          error: undefined,
          onDiscover: () => undefined,
        }),
      ),
    );

    expect(html).toContain('signal_send_message');
    expect(html).toContain('Send a message');
    expect(html).toContain('&quot;message&quot;');
  });

  it('uses discovered tools as policy options', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(PolicyEditor, {
          csrfToken: 'csrf',
          tokenId: 'token',
          upstreamId: 'upstream',
          tools,
          onCreated: () => undefined,
        }),
      ),
    );

    expect(html).toContain('<select');
    expect(html).toContain(
      '<option value="signal_send_message">signal_send_message</option>',
    );
  });
});
