import { useEffect, useState } from 'react';
import { ApprovalCard } from '../components/approval-card.js';
import { ApprovalDetail } from '../components/approval-detail.js';
import type { ApprovalViewModel } from '../components/approval-view-model.js';
import { useApprovalEvents } from '../hooks/use-approval-events.js';
import { useI18n } from '../i18n/i18n.js';
import { Icon } from '../components/icon.js';

export function Inbox({
  csrfToken,
  targetApprovalId,
  onOpenApproval,
  onCloseApproval,
}: {
  csrfToken: string;
  targetApprovalId?: string;
  onOpenApproval(approvalId: string): void;
  onCloseApproval(): void;
}) {
  const { t } = useI18n();
  const { approvals, connected, refresh } = useApprovalEvents();
  const [selected, setSelected] = useState<ApprovalViewModel>();
  const [toast, setToast] = useState(false);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(false), 3_200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (targetApprovalId === undefined) {
      setSelected(undefined);
      return;
    }
    const match = approvals.find((approval) => approval.id === targetApprovalId);
    if (match === undefined) return;
    setSelected(match);
  }, [approvals, targetApprovalId]);
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t('inbox.title')}</h1>
          <p>{t('inbox.subtitle')}</p>
        </div>
        <span className={`live-pill${connected ? '' : ' reconnecting'}`}><i />{connected ? t('status.live') : t('status.reconnecting')}</span>
      </header>
      {approvals.length === 0 ? (
        <div className="empty-state">
          <div className="radar" aria-hidden="true"><span><Icon name="check-circle" size={28} /></span></div>
          <h2>{t('inbox.empty')}</h2>
          <p>{t('inbox.emptyDetail')}</p>
        </div>
      ) : (
        <div className="approval-grid">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onOpen={() => {
                setSelected(approval);
                onOpenApproval(approval.id);
              }}
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
            onDecided={() => setToast(true)}
            onClosed={() => {
              setSelected(undefined);
              onCloseApproval();
              void refresh();
            }}
          />
        </div>
      )}
      {toast && <div className="toast" role="status"><Icon name="check-circle" />{t('approval.saved')}</div>}
    </section>
  );
}
