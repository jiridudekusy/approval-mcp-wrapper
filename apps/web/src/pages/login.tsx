import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { useState } from 'react';

import { api, ApiError } from '../api/client.js';
import { LanguageSwitch } from '../components/language-switch.js';
import { useI18n } from '../i18n/i18n.js';

export function Login({ onAuthenticated }: { onAuthenticated(csrf: string): void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function login() {
    setBusy(true);
    setError(false);
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
        '/api/auth/login/options',
        { method: 'POST' },
      );
      const response = await startAuthentication({ optionsJSON: options });
      const result = await api<{ csrfToken: string }>(
        '/api/auth/login/verify',
        { method: 'POST', body: JSON.stringify(response) },
      );
      onAuthenticated(result.csrfToken);
    } catch (loginError) {
      if (loginError instanceof ApiError && loginError.status === 500) {
        try {
          const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>(
            '/api/auth/bootstrap/options',
            { method: 'POST' },
          );
          const response = await startRegistration({ optionsJSON: options });
          const result = await api<{ csrfToken: string }>(
            '/api/auth/bootstrap/verify',
            { method: 'POST', body: JSON.stringify(response) },
          );
          onAuthenticated(result.csrfToken);
          return;
        } catch {
          setError(true);
        }
      } else {
        setError(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <header className="login-header">
        <div className="brand">
          <span className="brand-mark">A</span>
          <strong>{t('app.name')}</strong>
        </div>
        <LanguageSwitch />
      </header>
      <section className="login-panel">
        <div className="login-copy">
          <p className="eyebrow">{t('login.eyebrow')}</p>
          <h1>{t('login.title')}</h1>
          <p>{t('login.description')}</p>
        </div>
        <div className="login-card">
          <div className="passkey-orbit" aria-hidden="true">
            <span>⌁</span>
          </div>
          <button className="primary" type="button" onClick={login} disabled={busy}>
            {busy ? t('common.loading') : t('login.passkey')}
          </button>
          <button className="text-button" type="button">
            {t('login.recovery')}
          </button>
          {error && <p className="error" role="alert">{t('login.failed')}</p>}
        </div>
      </section>
      <footer>{t('status.secure')}</footer>
    </main>
  );
}
