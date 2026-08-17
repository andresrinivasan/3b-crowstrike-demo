---
name: crowdstrike-asset-discovery
description: Find assets on the network that CrowdStrike Falcon sees but does not manage — machines with no Falcon sensor installed. Use whenever a task involves EDR coverage gaps, unmanaged or unprotected endpoints, shadow IT on a subnet, asset inventory sweeps, "what's on our network that we don't know about", or a scheduled report of newly-seen devices — even if "Falcon Discover", "entity_type", or "unmanaged" is never said. Covers the query-then-hydrate pattern, the Assets scope, pagination, and how to attribute a gap to an owning team.
---

# CrowdStrike Falcon: asset discovery (unmanaged neighbors)

Falcon Discover turns every sensored host into a passive network sensor. Hosts observe their
neighbors, and anything seen on the network whose IP has no corresponding sensor is reported
as an **unmanaged** asset. That list is the closest thing to an answer for "which machines on
our network have no EDR."

This is a different API family from the Hosts API, with a different scope. Unmanaged assets
do **not** appear in `/devices/queries/devices/v1` at all — no sensor means no AID.

## Auth and scope

Required API scope: **Assets: Read**. This is separate from Hosts: Read; a key scoped only
for Hosts returns `403` here. Read-only is sufficient for everything in this skill.

Plain requests, no `Authorization` header, connector attached. Call `connectStepToApp` with
`targetUrl: "https://api.crowdstrike.com/discover/queries/hosts/v1"`, and take the tenant's
cloud base URL from the connector rather than hardcoding a region.

## The two-call pattern

**1. Query for asset IDs** — `GET /discover/queries/hosts/v1`

```
GET /discover/queries/hosts/v1?filter=entity_type:'unmanaged'%2Blast_seen_timestamp:>'now-24h'&limit=100&offset=0
```

```json
{
  "resources": ["asset-id-1", "asset-id-2"],
  "meta": { "pagination": { "offset": 0, "limit": 100, "total": 417 } }
}
```

**2. Hydrate to entities** — `GET /discover/entities/hosts/v1?ids=…&ids=…`

Repeat the `ids` parameter per id (flat encoding, not `ids[]=`). Keep chunks to ~100 ids to
stay inside URL length limits.

Note `limit` on the query endpoint caps at **100** — much lower than the Hosts API's 5000 —
so any real environment requires pagination.

## Entity types

| `entity_type` | Meaning |
|---|---|
| `managed` | A Falcon sensor is installed and reporting. Also visible via the Hosts API. |
| `unmanaged` | Seen on the network by a sensored neighbor, no sensor of its own. **The coverage gap.** |
| `unsupported` | Identified as something the sensor cannot run on — printers, switches, IP cameras, appliances. |

`unsupported` matters for reporting sanity: a raw `unmanaged` count usually includes a long
tail of network gear that will never have EDR. Either filter it out or report the two
categories separately, otherwise the number is alarming and useless.

Common filters:

```
entity_type:'unmanaged'+last_seen_timestamp:>'now-24h'     # canonical daily sweep
entity_type:'unmanaged'+first_seen_timestamp:>'now-7d'     # newly appeared this week
entity_type:'unmanaged'+current_local_ip:'10.4.*'          # a specific subnet
entity_type:'unmanaged'+platform_name:'Windows'
entity_type:['unmanaged','unsupported']                    # both categories
```

Standard FQL rules apply: single quotes around strings, `+` for AND, `*` for wildcards.
Relative times (`now-24h`, `now-7d`) are accepted on the timestamp fields.

## How discovery attributes an asset

The most useful fields on an unmanaged entity are the ones describing **who saw it**:

| Field | Why it matters |
|---|---|
| `last_discoverer_hostname` | The sensored host that observed this asset. Tells you where on the network it lives. |
| `discoverer_tags` | The grouping tags of that observing host — including its departmental code. |
| `current_local_ip` | The asset's IP at last sighting. |
| `network_interfaces[].mac_address` | MAC, the most durable identifier for an unmanaged asset. |
| `first_seen_timestamp` / `last_seen_timestamp` | ISO 8601 UTC. "First seen today" is the actionable signal. |
| `hostname`, `os_version`, `platform_name` | Often partial or absent — this is passive observation, not an agent report. |
| `confidence` | How sure Discover is about the fingerprint. Low confidence means treat the OS guess as a hint. |

`discoverer_tags` is the hook that makes a coverage report actionable. An unmanaged asset has
no owner of its own, but the machine that spotted it usually does — so grouping gaps by the
discoverer's department tag routes each list to a team that can go look at the subnet. This is
the payoff for having invested in host tagging (`crowdstrike-host-tagging`).

Do not over-trust it: a laptop on shared VLAN discovers neighbors that aren't its
department's. Treat the tag as a routing hint, not an ownership assertion.

## Pagination

Offset and total, in a plain loop with an iteration cap:

```ts
const BASE = "https://api.crowdstrike.com";

async function queryAssetIds(filter: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;

  for (let page = 0; page < 500; page++) {
    const url = new URL(`${BASE}/discover/queries/hosts/v1`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Discover query failed: ${res.status} ${await res.text()}`);

    const body = await res.json();
    const page_ids: string[] = body.resources ?? [];
    ids.push(...page_ids);

    const total = body.meta?.pagination?.total ?? ids.length;
    if (page_ids.length === 0 || ids.length >= total) break;
    offset = ids.length;
  }

  return ids;
}
```

That loop is the whole of it. In a Tines story the same thing needs a counter action, a
multiply formula for the offset, a trigger comparing offset to total, a concat to accumulate,
and a delay action to avoid hammering the API — five actions in a cycle. Here it is a `while`
with a cap. If you are migrating a story that contains a pagination loop, delete the loop and
write this.

## Ready-to-use

```ts
const BASE = "https://api.crowdstrike.com";

export type UnmanagedAsset = {
  id: string;
  hostname?: string;
  current_local_ip?: string;
  mac_address?: string;
  os_version?: string;
  confidence?: number;
  first_seen?: string;
  last_seen?: string;
  discovered_by?: string;
  discoverer_tags: string[];
};

async function hydrate(ids: string[]): Promise<UnmanagedAsset[]> {
  const out: UnmanagedAsset[] = [];

  for (let i = 0; i < ids.length; i += 100) {
    const url = new URL(`${BASE}/discover/entities/hosts/v1`);
    for (const id of ids.slice(i, i + 100)) url.searchParams.append("ids", id);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Discover entities failed: ${res.status} ${await res.text()}`);

    for (const r of (await res.json()).resources ?? []) {
      out.push({
        id: r.id,
        hostname: r.hostname,
        current_local_ip: r.current_local_ip,
        mac_address: r.network_interfaces?.[0]?.mac_address,
        os_version: r.os_version,
        confidence: r.confidence,
        first_seen: r.first_seen_timestamp,
        last_seen: r.last_seen_timestamp,
        discovered_by: r.last_discoverer_hostname,
        discoverer_tags: r.discoverer_tags ?? [],
      });
    }
  }

  return out;
}

export async function fetchUnmanaged(
  opts: { since?: string; includeUnsupported?: boolean } = {},
): Promise<UnmanagedAsset[]> {
  const since = opts.since ?? "now-24h";
  const type = opts.includeUnsupported
    ? "entity_type:['unmanaged','unsupported']"
    : "entity_type:'unmanaged'";

  const ids = await queryAssetIds(`${type}+last_seen_timestamp:>'${since}'`);
  console.error(`Discover: ${ids.length} asset(s) matched since ${since}`);

  return hydrate(ids);
}

export function groupByDiscovererTag(
  assets: UnmanagedAsset[],
  prefix = "FalconGroupingTags/",
): Map<string, UnmanagedAsset[]> {
  const groups = new Map<string, UnmanagedAsset[]>();

  for (const asset of assets) {
    const tags = asset.discoverer_tags
      .filter((t) => t.startsWith(prefix))
      .map((t) => t.replace(prefix, ""));

    for (const key of tags.length > 0 ? tags : ["UNATTRIBUTED"]) {
      const bucket = groups.get(key) ?? [];
      bucket.push(asset);
      groups.set(key, bucket);
    }
  }

  return groups;
}
```

Errors throw rather than being logged and swallowed: a coverage report that silently omits a
failed page understates the gap, which is the one failure mode that matters here.

## Correlation caveat — before you call it a gap

An asset reported as `unmanaged` may still be a known, protected machine. Discover matches on
observed network identity, so these produce false gaps:

- A host with a **stale or broken sensor** — present in Hosts, not reporting, so its IP looks unsensored.
- A **renamed** machine, appearing as a new asset.
- **Dual-homed** hosts and VPN/NAT addresses, where the observed IP isn't the one the sensor connected from.
- **Short-lived DHCP leases**, where an IP moves between machines within the window.
- **Virtual machines and containers** cycling through addresses.

So cross-check candidates against the Hosts API (`crowdstrike-hosts-lookup`) by MAC or
hostname before declaring a machine unprotected, and phrase the output honestly: "seen on the
network with no matching Falcon sensor" rather than "has no EDR". The false-positive rate is
what determines whether anyone keeps reading the report after week two.

Also sanity-check the trend rather than the absolute number. A daily count that jumps because
a lab subnet came online is not a security event; a steady rise in `first_seen_timestamp`
within one department usually is.

## When not to use this

- To look up a machine you already know exists in Falcon, use `crowdstrike-hosts-lookup`.
- To tag hosts, use `crowdstrike-host-tagging` — unmanaged assets have no AID and cannot be tagged.
- For a full CMDB reconciliation, Discover is one input among several (DHCP, switch ARP tables, cloud inventory); do not treat it as authoritative for asset inventory.
- Discover requires the Falcon Discover module to be licensed. If `/discover/*` returns `403` with a valid Assets scope, the module is likely not enabled on the tenant.
