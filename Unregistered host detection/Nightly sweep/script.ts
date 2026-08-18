const BASE = process.env.CROWD_STRIKE_URL ?? "https://api.crowdstrike.com";
const STORE = "/storage/falcon_coverage";

type Asset = {
  id: string;
  entity_type: string;
  hostname?: string;
  current_local_ip?: string;
  mac_address?: string;
  os_version?: string;
  platform_name?: string;
  confidence?: number;
  first_seen?: string;
  last_seen?: string;
  discovered_by?: string;
  discoverer_tags: string[];
  matches_managed_host?: boolean;
};

const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");

async function api(path: string, params: [string, string][]): Promise<any> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 403) {
    throw new Error(
      `403 from ${path} — the Falcon Discover module or the Assets: Read scope is not available to this key.`,
    );
  }
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function queryAssetIds(filter: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;

  for (let page = 0; page < 500; page++) {
    const body = await api("/discover/queries/hosts/v1", [
      ["filter", filter],
      ["limit", "100"],
      ["offset", String(offset)],
    ]);

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
    const body = await api(
      "/discover/entities/hosts/v1",
      ids.slice(i, i + 100).map((id) => ["ids", id] as [string, string]),
    );

    for (const r of body.resources ?? []) {
      out.push({
        id: r.id,
        entity_type: r.entity_type,
        hostname: r.hostname,
        current_local_ip: r.current_local_ip,
        mac_address: r.network_interfaces?.[0]?.mac_address?.toLowerCase(),
        os_version: r.os_version,
        platform_name: r.platform_name,
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

async function managedIdentifiers(): Promise<{ macs: Set<string>; hostnames: Set<string> }> {
  const macs = new Set<string>();
  const hostnames = new Set<string>();
  let offset: string | undefined;

  for (let page = 0; page < 200; page++) {
    const params: [string, string][] = [["limit", "5000"]];
    if (offset) params.push(["offset", offset]);

    const q = await api("/devices/queries/devices-scroll/v1", params);
    const aids: string[] = q.resources ?? [];
    if (aids.length === 0) break;

    for (let i = 0; i < aids.length; i += 100) {
      const body = await api(
        "/devices/entities/devices/v2",
        aids.slice(i, i + 100).map((id) => ["ids", id] as [string, string]),
      );
      for (const d of body.resources ?? []) {
        if (d.mac_address) macs.add(normalizeMac(String(d.mac_address)));
        if (d.hostname) hostnames.add(String(d.hostname).toLowerCase());
      }
    }

    offset = q.meta?.pagination?.offset;
    if (!offset) break;
  }

  return { macs, hostnames };
}

const assets = await hydrate(
  await queryAssetIds("entity_type:['unmanaged','unsupported']+last_seen_timestamp:>'now-24h'"),
);
console.error(`Discover returned ${assets.length} asset(s) seen in the last 24h`);

const managed = await managedIdentifiers();
for (const a of assets) {
  a.matches_managed_host =
    (a.mac_address !== undefined && managed.macs.has(normalizeMac(a.mac_address))) ||
    (a.hostname !== undefined && managed.hostnames.has(a.hostname.toLowerCase()));
}

const report = {
  generated_at: new Date().toISOString(),
  window: "last 24 hours",
  source: "Falcon Discover",
  managed_hosts_compared: managed.macs.size,
  unmanaged: assets.filter((a) => a.entity_type === "unmanaged"),
  unsupported: assets.filter((a) => a.entity_type === "unsupported"),
};

await Bun.write(`${STORE}/latest.json`, JSON.stringify(report, null, 2));

const gaps = report.unmanaged.filter((a) => !a.matches_managed_host).length;
console.error(`Wrote report: ${gaps} likely gap(s), ${report.unsupported.length} unsupported`);
console.log(JSON.stringify({ generated_at: report.generated_at, likely_gaps: gaps }));
