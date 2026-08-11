# Approval test MCP

A harmless Streamable HTTP MCP server for exercising Approval MCP end to end.
It exposes a read-only preview tool and a simulated deployment tool. Neither
tool changes an external system.

Run from the repository root:

```bash
node pocs/approval-test-mcp/server.mjs
```

Configure an upstream with URL `http://127.0.0.1:37221/mcp` and enable private
network access. Put `deploy_release` behind a `require_approval` profile rule.

After creating an agent token, exercise the wrapper with:

```bash
APPROVAL_MCP_URL=https://approval.example.com/mcp \
APPROVAL_MCP_TOKEN=amcp_replace_me \
node pocs/approval-test-mcp/call-through-wrapper.mjs
```
