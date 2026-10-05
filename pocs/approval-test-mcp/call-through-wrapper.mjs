import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

const wrapperUrl = process.env.APPROVAL_MCP_URL;
const token = process.env.APPROVAL_MCP_TOKEN;
if (wrapperUrl === undefined || token === undefined) {
  throw new Error('APPROVAL_MCP_URL and APPROVAL_MCP_TOKEN are required');
}

const url = new URL(wrapperUrl);
const client = new Client(
  { name: 'approval-test-client', version: '1.0.0' },
  {
    capabilities: {},
    versionNegotiation: { mode: 'auto' },
  },
);
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: {
      authorization: `Bearer ${token}`,
      origin: url.origin,
    },
  },
});

try {
  await client.connect(transport);
  const catalog = await client.listTools();
  const deployTool = catalog.tools.find((tool) =>
    tool.name.endsWith('__deploy_release'),
  );
  if (deployTool === undefined) {
    throw new Error(
      `No deploy_release tool is visible. Available tools: ${catalog.tools.map((tool) => tool.name).join(', ')}`,
    );
  }
  const result = await client.callTool({
    name: deployTool.name,
    arguments: {
      service: 'approval-demo',
      version: '1.2.3',
      environment: 'production',
    },
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}
