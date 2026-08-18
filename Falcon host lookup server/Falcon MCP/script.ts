const BASE = process.env.FALCON_BASE_URL ?? "https://api.crowdstrike.com";

type Device = {
  device_id: string;
  hostname?: string;
  tags?: string[];
  groups?: string[];
  platform_name?: string;
  os_version?: string;
  status?: string;
  last_seen?: string;
  local_ip?: string;
  external_ip?: string;
  serial_number?: string;
  agent_version?: string;
};

async function falcon<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Falcon ${init?.method ?? "GET"} ${path} failed with ${res.status}: ${text.slice(0, 800)}`);
  }
  return JSON.parse(text) as T;
}

function quote(value: string): string {
  return `'${value.replace(/['\\]/g, "\\$&")}'`;
}

async function findDeviceIds(filter: string, limit = 100): Promise<string[]> {
  const params = new URLSearchParams({ filter, limit: String(limit) });
  const body = await falcon<{ resources: string[] | null }>(`/devices/queries/devices/v1?${params}`);
  return body.resources ?? [];
}

async function getDevices(ids: string[]): Promise<Device[]> {
  if (ids.length === 0) return [];
  const out: Device[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const body = await falcon<{ resources: Device[] | null }>("/devices/entities/devices/v2", {
      method: "POST",
      body: JSON.stringify({ ids: ids.slice(i, i + 100) }),
    });
    out.push(...(body.resources ?? []));
  }
  return out;
}

async function lookupHost(host: string): Promise<Device[]> {
  const value = host.trim();
  const isIdentifier = /^[0-9a-f]{32}$/i.test(value);
  const filter = isIdentifier
    ? `device_id:${quote(value)}`
    : `hostname:${quote(value)},hostname:${quote(value.toLowerCase())},hostname:${quote(value.split(".")[0]!)}`;
  const ids = isIdentifier ? [value] : await findDeviceIds(filter);
  return getDevices(ids);
}

function summarize(d: Device) {
  return {
    device_id: d.device_id,
    hostname: d.hostname ?? null,
    platform: d.platform_name ?? null,
    os_version: d.os_version ?? null,
    status: d.status ?? null,
    last_seen: d.last_seen ?? null,
    local_ip: d.local_ip ?? null,
    external_ip: d.external_ip ?? null,
    serial_number: d.serial_number ?? null,
    agent_version: d.agent_version ?? null,
    tags: d.tags ?? [],
    host_groups: d.groups ?? [],
  };
}

const tools = [
  {
    name: "falcon_check_host",
    description:
      "Check whether a single host is present in CrowdStrike Falcon. Accepts a hostname (FQDN or short name) or a 32-character Falcon device ID. Returns whether it was found plus the matching device records (status, last seen, IPs, tags, host groups).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["host"],
      properties: {
        host: { type: "string", minLength: 1, description: "Hostname or Falcon device ID, e.g. 'LAPTOP-1234', 'web01.corp.example.com'" },
      },
    },
    annotations: { title: "Check host in Falcon", readOnlyHint: true, openWorldHint: true },
    handler: async (args: { host: string }) => {
      const devices = await lookupHost(args.host);
      return { host: args.host, in_falcon: devices.length > 0, match_count: devices.length, devices: devices.map(summarize) };
    },
  },
  {
    name: "falcon_missing_hosts",
    description:
      "Given a list of hostnames (for example from an asset inventory or CMDB), return which ones have no sensor in CrowdStrike Falcon. Use this to find coverage gaps. Returns missing hosts, found hosts with their device IDs, and counts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["hosts"],
      properties: {
        hosts: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: { type: "string", minLength: 1 },
          description: "Hostnames to check, e.g. ['web01', 'db02.corp.example.com']",
        },
      },
    },
    annotations: { title: "Find hosts missing from Falcon", readOnlyHint: true, openWorldHint: true },
    handler: async (args: { hosts: string[] }) => {
      const missing: string[] = [];
      const found: { host: string; device_ids: string[] }[] = [];
      for (const host of args.hosts) {
        const devices = await lookupHost(host);
        if (devices.length === 0) missing.push(host);
        else found.push({ host, device_ids: devices.map((d) => d.device_id) });
      }
      return { checked: args.hosts.length, missing_count: missing.length, missing_hosts: missing, found_hosts: found };
    },
  },
  {
    name: "falcon_host_tags",
    description:
      "List the tags a host carries in CrowdStrike Falcon — sensor grouping tags and Falcon grouping tags — along with its host group names. Accepts a hostname or a Falcon device ID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["host"],
      properties: { host: { type: "string", minLength: 1, description: "Hostname or Falcon device ID" } },
    },
    annotations: { title: "Get host tags", readOnlyHint: true, openWorldHint: true },
    handler: async (args: { host: string }) => {
      const devices = await lookupHost(args.host);
      if (devices.length === 0) {
        return { host: args.host, in_falcon: false, message: `No Falcon device matches ${args.host}. Verify the hostname, or use falcon_missing_hosts to check a batch.` };
      }
      return {
        host: args.host,
        in_falcon: true,
        devices: devices.map((d) => ({
          device_id: d.device_id,
          hostname: d.hostname ?? null,
          tags: d.tags ?? [],
          host_groups: d.groups ?? [],
        })),
      };
    },
  },
];

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: any };

async function handle(req: Rpc): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: "2.0", id: req.id, result });
  switch (req.method) {
    case "initialize":
      return reply({
        protocolVersion: req.params?.protocolVersion === "2024-11-05" ? "2024-11-05" : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "falcon-hosts", version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "tools/list":
      return reply({ tools: tools.map(({ handler, ...t }) => t) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === req.params?.name);
      if (!tool) {
        return { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: `Unknown tool: ${req.params?.name}` } };
      }
      try {
        const structuredContent = await tool.handler(req.params?.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent });
      } catch (err) {
        return reply({ content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true });
      }
    }
    default:
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

function respond(status: string, body: string) {
  const bytes = new TextEncoder().encode(body);
  process.stdout.write(
    `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\n\r\n`,
  );
  process.stdout.write(bytes);
}

const raw = await Bun.stdin.text();
const separator = raw.indexOf("\r\n\r\n");
const head = separator === -1 ? raw : raw.slice(0, separator);
const body = separator === -1 ? "" : raw.slice(separator + 4);
const method = head.split(/\r?\n/, 1)[0]?.split(" ")[0]?.toUpperCase() ?? "POST";

if (method !== "POST") {
  respond("405 Method Not Allowed", JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Use POST with a JSON-RPC body" } }));
} else {
  let parsed: Rpc | Rpc[];
  try {
    parsed = JSON.parse(body);
  } catch {
    respond("400 Bad Request", JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
    process.exit(0);
  }
  const batch = Array.isArray(parsed) ? parsed : [parsed];
  const results = (await Promise.all(batch.map(handle))).filter((r) => r !== null);
  if (results.length === 0) respond("202 Accepted", "");
  else respond("200 OK", JSON.stringify(Array.isArray(parsed) ? results : results[0]));
}
