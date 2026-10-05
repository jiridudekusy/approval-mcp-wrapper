import type {
  AdminId,
  ClientTokenId,
  Grant,
  GrantId,
  Policy,
  PolicyId,
  UpstreamId,
} from '@approval-mcp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import {
  buildTokenCatalog,
  GatewayError,
  PolicyDeniedError,
  TokenScopedGateway,
  validateOrigin,
  createMcpHttpHandler,
  evaluateToolInspection,
  TOOL_INSPECTION_TOOL_NAME,
  withPolicyDescription,
} from './index.js';

const tokenA = 'token-a' as ClientTokenId;
const tokenB = 'token-b' as ClientTokenId;
const upstreamId = 'upstream-1' as UpstreamId;
const tools = [
  {
    upstreamId,
    upstreamAlias: 'signal',
    tool: { name: 'send_message', inputSchema: { type: 'object' } },
  },
  {
    upstreamId,
    upstreamAlias: 'signal',
    tool: { name: 'list_groups', inputSchema: { type: 'object' } },
  },
];

describe('token-scoped catalog', () => {
  it('returns deterministic and isolated tool lists for two tokens', () => {
    const visible = new Map([
      [tokenA, new Set(['signal__send_message'])],
      [tokenB, new Set(['signal__list_groups'])],
    ]);

    expect(buildTokenCatalog(tokenA, tools, visible).map((item) => item.name)).toEqual([
      'signal__send_message',
    ]);
    expect(buildTokenCatalog(tokenB, tools, visible).map((item) => item.name)).toEqual([
      'signal__list_groups',
    ]);
  });

  it('rejects ambiguous aliases', () => {
    expect(() =>
      buildTokenCatalog(
        tokenA,
        [{ ...tools[0]!, upstreamAlias: 'bad__alias' }],
        new Map([[tokenA, new Set(['bad__alias__send_message'])]]),
      ),
    ).toThrow('alias');
  });

  it('adds policy and timeout guidance without replacing the upstream description', () => {
    const described = withPolicyDescription(
      {
        name: 'send_message',
        description: 'Send a message.',
        inputSchema: { type: 'object' },
      },
      {
        approvalMayBeRequired: true,
        approvalTimeoutSeconds: 300,
        toolCallTimeoutSeconds: 1_800,
      },
    );

    expect(described.description).toContain('Send a message.');
    expect(described.description).toContain('human approval may be required');
    expect(described.description).toContain('300 seconds');
    expect(described.description).toContain('1800 seconds');
    expect(described.description).toContain(TOOL_INSPECTION_TOOL_NAME);
  });
});

describe('tool inspection policy evaluation', () => {
  const now = '2026-08-06T00:00:00.000Z';
  const policy: Policy = {
    id: 'policy-approval' as PolicyId,
    clientTokenId: tokenA,
    upstreamId,
    toolName: 'send_message',
    outcome: 'require_approval',
    predicates: [],
    enabled: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const base = {
    publicToolName: 'signal__send_message',
    clientTokenId: tokenA,
    upstreamId,
    upstreamToolName: 'send_message',
    argumentsValue: { message: 'hello' },
    policies: [policy],
    approvalTimeoutSeconds: 300,
    toolCallTimeoutSeconds: 1_800,
    now,
  };

  it('reports approval and accounts for an active grant bypass', () => {
    expect(evaluateToolInspection({ ...base, grants: [] })).toMatchObject({
      outcome: 'require_approval',
      approvalRequired: true,
      reasonCode: 'approval.required',
      approvalTimeoutSeconds: 300,
      toolCallTimeoutSeconds: 1_800,
    });

    const grant: Grant = {
      id: 'grant-1' as GrantId,
      clientTokenId: tokenA,
      upstreamId,
      toolName: 'send_message',
      predicates: [],
      normalizationVersion: 1,
      approvedBy: 'admin-1' as AdminId,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    expect(evaluateToolInspection({ ...base, grants: [grant] })).toMatchObject({
      outcome: 'allow',
      approvalRequired: false,
      reasonCode: 'grant.matched',
    });
  });
});

describe('TokenScopedGateway', () => {
  it('returns the same public error for hidden and unknown tool guesses', async () => {
    const coordinator = { call: vi.fn() };
    const gateway = new TokenScopedGateway({
      coordinator,
      catalogFor: () => buildTokenCatalog(tokenA, tools, new Map([
        [tokenA, new Set(['signal__list_groups'])],
      ])),
    });

    const hidden = gateway.call(tokenA, 'signal__send_message', {}, new AbortController().signal);
    const unknown = gateway.call(tokenA, 'signal__does_not_exist', {}, new AbortController().signal);

    await expect(hidden).rejects.toMatchObject({ code: 'tool_not_found' });
    await expect(unknown).rejects.toMatchObject({ code: 'tool_not_found' });
    expect(coordinator.call).not.toHaveBeenCalled();
  });

  it('exposes the built-in inspection tool without sending it upstream', async () => {
    const coordinator = { call: vi.fn() };
    const inspectTool = vi.fn().mockReturnValue({
      toolName: 'signal__list_groups',
      outcome: 'require_approval',
      approvalRequired: true,
      reasonCode: 'approval.required',
      approvalTimeoutSeconds: 300,
      toolCallTimeoutSeconds: 1_800,
    });
    const gateway = new TokenScopedGateway({
      coordinator,
      catalogFor: () => buildTokenCatalog(tokenA, tools, new Map([
        [tokenA, new Set(['signal__list_groups'])],
      ])),
      inspectTool,
    });

    await expect(gateway.listTools(tokenA)).resolves.toEqual([
      expect.objectContaining({
        name: TOOL_INSPECTION_TOOL_NAME,
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
      expect.objectContaining({ name: 'signal__list_groups' }),
    ]);
    await expect(
      gateway.call(
        tokenA,
        TOOL_INSPECTION_TOOL_NAME,
        {
          toolName: 'signal__list_groups',
          arguments: { group: 'family' },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        toolName: 'signal__list_groups',
        approvalRequired: true,
        approvalTimeoutSeconds: 300,
        toolCallTimeoutSeconds: 1_800,
      },
    });
    expect(inspectTool).toHaveBeenCalledWith(
      tokenA,
      'signal__list_groups',
      { group: 'family' },
    );
    expect(coordinator.call).not.toHaveBeenCalled();

    await expect(
      gateway.call(
        tokenA,
        TOOL_INSPECTION_TOOL_NAME,
        {},
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe('validateOrigin', () => {
  it('allows configured origins and rejects missing or foreign origins', () => {
    expect(() =>
      validateOrigin('https://admin.example.test', [
        'https://admin.example.test',
      ]),
    ).not.toThrow();
    expect(() => validateOrigin(undefined, ['https://admin.example.test'])).toThrow(
      GatewayError,
    );
    expect(() =>
      validateOrigin('https://evil.example.test', [
        'https://admin.example.test',
      ]),
    ).toThrow('Origin');
  });
});

describe('Streamable HTTP MCP integration', () => {
  it('serves the same authenticated gateway over legacy and modern MCP', async () => {
    const coordinator = {
      call: vi.fn(async (input: { arguments: Record<string, unknown> }) => {
        if (input.arguments['denied'] === true) {
          throw new PolicyDeniedError(
            'approval.denied',
            'The selected conversation is private.',
          );
        }
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      }),
    };
    const gateway = new TokenScopedGateway({
      coordinator,
      catalogFor: () =>
        buildTokenCatalog(
          tokenA,
          tools,
          new Map([[tokenA, new Set(['signal__list_groups'])]]),
        ),
      inspectTool: (_tokenId, toolName) => ({
        toolName,
        outcome: 'require_approval',
        approvalRequired: true,
        reasonCode: 'approval.required',
        approvalTimeoutSeconds: 300,
        toolCallTimeoutSeconds: 1_800,
      }),
    });
    const handler = createMcpHttpHandler({
      allowedOrigins: ['https://admin.example.test'],
      authenticate: async (token) => (token === 'valid' ? tokenA : undefined),
      gateway,
    });
    const server = createServer((request, response) => {
      void handler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP server address');
    }
    try {
      for (const era of ['legacy', 'modern'] as const) {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${address.port}/mcp`),
          {
            requestInit: {
              headers: {
                authorization: 'Bearer valid',
                origin: 'https://admin.example.test',
              },
            },
          },
        );
        const client = new Client(
          { name: `gateway-${era}-test`, version: '1.0.0' },
          era === 'modern'
            ? {
                capabilities: {},
                versionNegotiation: { mode: 'auto' },
              }
            : { capabilities: {} },
        );
        try {
          await client.connect(transport);
          expect(client.getProtocolEra()).toBe(era);
          await expect(client.listTools()).resolves.toMatchObject({
            tools: [
              {
                name: TOOL_INSPECTION_TOOL_NAME,
                annotations: { readOnlyHint: true },
              },
              { name: 'signal__list_groups' },
            ],
          });
          await expect(
            client.callTool({
              name: TOOL_INSPECTION_TOOL_NAME,
              arguments: { toolName: 'signal__list_groups', arguments: {} },
            }),
          ).resolves.toMatchObject({
            structuredContent: {
              toolName: 'signal__list_groups',
              approvalRequired: true,
              approvalTimeoutSeconds: 300,
              toolCallTimeoutSeconds: 1_800,
            },
          });
          await expect(
            client.callTool({ name: 'signal__list_groups', arguments: {} }),
          ).resolves.toMatchObject({
            content: [{ type: 'text', text: 'ok' }],
          });
          await expect(
            client.callTool({
              name: 'signal__list_groups',
              arguments: { denied: true },
            }),
          ).resolves.toMatchObject({
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Tool call denied: The selected conversation is private.',
              },
            ],
          });
        } finally {
          await client.close();
        }
      }
      expect(coordinator.call).toHaveBeenCalledTimes(4);
    } finally {
      await handler.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
});
