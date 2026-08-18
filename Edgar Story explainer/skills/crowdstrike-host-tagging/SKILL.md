---
name: crowdstrike-host-tagging
description: Apply or remove CrowdStrike Falcon grouping tags on hosts — department/owner codes, asset classification, risk or compliance labels. Use whenever a task involves tagging, retagging, or untagging a machine in Falcon, labelling endpoints by owning team, syncing asset classifications from a CMDB or spreadsheet into CrowdStrike, or bulk-applying FalconGroupingTags — even if "PATCH", "grouping tag", or "device_ids" is never said. Covers the prefix rule, batching, partial-success handling, and why you build one tag array instead of branching per tag count.
---

# CrowdStrike Falcon: host tagging

Grouping tags are how an organization records *who owns this machine* and *how sensitive it
is*, inside Falcon. Once set, they drive host groups, Fusion workflows, Spotlight report
scoping, and incident-response routing — which is why getting them right matters more than
the API call suggests.

## The endpoint

```
PATCH /devices/entities/devices/tags/v1
```

```json
{
  "device_ids": ["a1b2c3…", "d4e5f6…"],
  "action": "add",
  "tags": ["FalconGroupingTags/SECOPS", "FalconGroupingTags/ASSET_SERVER"]
}
```

`action` is `"add"` or `"remove"`. Required API scope: **Hosts: Write** — a read-only key
returns `403` here even though it can list the same hosts.

Write plain requests with no `Authorization` header and attach a connector; call
`connectStepToApp` with
`targetUrl: "https://api.crowdstrike.com/devices/entities/devices/tags/v1"`. Use the
tenant's own cloud base URL from the connector rather than hardcoding a region.

You need AIDs, not hostnames. Get them with `crowdstrike-hosts-lookup` first.

## The prefix rule

Every tag in the request **must** carry the `FalconGroupingTags/` prefix:

```
"FalconGroupingTags/SECOPS"        ✓
"SECOPS"                            ✗ rejected
```

But when you *read* tags back off a device record, they come with the prefix attached too —
so strip it for display and add it for writes. Do that in one place:

```ts
const PREFIX = "FalconGroupingTags/";
const toApi = (tag: string) => (tag.startsWith(PREFIX) ? tag : PREFIX + tag);
const forDisplay = (tag: string) => tag.replace(PREFIX, "");
```

Tag values allow letters, digits, and underscores. They do **not** allow spaces, slashes
beyond the prefix separator, or most punctuation — normalize user input (`replace(/\s+/g, "_")`)
before sending, or the call fails on one bad row and takes the batch with it. Tags are
case-sensitive as stored, so pick a convention (this story upcases departmental codes) and
enforce it in code rather than trusting form input.

### Grouping tags vs sensor grouping tags

Two different things, easy to confuse:

- **Falcon grouping tags** (`FalconGroupingTags/…`) — set via this API, changeable any time. This is what you want.
- **Sensor grouping tags** (`SensorGroupingTags/…`) — baked in at sensor install time via the installer command line. **Not settable through this endpoint.** If a task asks you to change a sensor grouping tag, the answer is that it requires reinstall or a sensor-update policy, not an API call.

Both appear in a device's `tags` array, so read carefully before assuming you can rewrite one.

## Build one tag array — do not branch

The tempting shape, when a form offers six optional tag fields, is a decision tree: "did they
fill in field 2? then call the two-tag variant; field 3? the three-tag variant" — six nearly
identical requests differing only in payload length. The original Tines story this skill was
distilled from does exactly that, with six copies of the same action behind a chain of
"More than N tags?" conditions. It is six places to fix every future change, and it silently
breaks if someone fills field 5 but not field 3.

Filter instead:

```ts
const tags = [
  form.departmentalCode,
  form.assetClassification,
  form.subUnit,
  form.infoSecClassification,
  form.serviceRiskClassification,
  form.complianceExternal,
]
  .map((t) => t?.trim())
  .filter((t): t is string => Boolean(t))
  .map(toApi);

const unique = [...new Set(tags)];
if (unique.length === 0) {
  console.error("No tags supplied; nothing to apply.");
  process.exit(1);
}
```

One request, one code path, any combination of fields.

## Idempotency and replacing values

- **`add` is safe to repeat.** Re-adding an existing tag is a no-op, so a rerun after a partial failure does no harm. This is the property that makes bulk tagging retryable.
- **`remove` is likewise idempotent** — removing an absent tag succeeds.
- **There is no "replace".** To change a classification from `RISK_INFO_LOW` to `RISK_INFO_HIGH`, issue `remove` for the old value, then `add` for the new one. If you only add, the host ends up carrying both and every downstream host group that reads the classification is now wrong.

For classification families where exactly one value should hold, read the current tags first,
compute which same-family tags to remove, and send both calls:

```ts
const family = (tag: string) => forDisplay(tag).split("_").slice(0, 2).join("_"); // e.g. RISK_INFO

const stale = (current: string[], desired: string) =>
  current.filter((t) => family(t) === family(desired) && forDisplay(t) !== forDisplay(desired));
```

## Batching and partial success

`device_ids` accepts a batch, but the response reports **per-device** outcomes. A `200` does
not mean every device succeeded:

```json
{
  "resources": [
    { "device_id": "a1b2c3…", "updated": true },
    { "device_id": "d4e5f6…", "updated": false, "code": 404, "message": "device not found" }
  ],
  "errors": []
}
```

Keep batches to a few hundred ids so one bad id doesn't obscure a large run, inspect every
entry, and **fail the step when any device failed**. Logging a partial failure and exiting
zero tells the rest of the workflow that every host is tagged, and the resulting report is a
lie that nobody catches until an audit.

## Ready-to-use

```ts
const BASE = "https://api.crowdstrike.com";
const PREFIX = "FalconGroupingTags/";
const toApi = (tag: string) => (tag.startsWith(PREFIX) ? tag : PREFIX + tag);

const normalize = (tag: string) =>
  toApi(tag.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_/]/g, ""));

export type TagResult = { device_id: string; updated: boolean; message?: string };

export async function applyTags(
  deviceIds: string[],
  rawTags: string[],
  action: "add" | "remove",
): Promise<TagResult[]> {
  const tags = [...new Set(rawTags.map((t) => t?.trim()).filter(Boolean).map(normalize))];
  const ids = [...new Set(deviceIds.filter(Boolean))];

  if (tags.length === 0) throw new Error("No tags to apply after normalization.");
  if (ids.length === 0) throw new Error("No device IDs to tag.");

  const results: TagResult[] = [];

  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);

    const res = await fetch(`${BASE}/devices/entities/devices/tags/v1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ device_ids: batch, action, tags }),
    });

    if (!res.ok) {
      throw new Error(`Tag ${action} failed: ${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    for (const entry of body.resources ?? []) {
      results.push({
        device_id: entry.device_id,
        updated: entry.updated === true,
        message: entry.message,
      });
    }
  }

  const failed = results.filter((r) => !r.updated);
  console.error(
    `Tag ${action}: ${results.length - failed.length}/${results.length} devices updated with ${tags.join(", ")}`,
  );

  if (failed.length > 0) {
    for (const f of failed) console.error(`  failed ${f.device_id}: ${f.message ?? "unknown"}`);
    throw new Error(`${failed.length} device(s) failed to ${action} tags.`);
  }

  return results;
}
```

## Safety

Tagging writes to a shared source of truth that other teams' automations read. Treat a bulk
run as a change, not a query:

- Log every tag applied and to which AIDs, on stderr, before or as you apply them — this is your audit trail when someone asks why a host group changed size.
- Put a human approval in front of runs above a threshold, or of anything sourced from an uploaded file. A malformed spreadsheet column can retag a whole fleet in one call.
- Prefer `add` over `remove` in automated paths. Removal is the operation that breaks other people's host groups.
- Never invent a tag value. If a form leaves a classification blank, leave it unset and report it as missing rather than guessing a default — a wrong classification is worse than an absent one.

## When not to use this

- To find the AIDs to tag, use `crowdstrike-hosts-lookup`.
- To discover machines with no sensor at all (which cannot be tagged, because they have no AID), use `crowdstrike-asset-discovery`.
- To change a **sensor** grouping tag — not possible here; that is set at install time.
- To organize hosts dynamically without touching tags, consider a Falcon host group with a dynamic FQL assignment rule instead.
