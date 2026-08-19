import {
  deviceDetails,
  discoverAssetIds,
  discoverAssets,
  FalconError,
  hostGroupNames,
  normalizeMac,
  queryDeviceIds,
  quote,
  resolveIdentifier,
  type Device,
} from "./falcon";
import { parseSubnet } from "./subnet";

const FALCON_TAG = "FalconGroupingTags/";
const SENSOR_TAG = "SensorGroupingTags/";

const ASSET_ANALYSIS_CAP = 1000;
const MANAGED_COMPARISON_CAP = 2000;

const SINCE = /^(now-\d{1,4}[mhdw]|\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?)$/;

const DISCOVER_CAVEAT =
  "Discover identifies these assets by passive network observation, so read them as 'seen on the network with no matching Falcon sensor', not as 'has no EDR'. Stale sensors, renamed machines, dual-homed hosts, NAT/VPN addresses and short DHCP leases all surface here as false gaps — matches_managed_host is the cross-check against the Hosts API by MAC and short hostname.";

function daysSince(iso: string | undefined): number | null {
  if (iso === undefined) return null;

  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : Math.floor((Date.now() - parsed) / 86_400_000);
}

function splitTags(tags: string[] = []) {
  return {
    falcon_grouping_tags: tags.filter((t) => t.startsWith(FALCON_TAG)).map((t) => t.slice(FALCON_TAG.length)),
    sensor_grouping_tags: tags.filter((t) => t.startsWith(SENSOR_TAG)).map((t) => t.slice(SENSOR_TAG.length)),
    other_tags: tags.filter((t) => !t.startsWith(FALCON_TAG) && !t.startsWith(SENSOR_TAG)),
  };
}

function summarize(device: Device) {
  return {
    device_id: device.device_id,
    hostname: device.hostname ?? null,
    platform_name: device.platform_name ?? null,
    os_version: device.os_version ?? null,
    product_type: device.product_type_desc ?? null,
    containment_status: device.status ?? null,
    first_seen: device.first_seen ?? null,
    last_seen: device.last_seen ?? null,
    days_since_last_seen: daysSince(device.last_seen),
    local_ip: device.local_ip ?? null,
    external_ip: device.external_ip ?? null,
    connection_ip: device.connection_ip ?? null,
    mac_address: device.mac_address ?? null,
    serial_number: device.serial_number ?? null,
    agent_version: device.agent_version ?? null,
    reduced_functionality_mode: device.reduced_functionality_mode ?? null,
    last_login_user: device.last_login_user ?? null,
    ...splitTags(device.tags),
  };
}

// A device record carries host group ids, not names; resolving them needs a scope the lookup
// itself doesn't, so a refusal is reported in the result rather than failing the whole call.
async function resolveGroups(devices: Device[]) {
  const ids = [...new Set(devices.flatMap((d) => d.groups ?? []))];
  if (ids.length === 0) return { names: new Map<string, string>(), note: null };

  try {
    return { names: await hostGroupNames(ids), note: null };
  } catch (err) {
    if (err instanceof FalconError && (err.status === 403 || err.status === 404)) {
      return {
        names: new Map<string, string>(),
        note: "Host group names could not be resolved — the connector's key lacks the Host Group: Read scope, so only group ids are shown.",
      };
    }
    throw err;
  }
}

const stringOrNull = { type: ["string", "null"] };
const intOrNull = { type: ["integer", "null"] };
const stringArray = { type: "array", items: { type: "string" } };

const DEVICE_SCHEMA = {
  type: "object",
  properties: {
    device_id: { type: "string", description: "The AID — the only durable identifier for follow-up calls." },
    hostname: stringOrNull,
    platform_name: stringOrNull,
    os_version: stringOrNull,
    product_type: stringOrNull,
    containment_status: { ...stringOrNull, description: "Network-containment state, not sensor health." },
    first_seen: stringOrNull,
    last_seen: stringOrNull,
    days_since_last_seen: {
      ...intOrNull,
      description: "A host present in Falcon but unseen for weeks is a coverage gap, not coverage.",
    },
    local_ip: stringOrNull,
    external_ip: stringOrNull,
    connection_ip: stringOrNull,
    mac_address: stringOrNull,
    serial_number: stringOrNull,
    agent_version: stringOrNull,
    reduced_functionality_mode: stringOrNull,
    last_login_user: { ...stringOrNull, description: "Last interactive user — the practical owner of a laptop." },
    falcon_grouping_tags: stringArray,
    sensor_grouping_tags: stringArray,
    other_tags: stringArray,
  },
  required: ["device_id", "hostname", "last_seen", "days_since_last_seen"],
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
  annotations: object;
};

export type Tool = {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<object>;
};

const findHost: Tool = {
  definition: {
    name: "falcon_find_host",
    title: "Is this host in Falcon?",
    description:
      "Look a single machine up in CrowdStrike Falcon and report whether it has a sensor on record. Accepts a hostname (short or fully-qualified), a 32-character Falcon device ID (AID), an IPv4 address, a MAC address, or a serial number — the identifier type is detected, and a fully-qualified name is stripped to the short name Falcon actually indexes. Returns the matching device records with last-seen age, sensor version, containment status, owner and tags. Absence means 'no record in Falcon', which is not the same as 'no sensor installed' — a renamed, decommissioned or other-tenant machine also comes back empty; use falcon_unmanaged_on_subnet to see whether the network sees it without a sensor.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["identifier"],
      properties: {
        identifier: {
          type: "string",
          minLength: 1,
          description: "Hostname, FQDN, Falcon device ID, IPv4 address, MAC address or serial number, e.g. 'LAPTOP-4471', 'web01.corp.example.com', '10.4.16.23'.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string" },
        interpreted_as: {
          type: "string",
          enum: ["device_id", "ip_address", "mac_address", "serial_number", "hostname"],
        },
        in_falcon: { type: "boolean" },
        match_count: { type: "integer", description: "One name can legitimately map to several AIDs — a reimaged machine, or duplicate names across sites." },
        devices: { type: "array", items: DEVICE_SCHEMA },
        host_groups_note: stringOrNull,
        note: stringOrNull,
      },
      required: ["identifier", "interpreted_as", "in_falcon", "match_count", "devices"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  handler: async (args) => {
    const identifier = String(args.identifier ?? "").trim();
    if (identifier === "") throw new Error("identifier is required and cannot be blank.");

    const { kind, ids } = await resolveIdentifier(identifier);
    const devices = await deviceDetails(ids);

    const stale = devices.filter((d) => (daysSince(d.last_seen) ?? 0) > 30).length;

    return {
      identifier,
      interpreted_as: kind,
      in_falcon: devices.length > 0,
      match_count: devices.length,
      devices: devices.map(summarize),
      note:
        devices.length === 0
          ? `No Falcon device matches ${identifier}. Report this as "no record in Falcon" rather than "no EDR" — the machine may have been renamed, decommissioned and pruned, or live in another Falcon tenant. Run falcon_unmanaged_on_subnet against its subnet to see whether the network sees it with no sensor.`
          : stale > 0
            ? `${stale} of ${devices.length} matching record(s) have not been seen for over 30 days. A sensor that stopped reporting is a coverage gap even though the host is on record.`
            : null,
    };
  },
};

const hostTags: Tool = {
  definition: {
    name: "falcon_host_tags",
    title: "What tags does this host have?",
    description:
      "List the tags and host groups a machine carries in CrowdStrike Falcon. Falcon grouping tags (department, owner, asset class, risk) are returned separately from sensor grouping tags, which are baked in when the sensor is installed and cannot be changed through the API. Host group ids are resolved to names where the connector's key allows it. Accepts the same identifiers as falcon_find_host.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["identifier"],
      properties: {
        identifier: {
          type: "string",
          minLength: 1,
          description: "Hostname, FQDN, Falcon device ID, IPv4 address, MAC address or serial number.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string" },
        interpreted_as: { type: "string" },
        in_falcon: { type: "boolean" },
        devices: {
          type: "array",
          items: {
            type: "object",
            properties: {
              device_id: { type: "string" },
              hostname: stringOrNull,
              last_seen: stringOrNull,
              falcon_grouping_tags: {
                ...stringArray,
                description: "Prefix stripped for reading; writes back to Falcon must re-add FalconGroupingTags/.",
              },
              sensor_grouping_tags: {
                ...stringArray,
                description: "Set at sensor install time. Changing one needs a reinstall or a sensor update policy, not an API call.",
              },
              other_tags: stringArray,
              host_groups: {
                type: "array",
                items: {
                  type: "object",
                  properties: { id: { type: "string" }, name: stringOrNull },
                  required: ["id", "name"],
                },
              },
            },
            required: ["device_id", "hostname", "falcon_grouping_tags", "sensor_grouping_tags", "host_groups"],
          },
        },
        host_groups_note: stringOrNull,
        note: stringOrNull,
      },
      required: ["identifier", "interpreted_as", "in_falcon", "devices"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  handler: async (args) => {
    const identifier = String(args.identifier ?? "").trim();
    if (identifier === "") throw new Error("identifier is required and cannot be blank.");

    const { kind, ids } = await resolveIdentifier(identifier);
    const devices = await deviceDetails(ids);
    const groups = await resolveGroups(devices);

    return {
      identifier,
      interpreted_as: kind,
      in_falcon: devices.length > 0,
      devices: devices.map((device) => ({
        device_id: device.device_id,
        hostname: device.hostname ?? null,
        last_seen: device.last_seen ?? null,
        ...splitTags(device.tags),
        host_groups: (device.groups ?? []).map((id) => ({ id, name: groups.names.get(id) ?? null })),
      })),
      host_groups_note: groups.note,
      note:
        devices.length === 0
          ? `No Falcon device matches ${identifier}, so it carries no tags. Confirm the machine is on record with falcon_find_host first.`
          : null,
    };
  },
};

const unmanagedOnSubnet: Tool = {
  definition: {
    name: "falcon_unmanaged_on_subnet",
    title: "What unmanaged assets are on this subnet?",
    description:
      "List the assets Falcon Discover has seen on a given subnet that have no Falcon sensor of their own — the EDR coverage gap. Sensored hosts observe their neighbours passively, so these assets never appear in the Hosts API at all. Each candidate is cross-checked against the Hosts API by MAC and short hostname, and matches_managed_host marks the ones that are already managed and only look unmanaged. Optionally includes 'unsupported' assets — printers, switches, cameras, appliances that cannot run a sensor — which are excluded by default so the gap count stays meaningful. Requires the Falcon Discover module and the Assets: Read scope.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["subnet"],
      properties: {
        subnet: {
          type: "string",
          minLength: 3,
          description: "CIDR ('10.4.0.0/16'), an octet prefix ('10.4.*'), or a single IPv4 address. Prefix lengths /8 to /32 are accepted, and any range is bounded exactly — a /20 queries its real first and last address, not a wider /16.",
        },
        since: {
          type: "string",
          pattern: "^(now-\\d{1,4}[mhdw]|\\d{4}-\\d{2}-\\d{2}(T[0-9:.]+Z?)?)$",
          default: "now-7d",
          description: "Only assets last seen since this point: a relative window ('now-24h', 'now-30d') or an ISO 8601 date. Defaults to now-7d.",
        },
        include_unsupported: {
          type: "boolean",
          default: false,
          description: "Include assets Falcon classifies as unable to run a sensor. Off by default — they inflate the gap count with network gear.",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          default: 50,
          description: "How many assets to return. Counts always cover everything analyzed; likely gaps are returned first.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        subnet: { type: "string", description: "The range as interpreted, normalized." },
        since: { type: "string" },
        include_unsupported: { type: "boolean" },
        source: { type: "string" },
        counts: {
          type: "object",
          properties: {
            matching_the_query: { type: "integer" },
            analyzed: { type: "integer" },
            in_subnet: { type: "integer" },
            unmanaged: { type: "integer" },
            unsupported: { type: "integer" },
            already_managed: { type: "integer" },
            likely_gaps: { type: "integer" },
          },
          required: ["matching_the_query", "analyzed", "in_subnet", "unmanaged", "unsupported", "already_managed", "likely_gaps"],
        },
        managed_hosts_compared: { type: "integer" },
        returned: { type: "integer" },
        truncated: { type: "boolean" },
        truncation_note: stringOrNull,
        assets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              entity_type: { type: "string", enum: ["unmanaged", "unsupported"] },
              hostname: stringOrNull,
              current_local_ip: stringOrNull,
              mac_address: stringOrNull,
              os_version: stringOrNull,
              platform_name: stringOrNull,
              confidence: { ...intOrNull, description: "Low confidence means the OS fingerprint is a hint, not a fact." },
              first_seen: stringOrNull,
              last_seen: stringOrNull,
              discovered_by: { ...stringOrNull, description: "The sensored host that observed this asset — tells you where on the network it lives." },
              discoverer_tags: {
                ...stringArray,
                description: "Grouping tags of the observing host. A routing hint for who should go look, not an ownership assertion.",
              },
              matches_managed_host: { type: "boolean" },
            },
            required: ["id", "entity_type", "current_local_ip", "last_seen", "matches_managed_host"],
          },
        },
        caveat: { type: "string" },
      },
      required: ["subnet", "since", "include_unsupported", "source", "counts", "managed_hosts_compared", "returned", "truncated", "assets", "caveat"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  handler: async (args) => {
    const subnet = parseSubnet(String(args.subnet ?? ""));

    const since = args.since === undefined ? "now-7d" : String(args.since);
    if (!SINCE.test(since)) {
      throw new Error(`since must be a relative window like 'now-24h' or an ISO 8601 date, not ${JSON.stringify(since)}.`);
    }

    const includeUnsupported = args.include_unsupported === true;
    const maxResults = Math.min(500, Math.max(1, Number(args.max_results ?? 50)));

    const entityFilter = includeUnsupported ? "entity_type:['unmanaged','unsupported']" : "entity_type:'unmanaged'";
    const inRange = (field: string) =>
      `${field}:>=${quote(subnet.first)}+${field}:<=${quote(subnet.last)}`;

    const query = await discoverAssetIds(
      `${entityFilter}+${inRange("current_local_ip")}+last_seen_timestamp:>${quote(since)}`,
      ASSET_ANALYSIS_CAP,
    );

    const candidates = await discoverAssets(query.ids);
    const assets = candidates.filter((asset) => subnet.contains(asset.current_local_ip));

    const managed =
      assets.length === 0
        ? { ids: [], total: 0 }
        : await queryDeviceIds(inRange("local_ip"), MANAGED_COMPARISON_CAP);
    const managedDevices = await deviceDetails(managed.ids);

    const managedMacs = new Set(
      managedDevices.flatMap((d) => (d.mac_address === undefined ? [] : [normalizeMac(d.mac_address)])),
    );
    const managedHostnames = new Set(
      managedDevices.flatMap((d) => (d.hostname === undefined ? [] : [d.hostname.toLowerCase().split(".")[0]!])),
    );

    const rows = assets
      .map((asset) => ({
        id: asset.id,
        entity_type: asset.entity_type,
        hostname: asset.hostname ?? null,
        current_local_ip: asset.current_local_ip ?? null,
        mac_address: asset.mac_addresses[0] ?? null,
        os_version: asset.os_version ?? null,
        platform_name: asset.platform_name ?? null,
        confidence: asset.confidence ?? null,
        first_seen: asset.first_seen ?? null,
        last_seen: asset.last_seen ?? null,
        discovered_by: asset.discovered_by ?? null,
        discoverer_tags: asset.discoverer_tags,
        matches_managed_host:
          asset.mac_addresses.some((mac) => managedMacs.has(normalizeMac(mac))) ||
          (asset.hostname !== undefined && managedHostnames.has(asset.hostname.toLowerCase().split(".")[0]!)),
      }))
      .sort((a, b) => {
        const gap = Number(a.matches_managed_host) - Number(b.matches_managed_host);
        return gap !== 0 ? gap : String(b.last_seen ?? "").localeCompare(String(a.last_seen ?? ""));
      });

    const unmanaged = rows.filter((r) => r.entity_type === "unmanaged");
    const alreadyManaged = rows.filter((r) => r.matches_managed_host).length;

    const managedTruncated = managed.total > managedDevices.length;
    const truncated = query.total > candidates.length || rows.length > maxResults || managedTruncated;
    const truncationNote = !truncated
      ? null
      : [
          query.total > candidates.length
            ? `Discover matched ${query.total} asset(s); only the first ${candidates.length} were analyzed, so the counts below are a floor. Narrow the subnet or the since window for a complete picture.`
            : null,
          rows.length > maxResults
            ? `${rows.length} asset(s) are in range and ${maxResults} were returned, likely gaps first.`
            : null,
          managedTruncated
            ? `The managed-host comparison covered ${managedDevices.length} of ${managed.total} sensored hosts in range, so matches_managed_host may under-report.`
            : null,
        ]
          .filter(Boolean)
          .join(" ");

    return {
      subnet: subnet.label,
      since,
      include_unsupported: includeUnsupported,
      source: "Falcon Discover",
      counts: {
        matching_the_query: query.total,
        analyzed: candidates.length,
        in_subnet: rows.length,
        unmanaged: unmanaged.length,
        unsupported: rows.length - unmanaged.length,
        already_managed: alreadyManaged,
        likely_gaps: unmanaged.filter((r) => !r.matches_managed_host).length,
      },
      managed_hosts_compared: managedDevices.length,
      returned: Math.min(rows.length, maxResults),
      truncated,
      truncation_note: truncationNote,
      assets: rows.slice(0, maxResults),
      caveat: DISCOVER_CAVEAT,
    };
  },
};

export const TOOLS: Tool[] = [findHost, hostTags, unmanagedOnSubnet];
