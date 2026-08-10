import type { ApprovalViewModel } from './approval-view-model.js';
import { useI18n } from '../i18n/i18n.js';
import { localizedMessage } from './call-presentation.js';

export function ApprovalCard({
  approval,
  onOpen,
}: {
  approval: ApprovalViewModel;
  onOpen(): void;
}) {
  const { formatDate, locale, t } = useI18n();
  return (
    <button className="approval-card" type="button" onClick={onOpen}>
      <div>
        <span className="pending-dot" />
        <small>{t('approval.pending')}</small>
      </div>
      <h2>{approval.presentation === undefined ? approval.toolName : localizedMessage(approval.presentation.title, locale)}</h2>
      <dl>
        <div><dt>{t('approval.agent')}</dt><dd>{approval.agentName ?? t('common.unknownAgent')}</dd></div>
        <div><dt>{t('approval.upstream')}</dt><dd>{approval.upstreamName ?? t('common.unknownUpstream')}</dd></div>
      </dl>
      <time>{formatDate(approval.createdAt)}</time>
    </button>
  );
}
