import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { UpstreamForm } from '../components/upstream-form.js';
import {
  ToolCatalogPanel,
  type ToolCatalogView,
} from '../components/tool-catalog.js';
import {
  UpstreamDeleteConfirmation,
  UpstreamEditForm,
  type DeletionImpact,
  type ManagedUpstream,
} from '../components/upstream-management.js';
import { useI18n } from '../i18n/i18n.js';

interface UpstreamView extends ManagedUpstream {}

export function Upstreams({ csrfToken }: { csrfToken: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<UpstreamView[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [deleting, setDeleting] = useState<{
    upstream: UpstreamView;
    impact: DeletionImpact;
    busy: boolean;
    error: boolean;
  }>();
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
  const prepareDelete = useCallback(async (upstream: UpstreamView) => {
    const impact = await api<DeletionImpact>(
      `/api/admin/upstreams/${upstream.id}/deletion-impact`,
    );
    setDeleting({ upstream, impact, busy: false, error: false });
  }, []);
  const confirmDelete = useCallback(async () => {
    if (deleting === undefined) return;
    setDeleting({ ...deleting, busy: true, error: false });
    try {
      await api(
        `/api/admin/upstreams/${deleting.upstream.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ version: deleting.upstream.version }),
        },
        csrfToken,
      );
      setDeleting(undefined);
      setEditingId(undefined);
      await refresh();
    } catch {
      setDeleting({ ...deleting, busy: false, error: true });
    }
  }, [csrfToken, deleting, refresh]);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <section className="page">
      <header className="page-header"><div><h1>{t('upstreams.title')}</h1><p>{t('upstreams.subtitle')}</p></div><button className="primary compact" onClick={() => setAdding((value) => !value)}>{t('upstreams.add')}</button></header>
      {adding && <UpstreamForm csrfToken={csrfToken} onCreated={(upstream) => { setAdding(false); void refresh(); void discover(upstream.id); }} />}
      <div className="record-list">
        {items.length === 0 && <p>{t('upstreams.none')}</p>}
        {items.map((item) => <article className="upstream-record" key={item.id}><span className="record-icon">⇄</span><div><h2>{item.alias}</h2><code>{item.url}</code></div><div className="record-badges">{item.allowPrivateNetwork && <span>PRIVATE</span>}{item.credentialsConfigured && <span>AUTH</span>}</div><div className="upstream-actions"><button type="button" onClick={() => setEditingId(item.id)}>{t('upstreams.edit')}</button><button className="danger-link" type="button" onClick={() => void prepareDelete(item)}>{t('upstreams.remove')}</button></div>{editingId === item.id && <UpstreamEditForm upstream={item} csrfToken={csrfToken} onCancel={() => setEditingId(undefined)} onSaved={() => { setEditingId(undefined); void refresh(); }} />}{deleting?.upstream.id === item.id && <UpstreamDeleteConfirmation alias={item.alias} impact={deleting.impact} busy={deleting.busy} error={deleting.error} onCancel={() => setDeleting(undefined)} onConfirm={() => void confirmDelete()} />}<ToolCatalogPanel tools={catalogs[item.id]?.tools} loading={loading[item.id] === true} error={errors[item.id]} onDiscover={() => void discover(item.id)} /></article>)}
      </div>
    </section>
  );
}
