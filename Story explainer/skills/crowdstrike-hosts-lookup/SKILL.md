---
name: crowdstrike-hosts-lookup
description: Resolve hostnames, IPs, or serials to CrowdStrike Falcon device IDs (AIDs) and fetch host details. Use whenever a task asks whether a machine is in CrowdStrike, whether a laptop has the Falcon sensor, who last logged into a host, what tags a host carries, or when the OS/IP/last-seen time of an endpoint is needed — even if "AID", "device_id", or "FQL" is never said. Covers the mandatory two-call query-then-details pattern and the FQDN trap that makes most first attempts silently return nothing.
---

# CrowdStrike Falcon: host lookup

Falcon has no "get host by hostname" endpoint. You always make **two** calls: query for
device IDs, then hydrate those IDs into full records.

## Auth and base URL

Falcon tenants live on different clouds. The base URL is one of:

| Cloud | Base URL |
|---|---|
| US-1 | `https://api.crowdstrike.com` |
| US-2 | `https://api.us-2.crowdstrike.com` |
| EU-1 | `https://api.eu-1.crowdstrike.com` |
| US-GOV-1 | `https://api.laggar.gcw.crowdstrike.com` |

**Never hardcode the region and never put a token in code.** Write plain unauthenticated
requests and attach a connector — the proxy injects the OAuth2 bearer:

```ts
const res = await fetch("https://api.crowdstrike.com/devices/queries/devices/v1?filter=" + …);
```

Call `connectStepToApp` with `targetUrl: "https://api.crowdstrike.com/devices/queries/devices/v1"`.
If the tenant is on another cloud, the connector's own base URL governs; read it from the
`aiContext` the connector returns rather than guessing. Required API scope: **Hosts: Read**.

## The two-call pattern

**1. Query for IDs** — `GET /devices/queries/devices/v1`

```
GET /devices/queries/devices/v1?filter=hostname:'LAPTOP-4471'&limit=100
```

```json
{
  "resources": ["a1b2c3d4e5f6…", "…"],
  "meta": { "pagination": { "offset": 0, "limit": 100, "total": 2 } }
}
```

`resources` is an array of AIDs (device IDs) — nothing else. An empty array means no match;
it is **not** an error.

**2. Hydrate to details** — `POST /devices/entities/devices/v2`

```json
{ "ids": ["a1b2c3d4e5f6…", "…"] }
```

Returns one object per device in `resources`. Up to **5000 ids per call** — chunk beyond that.

There is an older `GET /devices/entities/devices/v1?ids=…` form. Prefer the POST `v2`: it
avoids URL-length limits when you have hundreds of ids.

## The FQDN trap — read this before writing the filter

**Querying by fully-qualified domain name returns nothing.**

```
filter=hostname:'laptop-4471.corp.example.com'   →  resources: []      ✗
filter=hostname:'laptop-4471'                    →  resources: [aid]   ✓
```

Falcon indexes the short hostname. Confusingly, the *response* often contains the FQDN in
the `hostname` field, so the data looks fully-qualified while the index is not. A CSV of
hostnames pasted out of a CMDB is usually fully-qualified, so this bites almost every first
implementation — and it fails silently, reporting every host as "not in CrowdStrike".

Strip at the first dot before querying:

```ts
const shortName = (raw: string) => raw.trim().split(".")[0].toLowerCase();
```

Keep the original string alongside the stripped one so your report can show what the user
submitted next to what Falcon returned.

## FQL essentials for this endpoint

- Wrap string values in **single** quotes: `hostname:'web-01'`.
- Combine conditions with `+` (AND), not `&` or `AND`: `platform_name:'Windows'+status:'normal'`.
- Wildcard with `*`: `hostname:'web-*'`.
- Comparison operators on dates and numbers: `last_seen:>'now-24h'`, `last_seen:<'2024-01-01'`.
- Negate with `!`: `platform_name:!'Linux'`.
- Multiple values for one field, i.e. OR: `hostname:['web-01','web-02']`.

Useful filter fields: `hostname`, `local_ip`, `external_ip`, `serial_number`, `mac_address`,
`platform_name` (`Windows`/`Mac`/`Linux`), `product_type_desc` (`Workstation`/`Server`/
`Domain Controller`), `status` (`normal`/`containment_pending`/`contained`), `last_seen`,
`os_version`, `tags`.

Query by serial or MAC when you have it — both are more reliable than hostname, which users
rename.

## Fields worth reading off a device record

| Field | Meaning |
|---|---|
| `device_id` | The AID. The only durable identifier — use it for every follow-up call. |
| `hostname` | Often the FQDN, despite the index storing the short name. |
| `last_login_user` | Last interactive user. The practical "who owns this laptop" answer. |
| `tags` | Grouping tags, each prefixed `FalconGroupingTags/`. See `crowdstrike-host-tagging`. |
| `last_seen` / `first_seen` | ISO 8601 UTC. Convert to a local zone for human reports. |
| `os_version`, `platform_name` | OS build and family. |
| `connection_ip`, `local_ip`, `external_ip` | `connection_ip` is what the sensor connected from. |
| `product_type_desc` | Workstation / Server / Domain Controller. |
| `status` | Network-containment state, not health. |
| `agent_version`, `reduced_functionality_mode` | Sensor health — a stale agent still reports in. |

`last_seen` is the field that answers "is this machine actually protected". A device present
in Falcon but last seen 90 days ago is a coverage gap, not coverage.

## Pagination

`meta.pagination` carries `offset`, `limit`, `total`. Loop while you have fewer ids than
`total`, with a hard iteration cap so a wrong `total` cannot spin forever:

```ts
async function queryAllIds(filter: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const url = new URL("https://api.crowdstrike.com/devices/queries/devices/v1");
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", "5000");
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falcon device query failed: ${res.status} ${await res.text()}`);

    const body = await res.json();
    ids.push(...(body.resources ?? []));
    const total = body.meta?.pagination?.total ?? ids.length;
    if (ids.length >= total || (body.resources ?? []).length === 0) break;
    offset = ids.length;
  }
  return ids;
}
```

For a broad sweep beyond ~10k devices Falcon prefers `after`-token pagination over `offset`;
switch to `meta.pagination.after` and pass it back as the `after` parameter.

## Ready-to-use: resolve a list of hostnames

```ts
type Host = {
  device_id: string;
  hostname?: string;
  last_login_user?: string;
  tags?: string[];
  last_seen?: string;
  os_version?: string;
  connection_ip?: string;
  product_type_desc?: string;
};

type Resolved = {
  hosts: Array<Host & { submitted: string }>;
  notFound: string[];
};

const BASE = "https://api.crowdstrike.com";
const shortName = (raw: string) => raw.trim().split(".")[0].toLowerCase();

async function idsForHostname(name: string): Promise<string[]> {
  const url = new URL(`${BASE}/devices/queries/devices/v1`);
  url.searchParams.set("filter", `hostname:'${name}'`);
  url.searchParams.set("limit", "100");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Query failed for ${name}: ${res.status} ${await res.text()}`);
  return (await res.json()).resources ?? [];
}

async function detailsFor(ids: string[]): Promise<Host[]> {
  const out: Host[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const res = await fetch(`${BASE}/devices/entities/devices/v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: ids.slice(i, i + 500) }),
    });
    if (!res.ok) throw new Error(`Details failed: ${res.status} ${await res.text()}`);
    out.push(...((await res.json()).resources ?? []));
  }
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

export async function resolveHosts(submitted: string[]): Promise<Resolved> {
  const unique = [...new Set(submitted.map((s) => s.trim()).filter(Boolean))];

  const lookups = await mapLimit(unique, 5, async (raw) => ({
    submitted: raw,
    ids: await idsForHostname(shortName(raw)),
  }));

  const allIds = lookups.flatMap((l) => l.ids);
  const byId = new Map(
    (await detailsFor(allIds)).map((host) => [host.device_id, host] as const),
  );

  const hosts: Resolved["hosts"] = [];
  const notFound: string[] = [];

  for (const { submitted: raw, ids } of lookups) {
    if (ids.length === 0) {
      notFound.push(raw);
      continue;
    }
    for (const id of ids) {
      const host = byId.get(id);
      if (host) hosts.push({ ...host, submitted: raw });
    }
  }

  return { hosts, notFound };
}
```

Note what this does *not* do: it never swallows an error. A failed request throws, the step
exits non-zero, and the run is reported as failed. Catching per-host errors and continuing
would produce a report that looks complete while quietly omitting hosts.

Concurrency of 5 keeps you clear of rate limits without needing an explicit throttle step.
One hostname can legitimately map to several AIDs (a machine reimaged, or duplicate names
across sites) — surface all of them rather than taking `[0]`.

## Failure modes

- **`resources: []`** — no match. Expected; handle as data, not an error.
- **`403 access denied`** — the API client lacks the Hosts: Read scope. Fix the key's scopes; no code change will help.
- **`429`** — rate limited. Falcon returns `X-RateLimit-RetryAfter`; back off and retry, or lower concurrency.
- **`401`** — the connector's token exchange failed. Check the connector, not your code.
- **All hosts "not found"** — you are almost certainly querying FQDNs. See the FQDN trap above.

**"Not found in Falcon" is not the same as "no sensor installed."** A host may be absent
because it was renamed, was decommissioned and pruned, is a duplicate record, or is in a
different Falcon tenant. Before you report a machine as unprotected, cross-check with
`crowdstrike-asset-discovery`, and say "no record in Falcon" rather than "no EDR".

## When not to use this

- To find machines that have **never** had a sensor, use `crowdstrike-asset-discovery` — unmanaged assets do not appear in the Hosts API at all.
- To change a host's tags, use `crowdstrike-host-tagging`.
- For detections, incidents, or vulnerabilities, these are different API families (`/detects`, `/incidents`, `/spotlight`) not covered here.
