const BASE = process.env.CROWD_STRIKE_URL ?? "https://api.crowdstrike.com";

export const quote = (value: string) => `'${value.replace(/['\\]/g, "\\$&")}'`;

export const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");

export class FalconError extends Error {
  readonly status: number;

  constructor(status: number, path: string, body: string) {
    const hint =
      status !== 403
        ? ""
        : path.startsWith("/discover/")
          ? " The Falcon Discover module or the Assets: Read scope is not available to this connector's key — a licensing or scope change, not a query problem."
          : " The connector's key is missing a required scope (Hosts: Read for device lookups, Host Group: Read for group names).";

    super(`Falcon ${path} returned ${status}.${hint} ${body.slice(0, 400)}`);
    this.name = "FalconError";
    this.status = status;
  }
}

async function call(path: string, params: [string, string][] = [], init?: RequestInit) {
  const url = new URL(BASE + path);
  for (const [key, value] of params) url.searchParams.append(key, value);

  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });

  const text = await res.text();
  if (!res.ok) throw new FalconError(res.status, path, text);

  return text === "" ? {} : JSON.parse(text);
}

export type Device = {
  device_id: string;
  hostname?: string;
  platform_name?: string;
  os_version?: string;
  product_type_desc?: string;
  status?: string;
  first_seen?: string;
  last_seen?: string;
  local_ip?: string;
  external_ip?: string;
  connection_ip?: string;
  mac_address?: string;
  serial_number?: string;
  agent_version?: string;
  reduced_functionality_mode?: string;
  last_login_user?: string;
  tags?: string[];
  groups?: string[];
};

export type DiscoverAsset = {
  id: string;
  entity_type: string;
  hostname?: string;
  current_local_ip?: string;
  mac_addresses: string[];
  os_version?: string;
  platform_name?: string;
  confidence?: number;
  first_seen?: string;
  last_seen?: string;
  discovered_by?: string;
  discoverer_tags: string[];
};

export async function queryDeviceIds(filter: string, cap = 5000) {
  const ids: string[] = [];
  let total = 0;

  for (let page = 0; page < 20; page++) {
    const body = await call("/devices/queries/devices/v1", [
      ["filter", filter],
      ["limit", String(Math.min(5000, cap - ids.length))],
      ["offset", String(ids.length)],
    ]);

    const found: string[] = body.resources ?? [];
    ids.push(...found);
    total = body.meta?.pagination?.total ?? ids.length;

    if (found.length === 0 || ids.length >= total || ids.length >= cap) break;
  }

  return { ids, total };
}

export async function deviceDetails(ids: string[]): Promise<Device[]> {
  const out: Device[] = [];

  for (let i = 0; i < ids.length; i += 500) {
    const body = await call("/devices/entities/devices/v2", [], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids.slice(i, i + 500) }),
    });
    out.push(...(body.resources ?? []));
  }

  return out;
}

export async function hostGroupNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  for (let i = 0; i < ids.length; i += 100) {
    const body = await call(
      "/devices/entities/host-groups/v1",
      ids.slice(i, i + 100).map((id) => ["ids", id] as [string, string]),
    );
    for (const group of body.resources ?? []) {
      if (group.id) names.set(group.id, group.name ?? group.id);
    }
  }

  return names;
}

export type IdentifierKind = "device_id" | "ip_address" | "mac_address" | "serial_number" | "hostname";

const AID = /^[0-9a-f]{32}$/i;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const MAC = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;

function classify(value: string): IdentifierKind {
  if (AID.test(value)) return "device_id";
  if (IPV4.test(value) && value.split(".").every((o) => Number(o) <= 255)) return "ip_address";
  if (MAC.test(value)) return "mac_address";
  return "hostname";
}

// One query per candidate value rather than FQL's `field:[a,b]` OR-list. Verified against the live
// tenant: `hostname:'ec2amaz-m858lde'` matches the host stored as EC2AMAZ-M858LDE, but
// `hostname:['ec2amaz-m858lde']` matches nothing — the list form compares case-sensitively while
// the single-value form does not. Folding the candidates into one list is the faster query and the
// wrong answer for anything an analyst did not type in the tenant's exact case.
async function anyOf(field: string, values: string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const value of [...new Set(values)]) {
    for (const id of (await queryDeviceIds(`${field}:${quote(value)}`, 500)).ids) ids.add(id);
  }
  return [...ids];
}

// Falcon has no get-host-by-name endpoint, and its hostname index holds the short name, so an
// FQDN pasted out of a CMDB matches nothing unless it is stripped at the first dot.
export async function resolveIdentifier(raw: string): Promise<{ kind: IdentifierKind; ids: string[] }> {
  const value = raw.trim();
  const kind = classify(value);

  if (kind === "device_id") return { kind, ids: [value.toLowerCase()] };

  if (kind === "ip_address") {
    const ids = new Set<string>();
    for (const field of ["local_ip", "external_ip"]) {
      for (const id of (await queryDeviceIds(`${field}:${quote(value)}`, 500)).ids) ids.add(id);
    }
    return { kind, ids: [...ids] };
  }

  if (kind === "mac_address") {
    const pairs = normalizeMac(value).match(/.{2}/g) ?? [];
    return { kind, ids: await anyOf("mac_address", [pairs.join("-"), pairs.join(":")]) };
  }

  const short = value.split(".")[0]!;
  const byHostname = await anyOf("hostname", short === value ? [value] : [short, value]);
  if (byHostname.length > 0) return { kind: "hostname", ids: byHostname };

  const bySerial = await queryDeviceIds(`serial_number:${quote(value)}`, 500);
  return bySerial.ids.length > 0
    ? { kind: "serial_number", ids: bySerial.ids }
    : { kind: "hostname", ids: [] };
}

export async function discoverAssetIds(filter: string, cap: number) {
  const ids: string[] = [];
  let total = 0;

  for (let page = 0; page < 100; page++) {
    const body = await call("/discover/queries/hosts/v1", [
      ["filter", filter],
      ["limit", "100"],
      ["offset", String(ids.length)],
    ]);

    const found: string[] = body.resources ?? [];
    ids.push(...found);
    total = body.meta?.pagination?.total ?? ids.length;

    if (found.length === 0 || ids.length >= total || ids.length >= cap) break;
  }

  return { ids: ids.slice(0, cap), total };
}

export async function discoverAssets(ids: string[]): Promise<DiscoverAsset[]> {
  const out: DiscoverAsset[] = [];

  for (let i = 0; i < ids.length; i += 100) {
    const body = await call(
      "/discover/entities/hosts/v1",
      ids.slice(i, i + 100).map((id) => ["ids", id] as [string, string]),
    );

    for (const asset of body.resources ?? []) {
      out.push({
        id: asset.id,
        entity_type: asset.entity_type,
        hostname: asset.hostname,
        current_local_ip: asset.current_local_ip,
        mac_addresses: (asset.network_interfaces ?? [])
          .map((nic: { mac_address?: string }) => nic.mac_address)
          .filter((mac: string | undefined): mac is string => typeof mac === "string"),
        os_version: asset.os_version,
        platform_name: asset.platform_name,
        confidence: asset.confidence,
        first_seen: asset.first_seen_timestamp,
        last_seen: asset.last_seen_timestamp,
        discovered_by: asset.last_discoverer_hostname,
        discoverer_tags: asset.discoverer_tags ?? [],
      });
    }
  }

  return out;
}
