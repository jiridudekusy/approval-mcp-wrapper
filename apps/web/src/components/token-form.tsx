import { useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';

export function TokenForm({
  csrfToken,
  onCreated,
  onCancel,
}: {
  csrfToken: string;
  onCreated(plaintext: string): void;
  onCancel?(): void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await api<{ plaintext: string }>(
      '/api/admin/tokens',
      { method: 'POST', body: JSON.stringify({ label }) },
      csrfToken,
    );
    setLabel('');
    onCreated(result.plaintext);
  }
  return (
    <form className="token-form" onSubmit={(event) => void submit(event)}>
      <h2>{t('access.newToken')}</h2>
      <label>{t('access.tokenLabel')}<input autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <p>{t('access.tokenHint')}</p>
      <div className="modal-actions">{onCancel && <button type="button" onClick={onCancel}>{t('common.cancel')}</button>}<button className="primary compact" type="submit" disabled={label.trim() === ''}>{t('access.createToken')}</button></div>
    </form>
  );
}
