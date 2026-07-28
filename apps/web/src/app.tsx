import { useState } from 'react';

import { AppShell, type Page } from './components/app-shell.js';
import { useI18n } from './i18n/i18n.js';
import { Inbox } from './pages/inbox.js';
import { Login } from './pages/login.js';
import { Upstreams } from './pages/upstreams.js';
import { Access } from './pages/access.js';
import { System } from './pages/system.js';

export function App() {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string>();
  const [page, setPage] = useState<Page>('inbox');

  if (csrfToken === undefined) {
    return <Login onAuthenticated={setCsrfToken} />;
  }
  return (
    <AppShell page={page} onNavigate={setPage}>
      {page === 'inbox' ? (
        <Inbox csrfToken={csrfToken} />
      ) : page === 'upstreams' ? (
        <Upstreams csrfToken={csrfToken} />
      ) : page === 'access' ? (
        <Access csrfToken={csrfToken} />
      ) : page === 'system' ? (
        <System />
      ) : (
        <section className="page">
          <header className="page-header">
            <h1>{t(`nav.${page}`)}</h1>
          </header>
          <div className="empty-state">
            <span className="brand-mark">A</span>
          </div>
        </section>
      )}
    </AppShell>
  );
}
