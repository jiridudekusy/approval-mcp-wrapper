import { useI18n } from '../i18n/i18n.js';

export function Inbox() {
  const { t } = useI18n();
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">LIVE QUEUE</p>
          <h1>{t('inbox.title')}</h1>
          <p>{t('inbox.subtitle')}</p>
        </div>
        <span className="live-pill"><i /> LIVE</span>
      </header>
      <div className="empty-state">
        <div className="radar" aria-hidden="true"><span>✓</span></div>
        <h2>{t('inbox.empty')}</h2>
        <p>{t('inbox.emptyDetail')}</p>
      </div>
    </section>
  );
}
