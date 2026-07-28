import { useI18n } from '../i18n/i18n.js';

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="language-switch" aria-label={t('language.label')}>
      <button
        type="button"
        className={locale === 'en' ? 'active' : ''}
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
      >
        EN
      </button>
      <button
        type="button"
        className={locale === 'cs' ? 'active' : ''}
        onClick={() => setLocale('cs')}
        aria-pressed={locale === 'cs'}
      >
        CZ
      </button>
    </div>
  );
}
