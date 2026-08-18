const BASE = "https://api.crowdstrike.com";
const STORE = "/storage/discover";

type Asset = {
  id: string;
  entity_type: string;
  hostname?: string;
  current_local_ip?: string;
  mac_address?: string;
  platform_name?: string;
  os_version?: string;
  confidence?: number;
  first_seen?: string;
  last_seen?: string;
  discovered_by?: string;
  discoverer_tags: string[];
};

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
    const pageIds: string[] = body.resources ?? [];
    ids.push(...pageIds);

    const total = body.meta?.pagination?.total ?? ids.length;
    if (pageIds.length === 0 || ids.length >= total) break;
    offset = ids.length;
  }

  return ids;
}

async function hydrate(ids: string[]): Promise<Asset[]> {
  const out: Asset[] = [];

  for (let i = 0; i < ids.length; i += 100) {
    const url = new URL(`${BASE}/discover/entities/hosts/v1`);
    for (const id of ids.slice(i, i + 100)) url.searchParams.append("ids", id);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Discover entities failed: ${res.status} ${await res.text()}`);

    for (const r of (await res.json()).resources ?? []) {
      out.push({
        id: r.id,
        entity_type: r.entity_type,
        hostname: r.hostname,
        current_local_ip: r.current_local_ip,
        mac_address: r.network_interfaces?.[0]?.mac_address,
        platform_name: r.platform_name,
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

function department(asset: Asset): string {
  const prefix = "FalconGroupingTags/";
  const tag = asset.discoverer_tags.find((t) => t.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : "UNATTRIBUTED";
}

const ids = await queryAssetIds(
  "entity_type:['unmanaged','unsupported']+last_seen_timestamp:>'now-24h'",
);
console.error(`Discover: ${ids.length} asset(s) seen in the last 24h`);

const assets = await hydrate(ids);
const unmanaged = assets.filter((a) => a.entity_type === "unmanaged");
const unsupported = assets.filter((a) => a.entity_type === "unsupported");

const byDepartment: Record<string, number> = {};
for (const a of unmanaged) {
  const key = department(a);
  byDepartment[key] = (byDepartment[key] ?? 0) + 1;
}

const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
const report = {
  generated_at: new Date().toISOString(),
  window: "last 24h",
  counts: {
    unmanaged: unmanaged.length,
    unsupported: unsupported.length,
    new_today: unmanaged.filter(
      (a) => a.first_seen && Date.parse(a.first_seen) >= dayAgo,
    ).length,
  },
  by_department: byDepartment,
  unmanaged,
  unsupported,
};

await Bun.write(`${STORE}/latest.json`, JSON.stringify(report));
await Bun.write(
  `${STORE}/history/${report.generated_at.slice(0, 10)}.json`,
  JSON.stringify(report.counts),
);

console.log(JSON.stringify(report.counts));
