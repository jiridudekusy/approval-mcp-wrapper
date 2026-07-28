import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { UpstreamForm } from '../components/upstream-form.js';
import { useI18n } from '../i18n/i18n.js';

interface UpstreamView {
  id: string;
  alias: string;
  url: string;
  allowPrivateNetwork: boolean;
  credentialsConfigured: boolean;
}

export function Upstreams({ csrfToken }: { csrfToken: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<UpstreamView[]>([]);
  const [adding, setAdding] = useState(false);
  const refresh = useCallback(
    async () => setItems(await api<UpstreamView[]>('/api/admin/upstreams')),
    [],
  );
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <section className="page">
      <header className="page-header"><div><h1>{t('upstreams.title')}</h1><p>{t('upstreams.subtitle')}</p></div><button className="primary compact" onClick={() => setAdding((value) => !value)}>{t('upstreams.add')}</button></header>
      {adding && <UpstreamForm csrfToken={csrfToken} onCreated={() => { setAdding(false); void refresh(); }} />}
      <div className="record-list">
        {items.length === 0 && <p>{t('upstreams.none')}</p>}
        {items.map((item) => <article key={item.id}><span className="record-icon">⇄</span><div><h2>{item.alias}</h2><code>{item.url}</code></div><div className="record-badges">{item.allowPrivateNetwork && <span>PRIVATE</span>}{item.credentialsConfigured && <span>AUTH</span>}</div></article>)}
      </div>
    </section>
  );
}
