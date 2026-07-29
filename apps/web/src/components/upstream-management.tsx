import { useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';

export interface ManagedUpstream {
  id: string;
  alias: string;
  url: string;
  allowPrivateNetwork: boolean;
  credentialsConfigured: boolean;
  version: number;
}

export interface DeletionImpact {
  policies: number;
  grants: number;
}

export function UpstreamEditForm({
  upstream,
  csrfToken,
  onSaved,
  onCancel,
}: {
  upstream: ManagedUpstream;
  csrfToken: string;
  onSaved(upstream: ManagedUpstream): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const [alias, setAlias] = useState(upstream.alias);
  const [url, setUrl] = useState(upstream.url);
  const [privateNetwork, setPrivateNetwork] = useState(
    upstream.allowPrivateNetwork,
  );
  const [authorization, setAuthorization] = useState('');
  const [removeCredential, setRemoveCredential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const updated = await api<ManagedUpstream>(
        `/api/admin/upstreams/${upstream.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            version: upstream.version,
            alias,
            url,
            allowPrivateNetwork: privateNetwork,
            ...(removeCredential
              ? { credentials: null }
              : authorization === ''
                ? {}
                : { credentials: { authorization } }),
          }),
        },
        csrfToken,
      );
      onSaved(updated);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="upstream-edit-form"
      onSubmit={(event) => void submit(event)}
    >
      <label>
        {t('upstreams.alias')}
        <input
          required
          pattern="[a-z0-9_-]+"
          value={alias}
          onChange={(event) => setAlias(event.target.value)}
        />
      </label>
      <label>
        {t('upstreams.url')}
        <input
          required
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <label>
        {t('upstreams.replaceCredential')}
        <input
          type="password"
          autoComplete="off"
          disabled={removeCredential}
          value={authorization}
          onChange={(event) => setAuthorization(event.target.value)}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={privateNetwork}
          onChange={(event) => setPrivateNetwork(event.target.checked)}
        />
        {t('upstreams.private')}
      </label>
      {upstream.credentialsConfigured && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={removeCredential}
            onChange={(event) => setRemoveCredential(event.target.checked)}
          />
          {t('upstreams.removeCredential')}
        </label>
      )}
      {error && <p className="catalog-error">{t('upstreams.saveFailed')}</p>}
      <div className="management-actions">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="primary compact" type="submit" disabled={busy}>
          {busy ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </form>
  );
}

export function UpstreamDeleteConfirmation({
  alias,
  impact,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  alias: string;
  impact: DeletionImpact;
  busy: boolean;
  error?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { t, formatNumber } = useI18n();
  return (
    <div className="delete-confirmation" role="alertdialog">
      <strong>{t('upstreams.deleteTitle')}</strong>
      <p>{t('upstreams.deleteWarning')} <code>{alias}</code></p>
      <dl>
        <div><dt>{t('upstreams.affectedPolicies')}</dt><dd>{formatNumber(impact.policies)}</dd></div>
        <div><dt>{t('upstreams.affectedGrants')}</dt><dd>{formatNumber(impact.grants)}</dd></div>
      </dl>
      {error === true && (
        <p className="catalog-error">{t('upstreams.deleteFailed')}</p>
      )}
      <div className="management-actions">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="danger-button"
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? t('common.loading') : t('upstreams.confirmDelete')}
        </button>
      </div>
    </div>
  );
}
