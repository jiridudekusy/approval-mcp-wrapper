import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import type { ApprovalViewModel } from './approval-view-model.js';
import { GrantScopeForm } from './grant-scope-form.js';
import type { Predicate } from './types.js';
import { Icon } from './icon.js';

export function ApprovalDetail({
  approval,
  csrfToken,
  connected,
  onClosed,
  onDecided,
}: {
  approval: ApprovalViewModel;
  csrfToken: string;
  connected: boolean;
  onClosed(): void;
  onDecided?(): void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [predicate, setPredicate] = useState<Predicate>({
    path: '',
    operator: 'exists',
  });
  const [error, setError] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClosed();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const controls = [...panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
      if (controls.length === 0) return;
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [onClosed]);

  async function decide(
    decision:
      | { action: 'deny' }
      | { action: 'allow_once' }
      | { action: 'allow_until'; expiresAt: string; predicate: Predicate }
      | { action: 'allow_forever'; predicate: Predicate },
  ) {
    setBusy(true);
    setError(false);
    try {
      await api(
        `/api/admin/approvals/${encodeURIComponent(approval.id)}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            requestHash: approval.requestHash,
            decision,
          }),
        },
        csrfToken,
      );
      onDecided?.();
      onClosed();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section ref={panelRef} className="approval-detail" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <header>
        <div>
          <p className="eyebrow">{t('approval.pending')}</p>
          <h2 id="approval-title">{approval.toolName}</h2>
        </div>
        <button type="button" className="close icon-button" onClick={onClosed} aria-label={t('common.close')}><Icon name="close" /></button>
      </header>
      {!connected && <p className="connection-warning">{t('approval.disconnected')}</p>}
      <dl className="approval-meta">
        <div><dt>{t('approval.agent')}</dt><dd>{approval.agentName ?? t('common.unknownAgent')}</dd></div>
        <div><dt>{t('approval.upstream')}</dt><dd>{approval.upstreamName ?? t('common.unknownUpstream')}</dd></div>
        <div><dt>{t('approval.received')}</dt><dd>{new Date(approval.createdAt).toLocaleString()}</dd></div>
      </dl>
      <h3>{t('approval.arguments')}</h3>
      <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
      <button className="condition-toggle" type="button" aria-expanded={conditionOpen} onClick={() => setConditionOpen((value) => !value)}><Icon name={conditionOpen ? 'chevron-down' : 'chevron-right'} />{t('approval.addCondition')}</button>
      {conditionOpen && <GrantScopeForm predicate={predicate} onChange={setPredicate} />}
      <label className="confirm">
        <input
          type="checkbox"
          checked={permanent}
          onChange={(event) => setPermanent(event.target.checked)}
        />
        {t('approval.confirmForever')}
      </label>
      <p className="permanent-note">{t('approval.foreverWarning')}</p>
      {error && <p className="error-inline" role="alert">{t('approval.failed')}</p>}
      <div className="decision-actions">
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void decide({ action: 'deny' })}
        >
          {t('approval.deny')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide({ action: 'allow_once' })}
        >
          {t('approval.allowOnce')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void decide({
              action: 'allow_until',
              expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
              predicate,
            })
          }
        >
          {t('approval.allowHour')}
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !permanent}
          onClick={() => void decide({ action: 'allow_forever', predicate })}
        >
          {busy ? t('approval.deciding') : t('approval.allowForever')}
        </button>
      </div>
    </section>
  );
}
