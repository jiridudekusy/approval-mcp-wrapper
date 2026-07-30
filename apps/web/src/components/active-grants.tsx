import { useI18n } from '../i18n/i18n.js';

export interface GrantView {
  id: string;
  clientTokenId: string;
  tokenLabel: string;
  upstreamId: string;
  upstreamAlias: string;
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
  if (grants.length === 0) {
    return <p className="catalog-empty">{t('access.noActiveGrants')}</p>;
  }
  return (
    <div className="grant-list">
      {grants.map((grant) => (
        <article key={grant.id}>
          <div className="grant-main">
            <code>{grant.toolName}</code>
            <span>{grant.tokenLabel} → {grant.upstreamAlias}</span>
          </div>
          <dl>
            <div>
              <dt>{t('access.scope')}</dt>
              <dd>
                {grant.expiresAt === undefined
                  ? t('access.forever')
                  : `${t('access.validUntil')} ${formatDate(grant.expiresAt)}`}
              </dd>
            </div>
            {grant.predicates.length > 0 && (
              <div>
                <dt>{t('access.conditions')}</dt>
                <dd><code>{JSON.stringify(grant.predicates)}</code></dd>
              </div>
            )}
          </dl>
          <button
            className="danger-link"
            type="button"
            disabled={revokingId === grant.id}
            onClick={() => onRevoke(grant)}
          >
            {revokingId === grant.id
              ? t('access.revoking')
              : t('access.revoke')}
          </button>
        </article>
      ))}
    </div>
  );
}
