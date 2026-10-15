import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/i18n.js';
import {
  CallPresentation,
  localizedMessage,
  type CallPresentationView,
} from './call-presentation.js';

describe('CallPresentation', () => {
  it('formats ISO date-time values in localized titles too', () => {
    expect(localizedMessage({
      key: 'test.title',
      params: { target: '2026-10-17T20:00' },
      fallback: { en: 'At {target}', cs: 'V {target}' },
    }, 'cs')).toBe('V 17. 10. 2026 v 20:00');
  });
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

  it('renders a wellness booking as readable fields with raw JSON collapsed', () => {
    const presentation: CallPresentationView = {
      source: 'plugin', pluginId: 'krkonoskewellness', pluginVersion: '1.0.0',
      title: { key: 'wellness.book', fallback: { en: 'Wellness booking: {target}', cs: 'Rezervace: {target}' }, params: { target: 'Classic massage' } },
      sections: [
        { id: 'request', heading: { key: 'request', fallback: { en: 'Requested operation', cs: 'Požadovaná operace' } }, fields: [
          { label: { key: 'krkonoskewellness.field.service_id', fallback: { en: 'Service', cs: 'Služba' } }, value: { id: 62431, name: 'Classic massage' } },
          { label: { key: 'krkonoskewellness.field.start', fallback: { en: 'Start', cs: 'Začátek' } }, value: '2026-10-17T20:00' },
          { label: { key: 'krkonoskewellness.field.therapist_id', fallback: { en: 'Therapist', cs: 'Masérka' } }, value: { id: 44952, name: null } },
          { label: { key: 'krkonoskewellness.field.confirm', fallback: { en: 'Booking', cs: 'Rezervace' } }, value: true },
        ] },
        { id: 'technical', heading: { key: 'technical', fallback: { en: 'All arguments', cs: 'Všechny argumenty' } }, fields: [
          { label: { key: 'arguments', fallback: { en: 'Arguments', cs: 'Argumenty' } }, value: { service_id: 62431, start: '2026-10-17T20:00' } },
        ] },
      ], proposedScopes: [],
    };
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(CallPresentation, { presentation })));
    expect(html).toContain('Classic massage');
    expect(html).toContain('ID 62431');
    expect(html).toContain('10/17/2026 at 20:00');
    expect(html).toContain('Name unverified');
    expect(html).toContain('Binding');
    expect(html).toContain('<details');
    expect(html).toContain('Show technical arguments');
    expect(html).toContain('2026-10-17T20:00');
  });
});
