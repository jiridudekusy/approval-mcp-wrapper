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
      <label>{t('history.status')}<select value={filters.finalStatus} onChange={(event) => onChange({ ...filters, finalStatus: event.target.value })}><option value="">{t('history.all')}</option><option value="success">success</option><option value="denied">denied</option><option value="error">error</option><option value="timeout">timeout</option><option value="abandoned">abandoned</option></select></label>
    </div>
  );
}
