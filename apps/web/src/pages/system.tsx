import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import { Icon } from '../components/icon.js';

export function System() {
  const { t, formatNumber } = useI18n();
  const [system, setSystem] = useState<{ status: 'ok'; runtime: string; uptimeSeconds: number }>();
  useEffect(() => { void api<typeof system>('/api/admin/system').then(setSystem); }, []);
  return (
    <section className="page">
      <header className="page-header"><div><h1>{t('system.title')}</h1><p>{t('system.subtitle')}</p></div></header>
      <div className="health-card"><span className="health-ring"><Icon name="check-circle" size={24} /></span><div><h2>{t('system.healthy')}</h2><p>{t('system.runtime')}: <code>{system?.runtime ?? '—'}</code> · {t('system.uptime')}: {system ? formatNumber(system.uptimeSeconds) : '—'} s</p></div></div>
    </section>
  );
}
