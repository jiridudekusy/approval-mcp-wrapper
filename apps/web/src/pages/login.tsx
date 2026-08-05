import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { useCallback, useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client.js';
import { LanguageSwitch } from '../components/language-switch.js';
import { Icon } from '../components/icon.js';
import { useI18n } from '../i18n/i18n.js';
import { useTheme } from '../theme/theme.js';
import { useDialogLifecycle } from '../hooks/use-dialog-lifecycle.js';

export function Login({ onAuthenticated }: { onAuthenticated(csrf: string): void }) {
  const { t } = useI18n();
  const { theme, toggle } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryError, setRecoveryError] = useState(false);
  const closeRecovery = useCallback(() => setRecoveryOpen(false), []);
  const recoveryDialogRef = useDialogLifecycle<HTMLDivElement>(recoveryOpen, closeRecovery);

  async function recover(event: FormEvent) {
    event.preventDefault(); setBusy(true); setRecoveryError(false);
    try {
      const result = await api<{ csrfToken: string }>('/api/auth/recovery', { method: 'POST', body: JSON.stringify({ code: recoveryCode }) });
      onAuthenticated(result.csrfToken);
    } catch { setRecoveryError(true); }
    finally { setBusy(false); }
  }

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
        <div className="brand"><span className="brand-mark"><Icon name="shield-check" size={20} /></span><div><strong>{t('app.name')}</strong><small>{t('app.controlPlane')}</small></div></div>
        <div className="login-preferences">
          <LanguageSwitch />
          <button className="theme-toggle" type="button" onClick={toggle}>
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
            <span>{theme === 'dark' ? t('status.darkTheme') : t('status.lightTheme')}</span>
          </button>
        </div>
      </header>
      <section className="login-panel">
        <div className="login-copy">
          <p className="eyebrow">{t('login.eyebrow')}</p>
          <h1>{t('login.title')}</h1>
          <p>{t('login.description')}</p>
        </div>
        <div className="login-card">
          <div className="passkey-orbit" aria-hidden="true"><Icon name="fingerprint" size={36} /></div>
          <button className="primary" type="button" onClick={login} disabled={busy}>
            {busy ? t('common.loading') : t('login.passkey')}
          </button>
          <button className="text-button" type="button" onClick={() => setRecoveryOpen(true)}>
            {t('login.recovery')}
          </button>
          {error && <p className="error" role="alert">{t('login.failed')}</p>}
        </div>
      </section>
      {recoveryOpen && <div className="modal-backdrop"><div ref={recoveryDialogRef} className="modal-card" role="dialog" aria-modal="true" aria-label={t('login.recovery')}><form className="token-form" onSubmit={(event) => void recover(event)}><h2>{t('login.recovery')}</h2><label>{t('login.recoveryCode')}<input autoFocus autoComplete="one-time-code" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>{recoveryError && <p className="error" role="alert">{t('login.recoveryFailed')}</p>}<div className="modal-actions"><button type="button" onClick={closeRecovery}>{t('common.cancel')}</button><button className="primary" type="submit" disabled={busy || recoveryCode.trim() === ''}>{busy ? t('common.loading') : t('login.recoverySubmit')}</button></div></form></div></div>}
      <footer><Icon name="lock-closed" />{t('status.secure')}</footer>
    </main>
  );
}
