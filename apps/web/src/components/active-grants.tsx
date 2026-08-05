import { useState } from 'react';
import { useI18n } from '../i18n/i18n.js';
import { Icon } from './icon.js';

export interface GrantView {
  id: string;
  clientTokenId: string;
  tokenLabel?: string;
  upstreamId: string;
  upstreamAlias?: string;
  toolName: string;
  predicates: readonly unknown[];
  scope: 'forever' | 'until';
  createdAt: string;
  expiresAt?: string;
  version: number;
}

export function ActiveGrants({
  grants,
  revokingId,
  onRevoke,
}: {
  grants: readonly GrantView[];
  revokingId: string | undefined;
  onRevoke(grant: GrantView): void;
}) {
  const { t, formatDate } = useI18n();
  const [confirmingId, setConfirmingId] = useState<string>();
  if (grants.length === 0) {
    return <div className="empty-panel">{t('access.noActiveGrants')}</div>;
  }
  return (
    <div className="grant-list">
      {grants.map((grant) => (
        <article key={grant.id}>
          <div className="grant-main">
            <code>{grant.toolName}</code>
            <span>{grant.tokenLabel ?? t('common.unknownAgent')} → {grant.upstreamAlias ?? t('common.unknownUpstream')}</span>
          </div>
          <dl>
            <div>
              <dt>{t('access.scope')}</dt>
              <dd>{grant.expiresAt === undefined ? <span className="grant-scope permanent"><Icon name="infinity" />{t('access.forever')}</span> : <span className="grant-scope expiring"><Icon name="clock" />{t('access.validUntil')} {formatDate(grant.expiresAt)}</span>}</dd>
            </div>
            {grant.predicates.length > 0 && (
              <div>
                <dt>{t('access.conditions')}</dt>
                <dd><code>{JSON.stringify(grant.predicates)}</code></dd>
              </div>
            )}
          </dl>
          {confirmingId === grant.id ? <div className="revoke-confirm"><button type="button" onClick={() => setConfirmingId(undefined)}>{t('common.cancel')}</button><button className="danger-button" type="button" disabled={revokingId === grant.id} onClick={() => onRevoke(grant)}>{revokingId === grant.id ? t('access.revoking') : t('access.revokeNow')}</button></div> : <button className="danger-link" type="button" disabled={revokingId === grant.id} onClick={() => setConfirmingId(grant.id)}>{t('access.revoke')}</button>}
        </article>
      ))}
    </div>
  );
}
