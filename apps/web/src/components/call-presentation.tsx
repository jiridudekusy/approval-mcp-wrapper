import type { ReactNode } from 'react';

import { formatIsoDateTime } from '../i18n/date-time.js';
import { useI18n, type Locale } from '../i18n/i18n.js';

export interface LocalizedMessageView {
  key: string;
  params?: Readonly<Record<string, boolean | null | number | string>>;
  fallback: { en: string; cs?: string };
}

export interface ProposedScopeView {
  id: string;
  label: LocalizedMessageView;
  predicates: readonly unknown[];
  durations?: readonly ('forever' | 'hour')[];
}

export interface CallPresentationView {
  source: 'generic' | 'plugin';
  pluginId?: string;
  pluginVersion?: string;
  title: LocalizedMessageView;
  sections: readonly Readonly<{
    id: string;
    heading: LocalizedMessageView;
    fields: readonly Readonly<{
      label: LocalizedMessageView;
      value: unknown;
    }>[];
    risk?: 'danger' | 'info' | 'warning';
  }>[];
  proposedScopes: readonly ProposedScopeView[];
}

export function localizedMessage(
  message: LocalizedMessageView,
  locale: Locale,
): string {
  const template =
    locale === 'cs'
      ? (message.fallback.cs ?? message.fallback.en)
      : message.fallback.en;
  return template.replaceAll(
    /\{([A-Za-z0-9_.-]+)\}/g,
    (placeholder, key: string) => {
      const value = message.params?.[key];
      return value === undefined ? placeholder :
        typeof value === 'string' ? formatIsoDateTime(value, locale) ?? value : String(value);
    },
  );
}

function isEntity(
  value: unknown,
): value is { id: string | number; name: string | null; role?: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    (typeof value.id === 'string' || typeof value.id === 'number') &&
    'name' in value &&
    (typeof value.name === 'string' || value.name === null)
  );
}

function valueView(value: unknown, locale: Locale, unknownLabel: string, unverifiedLabel: string): ReactNode {
  if (isEntity(value)) {
    return (
      <span className={`entity-value${typeof value.id === 'number' ? ' numeric' : ''}`}>
        <strong>{value.name ?? (typeof value.id === 'number' ? unverifiedLabel : unknownLabel)}</strong>
        {value.role !== undefined && <small>{value.role}</small>}
        <code>{typeof value.id === 'number' ? `ID ${value.id}` : value.id}</code>
      </span>
    );
  }
  if (Array.isArray(value) && value.every(isEntity)) {
    return (
      <ul className="entity-list">
        {value.map((entity) => (
          <li key={entity.id}>{valueView(entity, locale, unknownLabel, unverifiedLabel)}</li>
        ))}
      </ul>
    );
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    const display = typeof value === 'string' ? formatIsoDateTime(value, locale) ?? value
      : typeof value === 'boolean' ? (locale === 'cs' ? value ? 'Ano' : 'Ne' : value ? 'Yes' : 'No')
        : String(value);
    return <span className="presentation-value">{display}</span>;
  }
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

export function CallPresentation({
  presentation,
}: {
  presentation: CallPresentationView;
}) {
  const { locale, t } = useI18n();
  const riskLabels = {
    danger: 'approval.risk.danger',
    info: 'approval.risk.info',
    warning: 'approval.risk.warning',
  } as const;
  const renderFields = (section: CallPresentationView['sections'][number]) => (
    <dl>
      {section.fields.map((item, index) => (
        <div key={`${item.label.key}-${index}`}>
          <dt>{localizedMessage(item.label, locale)}</dt>
          <dd>{item.label.key === 'krkonoskewellness.field.confirm' && typeof item.value === 'boolean'
            ? t(item.value ? 'approval.bindingBooking' : 'approval.previewBooking')
            : item.label.key === 'imcp.field.event' && item.value === null
              ? t('approval.eventUnverified')
              : item.label.key === 'imcp.field.occurrence_status'
                ? t('approval.occurrenceUnspecified')
              : item.label.key === 'imcp.field.deletion_scope'
                ? t(item.value === 'futureEvents' ? 'approval.deleteFutureEvents' : 'approval.deleteThisEvent')
                : item.label.key === 'imcp.field.identifier' && typeof item.value === 'string' && item.value.length > 24
                  ? <details className="event-identifier"><summary>{item.value.slice(0, 8)}…{item.value.slice(-8)} · {t('approval.showFullIdentifier')}</summary><code>{item.value}</code></details>
            : valueView(item.value, locale, t('approval.unknownEntity'), t('approval.nameUnverified'))}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="plugin-presentation">
      {presentation.sections.map((section) => section.id === 'technical' ? (
        <details className="plugin-section technical" key={section.id}>
          <summary>{t('approval.showTechnicalArguments')}</summary>
          {renderFields(section)}
        </details>
      ) : (
        <section
          className={`plugin-section ${section.risk ?? 'info'}`}
          key={section.id}
        >
          <header>
            <h3>{localizedMessage(section.heading, locale)}</h3>
            {section.risk !== undefined && (
              <span className={`risk-badge ${section.risk}`}>
                {t(riskLabels[section.risk])}
              </span>
            )}
          </header>
          {renderFields(section)}
        </section>
      ))}
    </div>
  );
}
