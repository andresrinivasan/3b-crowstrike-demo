An MCP server that lets a security analyst ask CrowdStrike Falcon coverage questions from
whatever AI client they already work in — Claude, Claude Code, a ChatGPT connector — instead of
opening the Falcon console or waiting for someone to run a report.

It answers three questions:

- **Is this host in Falcon?** (`falcon_find_host`) — hostname, FQDN, device ID, IP, MAC or
  serial in; the sensor's records out, with how long ago it was actually seen.
- **What tags does it have?** (`falcon_host_tags`) — Falcon grouping tags, sensor grouping tags,
  and host groups by name. This is the "who owns this machine" answer.
- **What unmanaged assets are on this subnet?** (`falcon_unmanaged_on_subnet`) — what Falcon
  Discover has seen on the wire with no sensor of its own, cross-checked against the managed
  inventory so the already-managed lookalikes are marked as such.

**Trigger.** `POST /falcon-coverage/mcp` ([MCP server](<MCP server/script.ts>)), restricted to
members of this space. There is no schedule and no UI — the workflow exists to be called.

**Connecting a client.** Point any MCP client at that route's URL. Nothing else is configured:
`route_auth = "space"` makes 3B serve the protected-resource and authorization-server metadata,
register the client, run the consent screen, and verify the access token on every request, so
the step never sees a credential and never implements the MCP authorization spec. Each token is
bound to this one route, independently revocable, and gated on the caller's access to this
space.

**The flow.** One step handles everything: it parses the JSON-RPC request, dispatches to a tool,
and returns both a text rendering and `structuredContent`. The Hosts API answers the first two
tools; Falcon Discover answers the third, because an asset with no sensor has no AID and never
appears in the Hosts API at all.

**External services.** CrowdStrike Falcon, through a connector on the step — no token is in the
code and the region comes from the connector, not a hardcoded base URL. Needs **Hosts: Read**,
**Host Group: Read**, and **Assets: Read** with the Falcon Discover module licensed.

**Side effects.** None. Read-only against Falcon, no volumes, no notifications; nothing is
tagged, contained, or written back.

**Operational notes.** A `403` from `/discover/*` means the Discover module or the Assets scope
is no longer available to the key — the subnet tool reports that as the cause rather than
falling back to a weaker source, because switching source changes what the answer means.
Result sets are capped so a wide query cannot flood a client's context; when a cap bites, the
response says so in `truncated` and `truncation_note`. Each tool call logs the consenting
caller's email to stderr, so an execution's logs are the audit trail for who asked what.

**Related.** The **Unregistered host detection** workflow answers the same coverage question on
a schedule and publishes a nightly report page; this workflow is the interactive, per-question
surface over the same Falcon data. They share no state.

**Pointers.** To add a tool, append to `TOOLS` in [MCP server/tools.ts](<MCP server/tools.ts>).
To change how an identifier is resolved to a device, edit `resolveIdentifier` in
[MCP server/falcon.ts](<MCP server/falcon.ts>). To change the result caps, edit
`ASSET_ANALYSIS_CAP` and `MANAGED_COMPARISON_CAP` in
[MCP server/tools.ts](<MCP server/tools.ts>).
