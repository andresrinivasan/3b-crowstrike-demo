An MCP server for CrowdStrike Falcon host coverage. AI clients connect to it to answer three questions: is a given host in Falcon, which hosts from a list are missing a sensor, and what tags and host groups a host carries.

**Trigger:** `POST /falcon/mcp`, served by [Falcon MCP/script.ts](<Falcon MCP/script.ts>). Access is limited to members of this space; 3B runs the MCP OAuth flow at the route boundary.

**Flow:** a single step handles the JSON-RPC request, resolves hostnames through Falcon's device query API, and hydrates full device records for tags, groups, status, and last-seen.

**External services:** CrowdStrike Falcon, via a connector on the step. Read-only — nothing is written back to Falcon.

To add a tool, append to the `tools` array in [Falcon MCP/script.ts](<Falcon MCP/script.ts>).
