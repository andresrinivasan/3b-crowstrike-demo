Publishes three reusable Agent Skills bundles distilled from the Tines story *EDgaR — the EDR audit and asset discovery utility*, so they can be read and copied out for installation.

The skills capture the CrowdStrike Falcon knowledge that was embedded in that story:

- `crowdstrike-hosts-lookup` — resolve hostnames to device IDs (AIDs) and fetch host details, including the FQDN trap that silently breaks most first attempts.
- `crowdstrike-host-tagging` — apply and remove `FalconGroupingTags/`, with batching and partial-success handling.
- `crowdstrike-asset-discovery` — find unmanaged assets (machines with no Falcon sensor), attribute coverage gaps to an owning team, and fall back to Falcon Exposure Management or an RTR ARP sweep when Discover isn't licensed.

## Trigger

One entry point: [`Skills library`](<Skills library/config.toml>) serves a page at `/crowdstrike-skills`, restricted to members of this space. There is no schedule and no inbound webhook.

## The flow

A single react step. The three `SKILL.md` files are imported at build time as text and rendered in the browser with per-skill copy and download buttons, plus a "copy all three" action. No requests are made at runtime and no external service is called.

## Where things live

- Page and layout: [`Skills library/App.tsx`](<Skills library/App.tsx>)
- Theme, fonts, and the ruled-paper treatment: [`Skills library/globals.css`](<Skills library/globals.css>)
- Canonical skill sources, in installable directory form: `skills/<skill-name>/SKILL.md`
- Build-time copies the page imports: `Skills library/{hosts-lookup,host-tagging,asset-discovery}.md`

**The two copies must be kept in sync.** Editing a skill means editing `skills/<name>/SKILL.md` and re-copying it into the `Skills library` step, since a react bundle cannot read files at runtime.

## Notes

- The `skills/` directory registers as an inert step in the graph (no `config.toml`, no entry point). It never runs; it exists to hold the installable bundles.
- These files are not loadable as skills from within this workflow. A skill has to be installed into the tenant's skills registry to be picked up automatically.
- Endpoint details were written from the story plus the documented Falcon API surface, not verified against a live CrowdStrike tenant. Attach a CrowdStrike connector and exercise the calls before treating them as authoritative.
