import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n.js';
import {
  CallPresentation,
  type CallPresentationView,
} from './call-presentation.js';

describe('CallPresentation', () => {
  it('renders resolved entities, technical IDs, risk, and complete text', () => {
    const presentation: CallPresentationView = {
      source: 'plugin',
      pluginId: 'minutes',
      pluginVersion: '1.0.0',
      title: {
        key: 'minutes.send',
        fallback: { en: 'Send message: Family', cs: 'Odeslat zprávu: Rodina' },
      },
      sections: [
        {
          id: 'request',
          heading: {
            key: 'minutes.request',
            fallback: { en: 'Requested operation', cs: 'Požadovaná operace' },
          },
          risk: 'warning',
          fields: [
            {
              label: {
                key: 'minutes.conversation',
                fallback: { en: 'Conversation', cs: 'Konverzace' },
              },
              value: { id: 'family-id', name: 'Family' },
            },
            {
              label: {
                key: 'minutes.text',
                fallback: { en: 'Message text', cs: 'Text zprávy' },
              },
              value: 'Complete message text\nwith a second line.',
            },
          ],
        },
      ],
      proposedScopes: [],
    };

    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(CallPresentation, { presentation }),
      ),
    );

    expect(html).toContain('Family');
    expect(html).toContain('family-id');
    expect(html).toContain('Complete message text');
    expect(html).toContain('with a second line.');
    expect(html).toContain('Warning');
  });
});
