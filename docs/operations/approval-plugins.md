# Approval presentation plugins

Open **Upstreams**, edit an MCP connection, and choose its **Presentation plugin**. The plugin pin is stored on that upstream, so two servers of the same type can use different display names and metadata while sharing the same plugin. Existing connections without a plugin continue to use the generic approval view.

The built-in plugin IDs are:

| Plugin ID | Connected server | Covered tools |
| --- | --- | ---: |
| `email` | Mail search and reading | 9 |
| `geo` | Device location and visits | 8 |
| `imcp` | macOS contacts, calendar, maps, phone, reminders, weather | 27 |
| `krkonoskewellness` | Wellness catalog and bookings | 4 |
| `minutes` | Minutes / Signal | 35 |
| `whatsapp` | WhatsApp chats and messages | 13 |

All plugins provide Czech and English operation titles, highlight the arguments needed to understand the action, retain all arguments in the technical section, and mark potentially consequential requests with an appropriate risk level. Unknown future tool names fall back to a generic presentation. The wellness `book` tool is shown as a preview unless `confirm=true`; a confirmed booking is marked dangerous and has no reusable grant scope. Minutes group termination is likewise dangerous and has no reusable scope.

Presentation plugins do not change profile policy or automatically require approval. Configure tool outcomes in **Access → Profiles**. Reusable scopes proposed by these plugins are restricted to one hour and an exact account, person, or recipient where the tool provides such an identifier.

The catalog was checked against the live MCP endpoint on 2026-10-05. If an upstream adds or renames tools, update the corresponding plugin definition and its tests before relying on specialized presentation for the new operation.
