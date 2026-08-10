import type {
  ApprovalSection,
  JsonPrimitive,
  JsonValue,
  LocalizedMessage,
  ProposedGrantScope,
  SupportedLocale,
} from '@approval-mcp/contracts';

export type {
  ApprovalField,
  ApprovalSection,
  LocalizedMessage,
  ProposedGrantScope,
  SupportedLocale,
} from '@approval-mcp/contracts';

export interface PluginCallInput {
  upstreamId: string;
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
