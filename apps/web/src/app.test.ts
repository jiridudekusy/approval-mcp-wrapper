import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './app.js';
import { I18nProvider } from './i18n/i18n.js';
import { ThemeProvider } from './theme/theme.js';

describe('application session restoration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not trust the CSRF cookie before server validation', () => {
    vi.stubGlobal('document', { cookie: 'amcp_csrf=csrf-from-login' });

    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(I18nProvider, null, createElement(App)),
      ),
    );

    expect(html).toContain('session-check');
    expect(html).not.toContain('<nav');
    expect(html).not.toContain('login-page');
  });

  it('renders login immediately when no CSRF cookie exists', () => {
    vi.stubGlobal('document', { cookie: '' });

    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(I18nProvider, null, createElement(App)),
      ),
    );

    expect(html).toContain('login-page');
    expect(html).not.toContain('<nav');
  });
});
