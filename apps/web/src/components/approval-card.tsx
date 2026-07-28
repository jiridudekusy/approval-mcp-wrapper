import type { ApprovalViewModel } from './approval-view-model.js';
import { useI18n } from '../i18n/i18n.js';

export function ApprovalCard({
  approval,
  onOpen,
}: {
  approval: ApprovalViewModel;
  onOpen(): void;
}) {
  const { formatDate, t } = useI18n();
  return (
    <button className="approval-card" type="button" onClick={onOpen}>
      <div>
        <span className="pending-dot" />
        <small>{t('approval.pending')}</small>
      </div>
      <h2>{approval.toolName}</h2>
      <dl>
        <div><dt>{t('approval.upstream')}</dt><dd>{approval.upstreamId}</dd></div>
        <div><dt>{t('approval.token')}</dt><dd>{approval.tokenId}</dd></div>
      </dl>
      <time>{formatDate(approval.createdAt)}</time>
    </button>
  );
}
