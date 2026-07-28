import { useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';

export function UpstreamForm({
  csrfToken,
  onCreated,
}: {
  csrfToken: string;
  onCreated(upstream: { id: string }): void;
}) {
  const { t } = useI18n();
  const [alias, setAlias] = useState('');
  const [url, setUrl] = useState('');
  const [authorization, setAuthorization] = useState('');
  const [privateNetwork, setPrivateNetwork] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const upstream = await api<{ id: string }>(
      '/api/admin/upstreams',
      {
        method: 'POST',
        body: JSON.stringify({
          alias,
          url,
          allowPrivateNetwork: privateNetwork,
          ...(authorization === ''
            ? {}
            : { credentials: { authorization } }),
        }),
      },
      csrfToken,
    );
    onCreated(upstream);
  }

  return (
    <form className="admin-form" onSubmit={(event) => void submit(event)}>
      <label>{t('upstreams.alias')}<input required pattern="[a-z0-9_-]+" value={alias} onChange={(event) => setAlias(event.target.value)} /></label>
      <label>{t('upstreams.url')}<input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <label>{t('upstreams.credentials')}<input type="password" autoComplete="off" value={authorization} onChange={(event) => setAuthorization(event.target.value)} /></label>
      <label className="check-row"><input type="checkbox" checked={privateNetwork} onChange={(event) => setPrivateNetwork(event.target.checked)} />{t('upstreams.private')}</label>
      {privateNetwork && <p className="warning">{t('upstreams.privateWarning')}</p>}
      <button className="primary" type="submit">{t('common.add')}</button>
    </form>
  );
}
