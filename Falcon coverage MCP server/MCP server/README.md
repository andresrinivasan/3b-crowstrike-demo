The whole server: one route, one JSON-RPC dispatcher, three tools.

**Trigger.** `POST /falcon-coverage/mcp`, restricted to members of this space. An MCP client is
pointed at that URL and needs nothing else — `route_auth = "space"` makes 3B run the entire
client-facing OAuth 2.1 handshake (discovery, registration, consent, token issue and
verification) at the route boundary, so there is no authorization code in this step. The bearer
is stripped before the step runs; the only identity that reaches the code is the consenting
user's email in `x-3b-authenticated-email`, which is logged with each tool call.

`GET` returns `405` — this is a stateless POST-only server with no server-initiated SSE stream,
which is what the streamable HTTP transport permits.

## The tools

| Tool | Question | Falcon API |
|---|---|---|
| `falcon_find_host` | Is this host in Falcon? | Hosts — `/devices/queries/devices/v1`, `/devices/entities/devices/v2` |
| `falcon_host_tags` | What tags does it have? | Hosts, plus `/devices/entities/host-groups/v1` for group names |
| `falcon_unmanaged_on_subnet` | What unmanaged assets are on this subnet? | Discover — `/discover/queries/hosts/v1`, `/discover/entities/hosts/v1` |

Required scopes on the connector's key: **Hosts: Read** for the first two, **Host Group: Read**
to name host groups, **Assets: Read** plus the Falcon Discover module for the third.

`falcon_find_host` and `falcon_host_tags` accept whatever identifier the analyst has — hostname,
FQDN, AID, IPv4, MAC, or serial — and report which one they matched on. Falcon indexes the
**short** hostname while returning the FQDN in its responses, so an FQDN pasted out of a CMDB
matches nothing unless it is stripped at the first dot; [falcon.ts](falcon.ts) does that and
still tries the full string, then falls back to serial number.

`falcon_unmanaged_on_subnet` accepts CIDR, an octet prefix (`10.4.*`), or a single address. Both
Falcon query APIs compare IPs numerically and accept inclusive bounds, so [subnet.ts](subnet.ts)
turns any range into its exact first and last address and a `/20` is queried as a `/20` — no
widening to the containing `/16`. `contains()` still re-checks each result, which costs nothing
and keeps a record with a missing or malformed IP out of the count. Every candidate is
cross-checked against the Hosts API for the same range by MAC and short hostname —
`matches_managed_host` marks the ones that are managed and only look unmanaged. Discover reports
MACs uppercase and the Hosts API reports them lowercase, so both sides are normalized before
they are compared.

### Two FQL traps this server works around

Both were found by querying the live tenant, and neither fails loudly:

- **`field:[a,b]` compares case-sensitively; `field:'a'` does not.** `hostname:'ec2amaz-m858lde'`
  finds the host stored as `EC2AMAZ-M858LDE`, but `hostname:['ec2amaz-m858lde']` finds nothing.
  Folding several candidate values into one OR-list is the cheaper query and the wrong answer for
  anything the analyst did not type in the tenant's exact case, so `anyOf` in
  [falcon.ts](falcon.ts) issues one single-value query per candidate instead.
- **The Hosts API rejects IP wildcards outright.** `local_ip:'172.31.*'` is a `400`, not an empty
  result — only exact addresses and range comparisons work. Discover accepts wildcards but needs
  the operator form (`current_local_ip:*'172.31.*'`). Bounding both queries by range sidesteps the
  difference entirely.

## Honesty over tidiness

These tools answer a question an analyst acts on, so the results carry their own caveats and the
calling model is told to relay them:

- "No record in Falcon" is not "no sensor installed" — renamed, pruned, and other-tenant
  machines all come back empty.
- A host on record but unseen for a month is a coverage gap, not coverage, so
  `days_since_last_seen` is computed rather than left to the reader.
- Discover works by passive observation, so stale sensors, dual-homed hosts, NAT/VPN addresses
  and short DHCP leases surface as false gaps. `unsupported` assets — printers, switches,
  cameras — are excluded by default so the gap count stays meaningful.
- Result sets are capped, and any cap that bit is reported in `truncated` and
  `truncation_note` rather than silently shortening the list.

A tool that fails returns a JSON-RPC *success* carrying `isError: true` and a message the model
can act on — that is what the MCP spec requires, and the transport genuinely did work. Falcon
failures name the likely cause: a `403` from Discover means the module or the Assets scope is
gone, which is a licensing fix, not a query problem. Host group names are the one degradation
reported in-band: resolving them needs a scope the lookup itself does not, so a refusal fills in
`host_groups_note` and leaves the ids rather than failing the whole call.

## Files

- [script.ts](script.ts) — HTTP framing, JSON-RPC dispatch, protocol negotiation.
- [tools.ts](tools.ts) — the three tool definitions, their schemas, and their handlers.
- [falcon.ts](falcon.ts) — the Falcon client, identifier resolution, pagination.
- [subnet.ts](subnet.ts) — CIDR and prefix parsing, and the exact range bounds each query uses.

To add a tool, write it in [tools.ts](tools.ts) and append it to `TOOLS`; `tools/list` and
`tools/call` pick it up with no change to [script.ts](script.ts). Keep [api.json](api.json)
current when the request or response contract changes.
