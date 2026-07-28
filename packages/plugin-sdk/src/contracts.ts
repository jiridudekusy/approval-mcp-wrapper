import type { JsonPrimitive, JsonValue, Predicate } from '@approval-mcp/contracts';

export type SupportedLocale = 'cs' | 'en';

export interface LocalizedMessage {
  key: string;
  params?: Readonly<Record<string, JsonPrimitive>>;
  fallback: {
    en: string;
    cs?: string;
  };
}

export interface ApprovalField {
  label: LocalizedMessage;
  value: JsonValue;
}

export interface ApprovalSection {
  id: string;
  heading: LocalizedMessage;
  fields: readonly ApprovalField[];
  risk?: 'danger' | 'info' | 'warning';
}

export interface ProposedGrantScope {
  id: string;
  label: LocalizedMessage;
  predicates: readonly Predicate[];
}

export interface PluginCallInput {
  upstreamAlias: string;
  toolName: string;
  toolDescription?: string;
  arguments: JsonValue;
}

export interface PluginCallDescription {
  source: 'generic' | 'plugin';
  reasonCode?: string;
  normalizedContext: Readonly<Record<string, JsonValue>>;
  sensitivePaths: readonly string[];
  title: LocalizedMessage;
  sections: readonly ApprovalSection[];
  proposedScopes: readonly ProposedGrantScope[];
}

export interface ApprovalPlugin {
  readonly id: string;
  readonly version: string;
  readonly normalizationVersion: number;
  describe(input: PluginCallInput): Promise<PluginCallDescription>;
}

function format(template: string, params: Readonly<Record<string, JsonPrimitive>>): string {
  return template.replaceAll(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, key: string) => {
    const value = params[key];
    return value === undefined ? placeholder : String(value);
  });
}

export function resolveLocalizedMessage(
  message: LocalizedMessage,
  locale: SupportedLocale,
): string {
  const template = locale === 'cs' ? (message.fallback.cs ?? message.fallback.en) : message.fallback.en;
  return format(template, message.params ?? {});
}
