import { useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import {
  metadataRecord,
  UpstreamMetadataEditor,
  type UpstreamMetadataRow,
} from './upstream-metadata-editor.js';

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
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [metadata, setMetadata] = useState<UpstreamMetadataRow[]>([]);
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
          ...(displayName.trim() === '' ? {} : { displayName }),
          ...(description.trim() === '' ? {} : { description }),
          ...(metadata.length === 0 ? {} : { metadata: metadataRecord(metadata) }),
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
          <span>{t('upstreams.displayName')}</span>
          <input maxLength={120} placeholder={t('upstreams.displayNamePlaceholder')} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <small>{t('upstreams.displayNameHint')}</small>
        </label>
        <label className="field">
          <span>{t('upstreams.alias')}</span>
          <input required pattern="[a-z0-9_-]+" value={alias} onChange={(event) => setAlias(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>{t('upstreams.url')}</span>
          <input required type="url" placeholder="https://mcp.example.com/mcp" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>{t('upstreams.description')}</span>
          <textarea maxLength={1000} rows={3} placeholder={t('upstreams.descriptionPlaceholder')} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <UpstreamMetadataEditor rows={metadata} onChange={setMetadata} />
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
