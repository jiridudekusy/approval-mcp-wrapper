import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { ActiveGrants, type GrantView } from '../components/active-grants.js';
import { ProfileManager, type ProfileView } from '../components/profile-manager.js';
import { TokenForm } from '../components/token-form.js';
import { useI18n } from '../i18n/i18n.js';

interface TokenView { id: string; label: string; revokedAt?: string; profileIds: string[] }
interface UpstreamView { id: string; alias: string }

export function Access({ csrfToken }: { csrfToken: string }) {
  const { t } = useI18n();
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamView[]>([]);
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [revokingId, setRevokingId] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const refresh = useCallback(async () => {
    const [nextTokens, nextUpstreams, nextGrants, nextProfiles] = await Promise.all([
      api<TokenView[]>('/api/admin/tokens'),
      api<UpstreamView[]>('/api/admin/upstreams'),
      api<GrantView[]>('/api/admin/grants'),
      api<ProfileView[]>('/api/admin/profiles'),
    ]);
    setTokens(nextTokens); setUpstreams(nextUpstreams); setGrants(nextGrants); setProfiles(nextProfiles);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const revoke = async (grant: GrantView) => {
    setRevokingId(grant.id);
    try {
      await api<void>(
        `/api/admin/grants/${grant.id}`,
        { method: 'DELETE', body: JSON.stringify({ version: grant.version }) },
        csrfToken,
      );
      await refresh();
    } finally {
      setRevokingId(undefined);
    }
  };
  return (
    <section className="page">
      <header className="page-header"><div><h1>{t('access.title')}</h1><p>{t('access.subtitle')}</p></div></header>
      <TokenForm csrfToken={csrfToken} onCreated={(value) => { setSecret(value); void refresh(); }} />
      {secret !== undefined && <div className="secret-once" role="dialog"><strong>{t('access.secretOnce')}</strong><code>{secret}</code><button onClick={() => setSecret(undefined)}>×</button></div>}
      <div className="record-list">{tokens.map((token) => <article key={token.id}><span className="record-icon">◇</span><div><h2>{token.label}</h2><code>{token.id}</code></div>{token.revokedAt && <span>REVOKED</span>}</article>)}</div>
      <ProfileManager csrfToken={csrfToken} profiles={profiles} tokens={tokens} upstreams={upstreams} onChanged={() => void refresh()} />
      <h2 className="section-title">{t('access.activeGrants')}</h2>
      <p className="section-subtitle">{t('access.activeGrantsSubtitle')}</p>
      <ActiveGrants grants={grants} revokingId={revokingId} onRevoke={(grant) => void revoke(grant)} />
    </section>
  );
}
