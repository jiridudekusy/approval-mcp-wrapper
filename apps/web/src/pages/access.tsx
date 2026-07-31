import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { ActiveGrants, type GrantView } from '../components/active-grants.js';
import { ProfileManager, type ProfileView } from '../components/profile-manager.js';
import { TokenForm } from '../components/token-form.js';
import { useI18n } from '../i18n/i18n.js';
import { useDialogLifecycle } from '../hooks/use-dialog-lifecycle.js';

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
  const [tab, setTab] = useState<'agents' | 'profiles' | 'permissions'>('agents');
  const [creatingToken, setCreatingToken] = useState(false);
  const closeTokenDialog = useCallback(() => setCreatingToken(false), []);
  const tokenDialogRef = useDialogLifecycle<HTMLDivElement>(creatingToken, closeTokenDialog);
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
    <section className="page page-access">
      <header className="page-header"><div><h1>{t('access.title')}</h1><p>{t('access.subtitle')}</p></div>{tab === 'agents' && <button className="primary compact" onClick={() => setCreatingToken(true)}>{t('access.newToken')}</button>}</header>
      <div className="access-tabs" role="tablist">
        {(['agents', 'profiles', 'permissions'] as const).map((name) => <button role="tab" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} type="button" key={name} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const tabs = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role=tab]')]; const index = tabs.indexOf(event.currentTarget); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; next?.focus(); next?.click(); }} onClick={() => setTab(name)}>{t(`access.${name}`)} <span>{name === 'agents' ? tokens.length : name === 'profiles' ? profiles.length : grants.length}</span></button>)}
      </div>
      {secret !== undefined && <div className="secret-once" role="alert"><div><strong>{t('access.secretOnce')}</strong><code>{secret}</code></div><button type="button" onClick={() => void navigator.clipboard?.writeText(secret)}>{t('common.copy')}</button><button className="icon-button" aria-label={t('common.close')} onClick={() => setSecret(undefined)}>×</button></div>}
      {tab === 'agents' && <><p className="info-line">{t('access.defaultHint')}</p><ProfileManager mode="agents" csrfToken={csrfToken} profiles={profiles} tokens={tokens} upstreams={upstreams} onChanged={() => void refresh()} /></>}
      {tab === 'profiles' && <ProfileManager mode="profiles" csrfToken={csrfToken} profiles={profiles} tokens={tokens} upstreams={upstreams} onChanged={() => void refresh()} />}
      {tab === 'permissions' && <><p className="section-subtitle">{t('access.activeGrantsSubtitle')}</p><ActiveGrants grants={grants} revokingId={revokingId} onRevoke={(grant) => void revoke(grant)} /></>}
      {creatingToken && <div className="modal-backdrop" role="presentation"><div ref={tokenDialogRef} className="modal-card" role="dialog" aria-modal="true" aria-label={t('access.newToken')}><TokenForm csrfToken={csrfToken} onCancel={closeTokenDialog} onCreated={(value) => { setCreatingToken(false); setSecret(value); void refresh(); }} /></div></div>}
    </section>
  );
}
