import { TOOLS } from "./tools";

const LATEST_PROTOCOL = "2025-06-18";
const SUPPORTED_PROTOCOLS = [LATEST_PROTOCOL, "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Read-only CrowdStrike Falcon coverage lookups for a security analyst.

Use falcon_find_host to establish whether a machine has a sensor on record, falcon_host_tags for
its grouping tags and host groups, and falcon_unmanaged_on_subnet for what the network sees on a
subnet with no sensor of its own. The first two read the Hosts API, the third reads Falcon
Discover — an unmanaged asset has no sensor and therefore no record in the Hosts API at all, so a
question about a specific machine and a question about a subnet are answered by different tools.

Relay the honesty caveats these tools return. "No record in Falcon" is not "no EDR", a sensor
last seen weeks ago is a gap even though the host is on record, and a passively-discovered
unmanaged asset may be a renamed, dual-homed or stale-sensor machine that is in fact managed.`;

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
};

const success = (id: Rpc["id"], result: object) => ({ jsonrpc: "2.0", id: id ?? null, result });

const failure = (id: Rpc["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

async function dispatch(request: Rpc, caller: string): Promise<object | null> {
  if (request.method?.startsWith("notifications/")) return null;

  switch (request.method) {
    case "initialize": {
      const requested = String(request.params?.protocolVersion ?? LATEST_PROTOCOL);
      return success(request.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "falcon-coverage", title: "CrowdStrike Falcon coverage", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }

    case "ping":
      return success(request.id, {});

    case "tools/list":
      return success(request.id, { tools: TOOLS.map((tool) => tool.definition) });

    case "tools/call": {
      const name = String(request.params?.name ?? "");
      const tool = TOOLS.find((candidate) => candidate.definition.name === name);
      if (!tool) {
        return failure(
          request.id,
          -32602,
          `Unknown tool: ${name}. This server exposes ${TOOLS.map((t) => t.definition.name).join(", ")}.`,
        );
      }

      // A tool that fails is a successful JSON-RPC call carrying isError, per the MCP spec — the
      // calling model needs the message to correct itself, and the transport itself is fine.
      try {
        const structuredContent = await tool.handler(request.params?.arguments ?? {});
        console.error(`${caller} called ${name}`);
        return success(request.id, {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${caller} called ${name} — failed: ${message}`);
        return success(request.id, {
          content: [{ type: "text", text: `${name} failed: ${message}` }],
          isError: true,
        });
      }
    }

    default:
      return failure(request.id, -32601, `Method not found: ${request.method}`);
  }
}

function respond(status: string, body: string, extraHeaders: string[] = []) {
  const bytes = new TextEncoder().encode(body);

  process.stdout.write(
    [
      `HTTP/1.1 ${status}`,
      "Content-Type: application/json",
      `Content-Length: ${bytes.length}`,
      "Cache-Control: no-store",
      ...extraHeaders,
      "",
      "",
    ].join("\r\n"),
  );

  if (bytes.length > 0) process.stdout.write(bytes);
}

const raw = await Bun.stdin.text();
const separator = raw.match(/\r?\n\r?\n/);
const bodyAt = separator?.index === undefined ? -1 : separator.index + separator[0].length;
const head = bodyAt === -1 ? raw : raw.slice(0, separator!.index);
const body = bodyAt === -1 ? "" : raw.slice(bodyAt);

const lines = head.split(/\r?\n/);
const method = lines[0]?.split(" ")[0]?.toUpperCase() ?? "POST";

const headers = new Map<string, string>();
for (const line of lines.slice(1)) {
  const colon = line.indexOf(":");
  if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
}

// 3B strips the bearer at the route boundary, so the only identity available is the email of the
// person whose consent minted the token.
const caller = headers.get("x-3b-authenticated-email") ?? "anonymous";

if (method !== "POST") {
  respond(
    "405 Method Not Allowed",
    JSON.stringify(failure(null, -32000, "This MCP endpoint is POST-only; it does not offer a server-initiated SSE stream.")),
    ["Allow: POST"],
  );
} else {
  let parsed: Rpc | Rpc[];
  try {
    parsed = JSON.parse(body);
  } catch {
    respond("400 Bad Request", JSON.stringify(failure(null, -32700, "Parse error: body is not valid JSON.")));
    process.exit(0);
  }

  const batch = Array.isArray(parsed) ? parsed : [parsed];
  const replies = (await Promise.all(batch.map((request) => dispatch(request, caller)))).filter(
    (reply) => reply !== null,
  );

  if (replies.length === 0) respond("202 Accepted", "");
  else respond("200 OK", JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
}
