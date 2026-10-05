import { Icon } from './icon.js';
import { useI18n } from '../i18n/i18n.js';

export interface UpstreamMetadataRow {
  key: string;
  value: string;
}

export function metadataRows(
  metadata: Readonly<Record<string, string>> | undefined,
): UpstreamMetadataRow[] {
  return Object.entries(metadata ?? {}).map(([key, value]) => ({ key, value }));
}

export function metadataRecord(
  rows: readonly UpstreamMetadataRow[],
): Record<string, string> {
  return Object.fromEntries(
    rows.map((row) => [row.key.trim(), row.value.trim()]),
  );
}

export function UpstreamMetadataEditor({
  rows,
  onChange,
}: {
  rows: readonly UpstreamMetadataRow[];
  onChange(rows: UpstreamMetadataRow[]): void;
}) {
  const { t } = useI18n();
  const update = (
    index: number,
    field: keyof UpstreamMetadataRow,
    value: string,
  ) => onChange(rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, [field]: value } : row,
  ));

  return (
    <fieldset className="metadata-editor field-wide">
      <legend>{t('upstreams.metadata')}</legend>
      <p>{t('upstreams.metadataHint')}</p>
      {rows.map((row, index) => (
        <div className="metadata-row" key={index}>
          <label>
            <span>{t('upstreams.metadataKey')}</span>
            <input
              required
              maxLength={64}
              pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*"
              value={row.key}
              onChange={(event) => update(index, 'key', event.target.value)}
            />
          </label>
          <label>
            <span>{t('upstreams.metadataValue')}</span>
            <input
              required
              maxLength={500}
              value={row.value}
              onChange={(event) => update(index, 'value', event.target.value)}
            />
          </label>
          <button
            className="icon-button"
            type="button"
            aria-label={t('upstreams.removeMetadata')}
            onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      {rows.length < 20 && (
        <button
          className="secondary-button metadata-add"
          type="button"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
        >
          <Icon name="plus-circle" />
          {t('upstreams.addMetadata')}
        </button>
      )}
    </fieldset>
  );
}
