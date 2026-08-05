import type { ClientTokenRecord, Upstream } from '@approval-mcp/contracts';
import type { ConfigState } from '@approval-mcp/state-store';

export interface EntityDisplayNames {
  tokenLabel?: string;
  upstreamAlias?: string;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

export function entityDisplayNames(
  state: Readonly<ConfigState>,
  clientTokenId: string,
  upstreamId: string,
): EntityDisplayNames {
  const token = state.clientTokens[clientTokenId] as
    | unknown
    | undefined;
  const upstream = state.upstreams[upstreamId] as
    | unknown
    | undefined;
  const tokenLabel = nonEmpty(
    (token as ClientTokenRecord | undefined)?.label,
  );
  const upstreamAlias = nonEmpty(
    (upstream as Upstream | undefined)?.alias,
  );
  return {
    ...(tokenLabel === undefined ? {} : { tokenLabel }),
    ...(upstreamAlias === undefined ? {} : { upstreamAlias }),
  };
}
