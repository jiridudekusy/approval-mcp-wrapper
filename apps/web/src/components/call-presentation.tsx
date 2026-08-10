import type { ReactNode } from 'react';

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
      return value === undefined ? placeholder : String(value);
    },
  );
}

function isEntity(
  value: unknown,
): value is { id: string; name: string | null; role?: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    (typeof value.name === 'string' || value.name === null)
  );
}

function valueView(value: unknown, unknownLabel: string): ReactNode {
  if (isEntity(value)) {
    return (
      <span className="entity-value">
        <strong>{value.name ?? unknownLabel}</strong>
        {value.role !== undefined && <small>{value.role}</small>}
        <code>{value.id}</code>
      </span>
    );
  }
  if (Array.isArray(value) && value.every(isEntity)) {
    return (
      <ul className="entity-list">
        {value.map((entity) => (
          <li key={entity.id}>{valueView(entity, unknownLabel)}</li>
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
    return <span className="presentation-value">{String(value)}</span>;
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
  return (
    <div className="plugin-presentation">
      {presentation.sections.map((section) => (
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
          <dl>
            {section.fields.map((item, index) => (
              <div key={`${item.label.key}-${index}`}>
                <dt>{localizedMessage(item.label, locale)}</dt>
                <dd>{valueView(item.value, t('approval.unknownEntity'))}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
