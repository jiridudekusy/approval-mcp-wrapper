import { startAuthentication } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { LanguageSwitch } from '../components/language-switch.js';
import { Icon } from '../components/icon.js';
import { useI18n } from '../i18n/i18n.js';
import { useTheme } from '../theme/theme.js';

interface ConsentRequest {
  clientName: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  profiles: { id: string; name: string; version: number; ruleCount: number }[];
}

export function OAuthConsent({ requestId, csrfToken }: { requestId: string; csrfToken: string }) {
  const { t, formatDate } = useI18n();
  const { theme, toggle } = useTheme();
  const [request, setRequest] = useState<ConsentRequest>();
  const [label, setLabel] = useState('');
  const [profileId, setProfileId] = useState('');
  const [lifetimeSeconds, setLifetimeSeconds] = useState(3600);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setRequest(undefined);
    setError(false);
    void api<ConsentRequest>(`/api/oauth/requests/${encodeURIComponent(requestId)}`)
      .then((result) => {
        if (!active) return;
        setRequest(result);
        setLabel(result.clientName);
        setProfileId(result.profiles[0]?.id ?? '');
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [requestId]);

  useEffect(() => {
    const interval = globalThis.setInterval(() => setNow(Date.now()), 30_000);
    return () => globalThis.clearInterval(interval);
  }, []);

  async function approve() {
    if (profileId === '' || label.trim() === '') return;
    setBusy(true);
    setError(false);
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
        '/api/auth/login/options', { method: 'POST' },
      );
      const passkey = await startAuthentication({ optionsJSON: options });
      const { redirectTo } = await api<{ redirectTo: string }>(
        `/api/oauth/requests/${encodeURIComponent(requestId)}/approve`,
        { method: 'POST', body: JSON.stringify({ profileId, lifetimeSeconds, label: label.trim(), passkey }) },
        csrfToken,
      );
      globalThis.location.assign(redirectTo);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  async function deny() {
    setBusy(true);
    setError(false);
    try {
      const { redirectTo } = await api<{ redirectTo: string }>(
        `/api/oauth/requests/${encodeURIComponent(requestId)}/deny`,
        { method: 'POST' }, csrfToken,
      );
      globalThis.location.assign(redirectTo);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return <main className="oauth-page">
    <header className="login-header">
      <div className="brand"><span className="brand-mark"><Icon name="shield-check" size={20} /></span><div><strong>{t('app.name')}</strong><small>{t('app.controlPlane')}</small></div></div>
      <div className="login-preferences"><LanguageSwitch /><button className="theme-toggle" type="button" onClick={toggle}><Icon name={theme === 'dark' ? 'moon' : 'sun'} /><span>{theme === 'dark' ? t('status.darkTheme') : t('status.lightTheme')}</span></button></div>
    </header>
    <section className="oauth-card" aria-busy={busy}>
      <div className="oauth-heading"><span className="oauth-heading-icon"><Icon name="shield-account" size={26} /></span><div><p className="eyebrow">{t('oauth.eyebrow')}</p><h1>{t('oauth.title')}</h1><p className="oauth-intro">{t('oauth.description')}</p></div></div>
      {request === undefined ? <p>{error ? t('oauth.failed') : t('common.loading')}</p> : <>
        <div className="oauth-client">
          <div className="oauth-client-heading"><span className="oauth-client-icon"><Icon name="chip" size={22} /></span><div><small>{t('oauth.requestedBy')}</small><strong>{request.clientName}</strong><span>{t('oauth.unverified')}</span></div></div>
          <div className="oauth-client-route"><span>{t('oauth.server')}</span><code>{request.resource}</code></div>
          <details className="oauth-technical"><summary>{t('oauth.technicalDetails')}</summary><dl><dt>{t('oauth.clientId')}</dt><dd>{request.clientId}</dd><dt>{t('oauth.redirect')}</dt><dd>{request.redirectUri}</dd></dl></details>
        </div>
        <div className="oauth-form-heading"><h2>{t('oauth.settingsTitle')}</h2><p>{t('oauth.settingsDescription')}</p></div>
        <label className="oauth-field">{t('oauth.label')}
          <input value={label} maxLength={120} required disabled={busy} onChange={(event) => setLabel(event.target.value)} placeholder={t('oauth.labelPlaceholder')} />
          <small>{t('oauth.labelHint')}</small>
        </label>
        <label className="oauth-field">{t('oauth.profile')}
          <select value={profileId} disabled={busy || request.profiles.length === 0} onChange={(event) => setProfileId(event.target.value)}>
            {request.profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} ({profile.ruleCount} {t('oauth.rules')})</option>)}
          </select>
        </label>
        <label className="oauth-field">{t('oauth.duration')}
          <select value={lifetimeSeconds} disabled={busy} onChange={(event) => setLifetimeSeconds(Number(event.target.value))}>
            <option value={3600}>{t('oauth.hour')}</option>
            <option value={28800}>{t('oauth.eightHours')}</option>
            <option value={86400}>{t('oauth.day')}</option>
            <option value={604800}>{t('oauth.week')}</option>
            <option value={1209600}>{t('oauth.twoWeeks')}</option>
            <option value={2592000}>{t('oauth.month')}</option>
          </select>
        </label>
        <div className="oauth-expiry"><Icon name="clock" size={19} /><div><strong>{t('oauth.expiresAt')}</strong><span>{formatDate(new Date(now + lifetimeSeconds * 1000))}</span><small>{t('oauth.expiresHint')}</small></div></div>
        <p className="oauth-warning"><Icon name="info" size={18} /><span>{t('oauth.warning')} {t('oauth.scope')}</span></p>
        {error && <p className="oauth-error" role="alert">{t('oauth.failed')}</p>}
        <div className="oauth-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void deny()}>{t('oauth.deny')}</button>
          <button type="button" className="primary" disabled={busy || profileId === '' || label.trim() === ''} onClick={() => void approve()}><Icon name="fingerprint" size={18} />{t('oauth.approve')}</button>
        </div>
      </>}
    </section>
  </main>;
}
