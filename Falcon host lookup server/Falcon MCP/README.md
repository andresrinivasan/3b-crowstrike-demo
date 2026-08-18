A remote MCP server exposing CrowdStrike Falcon host coverage and tagging as three read-only tools.

**Trigger:** HTTP route `POST /falcon/mcp` (`route_auth = "space"`). 3B handles the MCP OAuth handshake at the platform boundary, so clients just point at the route URL — the step never sees a bearer token.

**Tools**

| Tool | Purpose |
| --- | --- |
| `falcon_check_host` | Is this hostname or device ID in Falcon? Returns matching device records. |
| `falcon_missing_hosts` | Given a list of hostnames, return the ones with no Falcon sensor. |
| `falcon_host_tags` | Tags and host groups for a host. |

**External API:** CrowdStrike Falcon — `POST /devices/queries/devices/v1` (hostname search) and `POST /devices/entities/devices/v2` (device details, including `tags` and `groups`). Auth comes from the CrowdStrike connector; set `FALCON_BASE_URL` if the tenant is on a non-US-1 cloud (default `https://api.crowdstrike.com`).

Hostname matching tries the value as given, lowercased, and with the domain stripped, so short names and FQDNs both resolve.

Implementation: [script.ts](script.ts). Contract: [api.json](api.json).
