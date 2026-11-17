import {
  AddressPolicyError,
  OfficialMcpConnectionFactory,
  type McpConnectInput,
  type McpConnectionFactory,
} from '@approval-mcp/upstream';

export type ProbeFailure = 'auth_required' | 'address_blocked' | 'timeout' | 'connection_failed';
export type ProbeResult = { status: 'ok'; toolCount: number } | { status: 'error'; code: ProbeFailure };

/** No tools are invoked. Bound initialization, discovery, and cleanup independently. */
export async function probeMcp(
  input: McpConnectInput,
  factory: McpConnectionFactory = new OfficialMcpConnectionFactory(),
  timeoutMs = 10_000,
): Promise<ProbeResult> {
  const controller = new AbortController();
  let connection: Awaited<ReturnType<McpConnectionFactory['connect']>> | undefined;
  const task = (async (): Promise<ProbeResult> => {
    const connected = await factory.connect({ ...input, signal: controller.signal });
    connection = connected;
    if (controller.signal.aborted) {
      void connected.close().catch(() => undefined);
      throw controller.signal.reason;
    }
    const catalog = await connected.listTools();
    return { status: 'ok', toolCount: catalog.tools.length };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Probe deadline')); }, timeoutMs);
  });
  try {
    return await Promise.race([task, timedOut]);
  } catch (error) {
    // Never expose upstream response bodies: they can echo credentials or HTML.
    let cause: unknown = error;
    let blocked = false;
    let unauthorized = false;
    for (let depth = 0; depth < 8 && typeof cause === 'object' && cause !== null; depth++) {
      blocked ||= cause instanceof AddressPolicyError;
      const value = cause as { code?: unknown; data?: { status?: unknown }; cause?: unknown };
      unauthorized ||= value.code === 401 || value.code === 403 || value.code === 'CLIENT_HTTP_AUTHENTICATION' ||
        value.data?.status === 401 || value.data?.status === 403;
      cause = value.cause;
    }
    return { status: 'error', code: controller.signal.aborted ? 'timeout'
      : blocked ? 'address_blocked' : unauthorized ? 'auth_required' : 'connection_failed' };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (connection !== undefined) void connection.close().catch(() => undefined);
  }
}
