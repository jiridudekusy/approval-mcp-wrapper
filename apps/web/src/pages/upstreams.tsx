import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { UpstreamForm } from '../components/upstream-form.js';
import {
  ToolCatalogPanel,
  type ToolCatalogView,
} from '../components/tool-catalog.js';
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
  const [catalogs, setCatalogs] = useState<
    Record<string, ToolCatalogView | undefined>
  >({});
  const [loading, setLoading] = useState<Record<string, boolean | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const refresh = useCallback(
    async () => setItems(await api<UpstreamView[]>('/api/admin/upstreams')),
    [],
  );
  const discover = useCallback(async (upstreamId: string) => {
    setLoading((current) => ({ ...current, [upstreamId]: true }));
    setErrors((current) => ({ ...current, [upstreamId]: undefined }));
    try {
      const catalog = await api<ToolCatalogView>(
        `/api/admin/upstreams/${upstreamId}/tools`,
      );
      setCatalogs((current) => ({ ...current, [upstreamId]: catalog }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [upstreamId]: error instanceof Error ? error.message : 'discovery_failed',
      }));
    } finally {
      setLoading((current) => ({ ...current, [upstreamId]: false }));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <section className="page">
      <header className="page-header"><div><h1>{t('upstreams.title')}</h1><p>{t('upstreams.subtitle')}</p></div><button className="primary compact" onClick={() => setAdding((value) => !value)}>{t('upstreams.add')}</button></header>
      {adding && <UpstreamForm csrfToken={csrfToken} onCreated={(upstream) => { setAdding(false); void refresh(); void discover(upstream.id); }} />}
      <div className="record-list">
        {items.length === 0 && <p>{t('upstreams.none')}</p>}
        {items.map((item) => <article className="upstream-record" key={item.id}><span className="record-icon">⇄</span><div><h2>{item.alias}</h2><code>{item.url}</code></div><div className="record-badges">{item.allowPrivateNetwork && <span>PRIVATE</span>}{item.credentialsConfigured && <span>AUTH</span>}</div><ToolCatalogPanel tools={catalogs[item.id]?.tools} loading={loading[item.id] === true} error={errors[item.id]} onDiscover={() => void discover(item.id)} /></article>)}
      </div>
    </section>
  );
}
