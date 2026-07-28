import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client.js';
import { CallTimeline } from '../components/call-timeline.js';
import { HistoryFilter, type HistoryFilters } from '../components/history-filter.js';
import { useI18n } from '../i18n/i18n.js';

interface CallSummary {
  callId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  clientTokenId: string;
  upstreamId: string;
  toolName: string;
  policyOutcome?: string;
  finalStatus?: string;
}

export function History() {
  const { t, formatDate } = useI18n();
  const [filters, setFilters] = useState<HistoryFilters>({ toolName: '', finalStatus: '' });
  const [items, setItems] = useState<CallSummary[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.toolName) params.set('toolName', filters.toolName);
    if (filters.finalStatus) params.set('finalStatus', filters.finalStatus);
    return params;
  }, [filters]);
  const refresh = useCallback(async () => {
    const result = await api<{ items: CallSummary[]; nextCursor?: string }>(`/api/admin/history?${query}`);
    setItems(result.items); setCursor(result.nextCursor);
  }, [query]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function more() {
    if (!cursor) return;
    const result = await api<{ items: CallSummary[]; nextCursor?: string }>(`/api/admin/history?${query}&cursor=${encodeURIComponent(cursor)}`);
    setItems((current) => [...current, ...result.items]); setCursor(result.nextCursor);
  }
  return (
    <section className="page">
      <header className="page-header"><div><h1>{t('history.title')}</h1><p>{t('history.subtitle')}</p></div><div className="export-actions"><a href={`/api/admin/history/export?${query}&format=jsonl`}>{t('history.exportJsonl')}</a><a href={`/api/admin/history/export?${query}&format=csv`}>{t('history.exportCsv')}</a></div></header>
      <HistoryFilter filters={filters} onChange={setFilters} />
      <div className="history-table">
        {items.length === 0 && <p>{t('history.empty')}</p>}
        {items.map((item) => <button key={item.callId} onClick={() => setSelected(item.callId)}><span className={`status-dot ${item.finalStatus ?? ''}`} /><div><strong>{item.toolName}</strong><small>{item.upstreamId} · {item.clientTokenId}</small></div><span className={`outcome ${item.policyOutcome ?? ''}`}>{item.policyOutcome}</span><time>{formatDate(item.lastSeenAt)}</time></button>)}
      </div>
      {cursor && <button className="load-more" onClick={() => void more()}>{t('history.loadMore')}</button>}
      {selected && <CallTimeline callId={selected} onClose={() => setSelected(undefined)} />}
    </section>
  );
}
