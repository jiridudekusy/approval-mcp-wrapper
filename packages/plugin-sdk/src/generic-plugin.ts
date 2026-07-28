import type { PluginCallDescription, PluginCallInput } from './contracts.js';

export function createGenericDescription(
  input: PluginCallInput,
  reasonCode = 'plugin.generic',
): PluginCallDescription {
  const upstreamName =
    input.upstreamAlias.length === 0
      ? input.upstreamAlias
      : `${input.upstreamAlias[0]?.toUpperCase()}${input.upstreamAlias.slice(1)}`;
  return {
    source: 'generic',
    reasonCode,
    normalizedContext: {
      arguments: structuredClone(input.arguments),
    },
    sensitivePaths: [],
    title: {
      key: 'plugin.generic.title',
      params: {
        upstream: input.upstreamAlias,
        tool: input.toolName,
      },
      fallback: {
        en: `${upstreamName}: ${input.toolName}`,
        cs: `${upstreamName}: ${input.toolName}`,
      },
    },
    sections: [
      {
        id: 'arguments',
        heading: {
          key: 'plugin.generic.arguments',
          fallback: {
            en: 'Arguments',
            cs: 'Argumenty',
          },
        },
        fields: [
          {
            label: {
              key: 'plugin.generic.raw_arguments',
              fallback: {
                en: 'Tool arguments',
                cs: 'Argumenty nástroje',
              },
            },
            value: structuredClone(input.arguments),
          },
        ],
      },
    ],
    proposedScopes: [],
  };
}
