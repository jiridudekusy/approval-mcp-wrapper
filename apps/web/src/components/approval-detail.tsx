import { useState } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import type { ApprovalViewModel } from './approval-view-model.js';
import { GrantScopeForm } from './grant-scope-form.js';
import type { Predicate } from './types.js';

export function ApprovalDetail({
  approval,
  csrfToken,
  connected,
  onClosed,
}: {
  approval: ApprovalViewModel;
  csrfToken: string;
  connected: boolean;
  onClosed(): void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [predicate, setPredicate] = useState<Predicate>({
    path: '',
    operator: 'exists',
  });

  async function decide(
    decision:
      | { action: 'deny' }
      | { action: 'allow_once' }
      | { action: 'allow_until'; expiresAt: string; predicate: Predicate }
      | { action: 'allow_forever'; predicate: Predicate },
  ) {
    setBusy(true);
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
      onClosed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="approval-detail" aria-labelledby="approval-title">
      <header>
        <div>
          <p className="eyebrow">{t('approval.pending')}</p>
          <h2 id="approval-title">{approval.toolName}</h2>
        </div>
        <button type="button" className="close" onClick={onClosed} aria-label="Close">×</button>
      </header>
      {!connected && <p className="connection-warning">{t('approval.disconnected')}</p>}
      <dl className="approval-meta">
        <div><dt>{t('approval.token')}</dt><dd>{approval.tokenId}</dd></div>
        <div><dt>{t('approval.upstream')}</dt><dd>{approval.upstreamId}</dd></div>
        <div><dt>{t('approval.tool')}</dt><dd>{approval.toolName}</dd></div>
      </dl>
      <h3>{t('approval.arguments')}</h3>
      <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
      <GrantScopeForm predicate={predicate} onChange={setPredicate} />
      <label className="confirm">
        <input
          type="checkbox"
          checked={permanent}
          onChange={(event) => setPermanent(event.target.checked)}
        />
        {t('approval.confirmForever')}
      </label>
      <p className="permanent-note">{t('approval.foreverWarning')}</p>
      <div className="decision-actions">
        <button
          type="button"
          className="danger"
          disabled={!connected || busy}
          onClick={() => void decide({ action: 'deny' })}
        >
          {t('approval.deny')}
        </button>
        <button
          type="button"
          disabled={!connected || busy}
          onClick={() => void decide({ action: 'allow_once' })}
        >
          {t('approval.allowOnce')}
        </button>
        <button
          type="button"
          disabled={!connected || busy}
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
          disabled={!connected || busy || !permanent}
          onClick={() => void decide({ action: 'allow_forever', predicate })}
        >
          {busy ? t('approval.deciding') : t('approval.allowForever')}
        </button>
      </div>
    </section>
  );
}
