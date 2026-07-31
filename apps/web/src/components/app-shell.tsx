import type { ReactNode } from 'react';

import { api } from '../api/client.js';
import { useI18n, type Locale } from '../i18n/i18n.js';
import { useTheme } from '../theme/theme.js';
import { Icon, type IconName } from './icon.js';
import { LanguageSwitch } from './language-switch.js';

export type Page = 'access' | 'history' | 'inbox' | 'system' | 'upstreams';
const nav: { page: Page; key: `nav.${Page}`; icon: IconName }[] = [
  { page: 'inbox', key: 'nav.inbox', icon: 'inbox' },
  { page: 'history', key: 'nav.history', icon: 'arrow-history' },
  { page: 'access', key: 'nav.access', icon: 'shield-check' },
  { page: 'upstreams', key: 'nav.upstreams', icon: 'sync' },
  { page: 'system', key: 'nav.system', icon: 'chip' },
];

export function AppShell({ page, csrfToken, onNavigate, onLogout, children }: {
  page: Page;
  csrfToken: string;
  onNavigate(page: Page): void;
  onLogout(): void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { theme, toggle } = useTheme();
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }, csrfToken);
    onLogout();
  };
  const navigation = nav.map((item) => <button type="button" key={item.page} className={page === item.page ? 'selected' : ''} aria-current={page === item.page ? 'page' : undefined} onClick={() => onNavigate(item.page)}><Icon name={item.icon} /><span>{t(item.key)}</span></button>);
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="shield-check" size={20} /></span><div><strong>{t('app.name')}</strong><small>{t('app.controlPlane')}</small></div></div>
      <nav aria-label={t('nav.primary')}>{navigation}</nav>
      <div className="sidebar-foot">
        <div className="preference-row"><LanguageSwitch /><button type="button" className="theme-toggle" onClick={toggle} aria-label={theme === 'dark' ? t('status.lightTheme') : t('status.darkTheme')}><Icon name={theme === 'dark' ? 'check-circle' : 'clock'} /><span>{theme === 'dark' ? t('status.darkTheme') : t('status.lightTheme')}</span></button></div>
        <button className="logout-button" type="button" onClick={() => void logout()}><Icon name="log-out" />{t('common.logout')}</button>
        <span className="secure-line"><Icon name="lock-closed" />{t('status.secure')}</span>
      </div>
    </aside>
    <main>{children}</main>
    <nav className="bottom-nav" aria-label={t('nav.primary')}>{navigation}</nav>
  </div>;
}

export function localePath(locale: Locale, page: Page): string { return `#/${locale}/${page}`; }
