import { useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';

export function TokenForm({
  csrfToken,
  onCreated,
}: {
  csrfToken: string;
  onCreated(plaintext: string): void;
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
    <form className="inline-form" onSubmit={(event) => void submit(event)}>
      <label>{t('access.tokenLabel')}<input required value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <button className="primary compact" type="submit">{t('access.newToken')}</button>
    </form>
  );
}
