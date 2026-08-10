import type { JsonPrimitive, JsonValue, Predicate } from './entities.js';

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
  durations?: readonly ('forever' | 'hour')[];
}

export interface CallPresentation {
  source: 'generic' | 'plugin';
  reasonCode?: string;
  pluginId?: string;
  pluginVersion?: string;
  title: LocalizedMessage;
  sections: readonly ApprovalSection[];
  proposedScopes: readonly ProposedGrantScope[];
}

export interface GrantPresentation {
  source: 'generic' | 'plugin';
  pluginId?: string;
  pluginVersion?: string;
  title: LocalizedMessage;
  scope: LocalizedMessage;
}
