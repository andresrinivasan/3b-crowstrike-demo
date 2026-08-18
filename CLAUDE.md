# 3B CrowdStrike demo

This repo is a **git-synced mirror of live 3B workflows**, not standalone source. Each
top-level directory is one workflow; its `workflow.toml` holds the live workflow id.


## Use the 3B MCP server

The 3B tools are deferred — load them with `ToolSearch` *before* planning any task that
touches a workflow, not after. Reading the local files is not a substitute for inspecting
the live workflow. Read `get_builder_guide` before authoring or restructuring a step, and
check `list_skills` / `get_skill` for the relevant reference guide (there is one for React
steps) before writing code.

- **Prefer running the real thing over reproducing it.** To see what a step or report page
  looks like — including with sample or mock data — render it through the live workflow via
  `execute` / `run_step`. Do not hand-build a local imitation in `/tmp` unless I have said
  the live space is off-limits.
- **Steps are containers, not modules.** A step is a directory with `config.toml` plus code
  and a `FROM 3b/base` Dockerfile. React steps render server-side to an HTML shell and fetch
  their data client-side, so rendering a page *with data* means supplying that data too —
  trace where it comes from before assuming a single step run will show it.
- **Volumes are shared, persistent state.** `Unregistered host detection` reads and writes
  `/storage/falcon_coverage`; the nightly sweep owns `latest.json` there. Writing to a volume
  can overwrite real output and persists across runs — ask before you do.
- **Publishing.** This space syncs with git, so `push_live` is refused here. `sync_git` pushes a
  committed draft to the remote as a branch and reports its name; merging that branch into
  `origin/main` is what makes it live, and 3B pulls the merge back in. 3B's `main` only moves when
  the remote's does — it does not pick up arbitrary inbound branches, so a branch pushed from a
  local clone will not appear as a draft in 3B.

## Conventions

- Workflow and step names contain spaces (`Unregistered host detection/Coverage report/`).
  Quote paths in shell commands and in markdown links (`[Nightly sweep](<Nightly sweep/script.ts>)`).
- Each workflow and step carries a `README.md` explaining what it does and why. Keep it
  current when behaviour changes — these are the demo's narration, not incidental docs.

