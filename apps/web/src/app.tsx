import { useEffect, useState } from 'react';

import {
  AUTHENTICATION_LOST_EVENT,
  clearClientAuthentication,
  validateSession,
} from './api/client.js';
import { AppShell, type Page } from './components/app-shell.js';
import { useI18n } from './i18n/i18n.js';
import { Inbox } from './pages/inbox.js';
import { Login } from './pages/login.js';
import { Upstreams } from './pages/upstreams.js';
import { Access } from './pages/access.js';
import { System } from './pages/system.js';
import { History } from './pages/history.js';

function csrfTokenFromCookie(): string | undefined {
  for (const part of globalThis.document?.cookie.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === 'amcp_csrf') return value.join('=');
  }
  return undefined;
}

type AuthenticationState =
  | { status: 'anonymous' }
  | { status: 'checking'; csrfToken: string }
  | { status: 'authenticated'; csrfToken: string };

function initialAuthenticationState(): AuthenticationState {
  const csrfToken = csrfTokenFromCookie();
  return csrfToken === undefined
    ? { status: 'anonymous' }
    : { status: 'checking', csrfToken };
}

export function App() {
  const { t } = useI18n();
  const [authentication, setAuthentication] = useState<AuthenticationState>(
    initialAuthenticationState,
  );
  const [page, setPage] = useState<Page>('inbox');

  useEffect(() => {
    if (authentication.status !== 'checking') return;
    let active = true;
    void validateSession().then((status) => {
      if (!active) return;
      setAuthentication(
        status === 'authenticated'
          ? {
              status: 'authenticated',
              csrfToken: authentication.csrfToken,
            }
          : { status: 'anonymous' },
      );
    });
    return () => {
      active = false;
    };
  }, [authentication]);

  useEffect(() => {
    const authenticationLost = () => {
      clearClientAuthentication();
      setAuthentication({ status: 'anonymous' });
    };
    globalThis.addEventListener?.(
      AUTHENTICATION_LOST_EVENT,
      authenticationLost,
    );
    return () =>
      globalThis.removeEventListener?.(
        AUTHENTICATION_LOST_EVENT,
        authenticationLost,
      );
  }, []);

  if (authentication.status === 'checking') {
    return (
      <main className="session-check" aria-busy="true">
        <span className="brand-mark">A</span>
        <p>{t('common.loading')}</p>
      </main>
    );
  }
  if (authentication.status === 'anonymous') {
    return (
      <Login
        onAuthenticated={(csrfToken) =>
          setAuthentication({ status: 'authenticated', csrfToken })
        }
      />
    );
  }
  const { csrfToken } = authentication;
  return (
    <AppShell page={page} csrfToken={csrfToken} onNavigate={setPage} onLogout={() => setAuthentication({ status: 'anonymous' })}>
      {page === 'inbox' ? (
        <Inbox csrfToken={csrfToken} />
      ) : page === 'upstreams' ? (
        <Upstreams csrfToken={csrfToken} />
      ) : page === 'access' ? (
        <Access csrfToken={csrfToken} />
      ) : page === 'system' ? (
        <System />
      ) : page === 'history' ? (
        <History />
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
