import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { PolicyEditor } from '../components/policy-editor.js';
import { TokenForm } from '../components/token-form.js';
import { useI18n } from '../i18n/i18n.js';
import type { ToolCatalogView, ToolView } from '../components/tool-catalog.js';

interface TokenView { id: string; label: string; revokedAt?: string }
interface UpstreamView { id: string; alias: string }
interface PolicyView { id: string; toolName: string; outcome: string; clientTokenId: string; upstreamId: string }

export function Access({ csrfToken }: { csrfToken: string }) {
  const { t } = useI18n();
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamView[]>([]);
  const [policies, setPolicies] = useState<PolicyView[]>([]);
  const [secret, setSecret] = useState<string>();
  const [tokenId, setTokenId] = useState('');
  const [upstreamId, setUpstreamId] = useState('');
  const [tools, setTools] = useState<readonly ToolView[]>();
  const refresh = useCallback(async () => {
    const [nextTokens, nextUpstreams, nextPolicies] = await Promise.all([
      api<TokenView[]>('/api/admin/tokens'),
      api<UpstreamView[]>('/api/admin/upstreams'),
      api<PolicyView[]>('/api/admin/policies'),
    ]);
    setTokens(nextTokens); setUpstreams(nextUpstreams); setPolicies(nextPolicies);
    setTokenId((current) => current || nextTokens[0]?.id || '');
    setUpstreamId((current) => current || nextUpstreams[0]?.id || '');
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (upstreamId === '') {
      setTools(undefined);
      return;
    }
    let active = true;
    setTools(undefined);
    void api<ToolCatalogView>(
      `/api/admin/upstreams/${upstreamId}/tools`,
    ).then(
      (catalog) => {
        if (active) setTools(catalog.tools);
      },
      () => {
        if (active) setTools(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, [upstreamId]);
  return (
    <section className="page">
      <header className="page-header"><div><h1>{t('access.title')}</h1><p>{t('access.subtitle')}</p></div></header>
      <TokenForm csrfToken={csrfToken} onCreated={(value) => { setSecret(value); void refresh(); }} />
      {secret !== undefined && <div className="secret-once" role="dialog"><strong>{t('access.secretOnce')}</strong><code>{secret}</code><button onClick={() => setSecret(undefined)}>×</button></div>}
      <div className="record-list">{tokens.map((token) => <article key={token.id}><span className="record-icon">◇</span><div><h2>{token.label}</h2><code>{token.id}</code></div>{token.revokedAt && <span>REVOKED</span>}</article>)}</div>
      <h2 className="section-title">{t('access.policies')}</h2>
      {tokenId && upstreamId && <><div className="selectors"><select value={tokenId} onChange={(event) => setTokenId(event.target.value)}>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label}</option>)}</select><select value={upstreamId} onChange={(event) => setUpstreamId(event.target.value)}>{upstreams.map((upstream) => <option key={upstream.id} value={upstream.id}>{upstream.alias}</option>)}</select></div><PolicyEditor csrfToken={csrfToken} tokenId={tokenId} upstreamId={upstreamId} tools={tools} onCreated={() => void refresh()} /></>}
      <div className="policy-list">{policies.map((policy) => <article key={policy.id}><code>{policy.toolName}</code><span className={`outcome ${policy.outcome}`}>{policy.outcome}</span></article>)}</div>
    </section>
  );
}
