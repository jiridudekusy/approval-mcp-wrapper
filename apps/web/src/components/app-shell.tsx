import type { ReactNode } from 'react';

import { useI18n, type Locale } from '../i18n/i18n.js';
import { LanguageSwitch } from './language-switch.js';

export type Page = 'access' | 'history' | 'inbox' | 'system' | 'upstreams';

const nav: { page: Page; key: `nav.${Page}`; glyph: string }[] = [
  { page: 'inbox', key: 'nav.inbox', glyph: '●' },
  { page: 'history', key: 'nav.history', glyph: '↗' },
  { page: 'access', key: 'nav.access', glyph: '◇' },
  { page: 'upstreams', key: 'nav.upstreams', glyph: '⇄' },
  { page: 'system', key: 'nav.system', glyph: '⌁' },
];

export function AppShell({
  page,
  onNavigate,
  children,
}: {
  page: Page;
  onNavigate(page: Page): void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <strong>{t('app.name')}</strong>
            <small>CONTROL PLANE</small>
          </div>
        </div>
        <nav aria-label="Primary">
          {nav.map((item) => (
            <button
              type="button"
              key={item.page}
              className={page === item.page ? 'selected' : ''}
              onClick={() => onNavigate(item.page)}
            >
              <span aria-hidden="true">{item.glyph}</span>
              {t(item.key)}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <LanguageSwitch />
          <span className="secure-dot">{t('status.secure')}</span>
        </div>
      </aside>
      <main>{children}</main>
      <nav className="bottom-nav" aria-label="Primary">
        {nav.map((item) => (
          <button
            type="button"
            key={item.page}
            className={page === item.page ? 'selected' : ''}
            onClick={() => onNavigate(item.page)}
          >
            <span aria-hidden="true">{item.glyph}</span>
            <small>{t(item.key)}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function localePath(locale: Locale, page: Page): string {
  return `#/${locale}/${page}`;
}
