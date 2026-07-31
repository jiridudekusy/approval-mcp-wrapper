import { useI18n } from '../i18n/i18n.js';

export interface HistoryFilters {
  toolName: string;
  finalStatus: string;
}

export function HistoryFilter({
  filters,
  onChange,
}: {
  filters: HistoryFilters;
  onChange(filters: HistoryFilters): void;
}) {
  const { t } = useI18n();
  return (
    <div className="history-filter">
      <label>{t('history.search')}<input value={filters.toolName} onChange={(event) => onChange({ ...filters, toolName: event.target.value })} /></label>
      <label>{t('history.status')}<select value={filters.finalStatus} onChange={(event) => onChange({ ...filters, finalStatus: event.target.value })}><option value="">{t('history.all')}</option><option value="success">{t('history.completed')}</option><option value="denied">{t('history.denied')}</option><option value="error">{t('history.failed')}</option><option value="timeout">{t('history.timeout')}</option><option value="abandoned">{t('history.abandoned')}</option></select></label>
    </div>
  );
}
