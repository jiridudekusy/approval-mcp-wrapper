import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client.js';
import { CallTimeline } from '../components/call-timeline.js';
import { HistoryFilter, type HistoryFilters } from '../components/history-filter.js';
import { Icon } from '../components/icon.js';
import { useI18n } from '../i18n/i18n.js';

interface CallSummary {
  callId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  tokenLabel?: string;
  upstreamAlias?: string;
  toolName: string;
  policyOutcome?: string;
  finalStatus?: 'abandoned' | 'denied' | 'error' | 'interrupted' | 'success' | 'timeout';
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
  const outcomeLabel = (outcome?: string) => outcome === 'allow' ? t('profiles.outcomeAllow') : outcome === 'deny' ? t('profiles.outcomeDeny') : outcome === 'require_approval' ? t('profiles.outcomeApproval') : '—';
  const statusView = (status?: CallSummary['finalStatus']) => {
    if (status === 'success') return { label: t('history.completed'), tone: 'completed' };
    if (status === 'denied') return { label: t('history.denied'), tone: 'denied' };
    if (status === 'error') return { label: t('history.failed'), tone: 'failed' };
    if (status === 'timeout') return { label: t('history.timeout'), tone: 'failed' };
    if (status === 'abandoned') return { label: t('history.abandoned'), tone: 'neutral' };
    if (status === 'interrupted') return { label: t('history.interrupted'), tone: 'neutral' };
    return { label: t('history.pending'), tone: 'pending' };
  };
  const hasFilters = filters.toolName !== '' || filters.finalStatus !== '';
  return (
    <section className="page">
      <header className="page-header">
        <div><h1>{t('history.title')}</h1><p>{t('history.subtitle')}</p></div>
        <div className="export-actions">
          <a href={`/api/admin/history/export?${query}&format=jsonl`}>{t('history.exportJsonl')}</a>
          <a href={`/api/admin/history/export?${query}&format=csv`}>{t('history.exportCsv')}</a>
        </div>
      </header>
      <HistoryFilter filters={filters} onChange={setFilters} />
      <div className="history-table">
        {items.length === 0 && (
          <div className="history-empty">
            <span className="empty-icon"><Icon name={hasFilters ? 'search' : 'arrow-history'} size={22} /></span>
            <h2>{hasFilters ? t('history.empty') : t('history.emptyDefault')}</h2>
            <p>{hasFilters ? t('history.emptyFilteredDetail') : t('history.emptyDefaultDetail')}</p>
          </div>
        )}
        {items.map((item) => { const status = statusView(item.finalStatus); return <button key={item.callId} onClick={() => setSelected(item.callId)}><span className={`status-dot ${status.tone}`} /><div><strong>{item.toolName}</strong><small>{t('approval.agent')}: {item.tokenLabel ?? t('common.unknownAgent')} · {t('approval.upstream')}: {item.upstreamAlias ?? t('common.unknownUpstream')}</small></div><span className={`outcome ${item.policyOutcome ?? ''}`}>{outcomeLabel(item.policyOutcome)}</span><span className="history-status">{status.label}</span><time>{formatDate(item.lastSeenAt)}</time></button>; })}
      </div>
      {cursor && <button className="load-more" onClick={() => void more()}>{t('history.loadMore')}</button>}
      {selected && <CallTimeline callId={selected} onClose={() => setSelected(undefined)} />}
    </section>
  );
}
