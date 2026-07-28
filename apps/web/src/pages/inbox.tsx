import { useState } from 'react';
import { ApprovalCard } from '../components/approval-card.js';
import { ApprovalDetail } from '../components/approval-detail.js';
import type { ApprovalViewModel } from '../components/approval-view-model.js';
import { useApprovalEvents } from '../hooks/use-approval-events.js';
import { useI18n } from '../i18n/i18n.js';

export function Inbox({ csrfToken }: { csrfToken: string }) {
  const { t } = useI18n();
  const { approvals, connected, refresh } = useApprovalEvents();
  const [selected, setSelected] = useState<ApprovalViewModel>();
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">LIVE QUEUE</p>
          <h1>{t('inbox.title')}</h1>
          <p>{t('inbox.subtitle')}</p>
        </div>
        <span className="live-pill"><i /> LIVE</span>
      </header>
      {approvals.length === 0 ? (
        <div className="empty-state">
          <div className="radar" aria-hidden="true"><span>✓</span></div>
          <h2>{t('inbox.empty')}</h2>
          <p>{t('inbox.emptyDetail')}</p>
        </div>
      ) : (
        <div className="approval-grid">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onOpen={() => setSelected(approval)}
            />
          ))}
        </div>
      )}
      {selected !== undefined && (
        <div className="detail-backdrop">
          <ApprovalDetail
            approval={selected}
            csrfToken={csrfToken}
            connected={connected}
            onClosed={() => {
              setSelected(undefined);
              void refresh();
            }}
          />
        </div>
      )}
    </section>
  );
}
