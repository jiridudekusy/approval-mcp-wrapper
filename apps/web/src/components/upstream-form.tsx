import { useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';

export function UpstreamForm({
  csrfToken,
  plugins,
  onCreated,
  onCancel,
}: {
  csrfToken: string;
  plugins: readonly Readonly<{ id: string; version: string }>[];
  onCreated(upstream: { id: string }): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const [alias, setAlias] = useState('');
  const [url, setUrl] = useState('');
  const [authorization, setAuthorization] = useState('');
  const [privateNetwork, setPrivateNetwork] = useState(false);
  const [pluginPin, setPluginPin] = useState('');

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
          ...(pluginPin === ''
            ? {}
            : {
                pluginId: pluginPin.slice(0, pluginPin.lastIndexOf('@')),
                pluginVersion: pluginPin.slice(pluginPin.lastIndexOf('@') + 1),
              }),
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
      <div className="form-heading">
        <div>
          <h2>{t('upstreams.addTitle')}</h2>
          <p>{t('upstreams.addDetail')}</p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>{t('upstreams.alias')}</span>
          <input required pattern="[a-z0-9_-]+" value={alias} onChange={(event) => setAlias(event.target.value)} />
        </label>
        <label className="field">
          <span>{t('upstreams.url')}</span>
          <input required type="url" placeholder="https://mcp.example.com/mcp" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>{t('upstreams.credentials')}</span>
          <input type="password" autoComplete="off" value={authorization} onChange={(event) => setAuthorization(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>{t('upstreams.plugin')}</span>
          <select value={pluginPin} onChange={(event) => setPluginPin(event.target.value)}>
            <option value="">{t('upstreams.noPlugin')}</option>
            {plugins.map((plugin) => (
              <option key={`${plugin.id}@${plugin.version}`} value={`${plugin.id}@${plugin.version}`}>
                {plugin.id} · {plugin.version}
              </option>
            ))}
          </select>
          <small>{t('upstreams.pluginHint')}</small>
        </label>
      </div>
      <div className="form-options">
        <label className="check-row">
          <input type="checkbox" checked={privateNetwork} onChange={(event) => setPrivateNetwork(event.target.checked)} />
          <span><strong>{t('upstreams.private')}</strong><small>{t('upstreams.privateHint')}</small></span>
        </label>
        {privateNetwork && <p className="warning" role="note">{t('upstreams.privateWarning')}</p>}
      </div>
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="primary" type="submit">{t('common.add')}</button>
      </div>
    </form>
  );
}
