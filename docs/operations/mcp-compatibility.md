# MCP Compatibility

The public `/mcp` endpoint accepts both protocol generations supported by the
stable TypeScript SDK v2:

- legacy MCP through the 2025-11-25 Streamable HTTP lifecycle;
- modern MCP 2026-07-28 through `server/discover` and typed modern requests.

The endpoint keeps the same bearer-token authentication, Origin validation,
token-scoped tool catalog, policy checks, approval flow, and audit records in
both modes. Upstream connections use automatic negotiation: they try the modern
discovery flow first and fall back to the legacy lifecycle when the upstream is
not modern-capable.

The approval wait remains a normal blocking `tools/call` response. MCP Tasks are
not advertised. In protocol 2026-07-28, Tasks moved to the experimental
`io.modelcontextprotocol/tasks` extension, and no production TypeScript
extension package is currently published. The existing approval coordinator is
kept independent from the transport so a standard Tasks adapter can be added
when the official extension surface is available. Until then, advertising a
private look-alike would create incompatible clients and is intentionally
avoided.

Compatibility is covered by integration tests that connect one legacy client
and one auto-negotiating modern client to the same authenticated gateway and
exercise tool listing, inspection, allowed calls, and denied calls.

## Approval MCP's own tools

The profile editor shows a virtual **Approval MCP** upstream. Its tool rules
apply through the same policy, approval, and audit flow as external tools. The
available names are `approval_mcp__inspect_tool`, `approval_mcp__list_upstreams`,
`approval_mcp__get_tool_info`, `approval_mcp__list_history`,
`approval_mcp__get_history_event`, `approval_mcp__list_all_history`,
`approval_mcp__get_any_history_event`, `approval_mcp__get_upstream_health`, and
`approval_mcp__refresh_upstream_tools`. There is no approval-status polling tool:
an approval waits in its original call.

Only `inspect_tool` retains its historical default availability when no
profile rule exists. Other self tools are hidden until configured in a profile.
The ordinary history tools restrict results to the authenticated MCP token;
knowing another call ID does not grant access. The separate `list_all_history`
and `get_any_history_event` tools can read redacted history across agents. They,
like the health and refresh tools, require both an explicit profile rule and
the agent's **MCP management** permission. History pages use stable
first-seen-time cursors; a cursor is valid only with the filters that produced it.
This permission can be set when creating an agent or changed later in its
settings without changing its token. Management tokens should be kept separate
from ordinary agent tokens and rotated or deleted when no longer needed. A
rotated token keeps the agent's profiles but immediately invalidates the old
secret; deleting an agent also removes its active grants and profile assignments
while retaining its identity in audit history. No self tool can approve or
change a profile rule.
