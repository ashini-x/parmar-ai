# Owner Intelligence — AI Collaboration Protocol

**Status:** Approved architecture; documentation only; not implemented as an automated collaboration feature  
**Approved:** 2026-11-19 IST  
**Parent:** [Owner Gemini Intelligence roadmap](OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md)  
**Memory/context architecture:** [OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md](OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md)  
**Continuation:** [OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md](OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md)

## 1. Decision and purpose

Adopt one dedicated private GitHub repository, provisionally named `owner-memory-hub`, as the central, version-controlled memory and AI-collaboration workspace for all Owner projects.

The hub is **not** a monorepo and is not a destination for application source code. Existing source repositories remain independent. The hub contains curated project knowledge, hierarchical project/workstream/feature records, AI proposals and reviews, accepted decisions, implementation briefs, handoffs, and implementation reports. It stores references to source repositories, paths and commit SHAs, not copies of their source trees.

The working model has three distinct roles:

1. **Owner — director and final authority.** Chooses goals, approves scope, accepts or rejects architectural decisions, authorizes implementation, and decides whether changes may be merged/deployed.
2. **Gemini in Owner Intelligence — architect, planner and reviewer.** Discusses ideas, explores alternatives, designs architecture, records project knowledge, critiques implementation evidence and prepares precise implementation briefs. It is a decision-support and documentation workspace, not the code/deployment executor.
3. **ChatGPT Software Engineer — implementation and release executor.** Uses its separate, user-authorized GitHub/deployment connections to inspect source repositories, implement the Owner-approved brief, run tests, create/update branches and pull requests, merge when authorized, deploy through the configured release workflow, and report exact evidence. It must not silently reinterpret an accepted architecture or deploy an unapproved scope change.

This is a **human-directed, document-mediated collaboration protocol**. GitHub is the durable hand-off and review layer between the two AI workspaces. It is not a live agent-to-agent RPC channel: a commit does not automatically wake the other AI, transfer its private chat history, or authorize an operation. The Owner asks each workspace to read or publish the relevant artifacts and remains in control of every decision.

### 1.1 AI provider and infrastructure boundary

Within the Owner Intelligence runtime, **Google Gemini through Vertex AI is the only AI provider**. Chat generation, CountTokens, memory drafting and any future model-backed Owner operation must use the approved Vertex adapter, the exact selected and verified Gemini model and its supported thinking level. There is no Cloudflare Workers AI, alternate provider, second hidden summarizer/reranker or automatic fallback. A memory draft consumes the same chat's M4.1 200,000-token D1 budget. On provider failure, preserve state and surface the error; never silently change model, thinking level, API or provider.

Cloudflare is the deterministic application/backend layer for authentication, authorization, D1 transcript/usage/outbox, bounded context assembly, Vertex request transport, GitHub API operations, conflict/read-back verification and durable retry orchestration. It does not perform inference. The Owner confirms the account is on Workers Free; the full plan/capacity decision and M4.6-P0 gate are specified in [OWNER_INTELLIGENCE_PROVIDER_AND_INFRASTRUCTURE_POLICY.md](OWNER_INTELLIGENCE_PROVIDER_AND_INFRASTRUCTURE_POLICY.md). Actual account-wide headroom is unmeasured. D1 remains the durable source of truth; Queue and Workflow state are transport/execution only.

ChatGPT Software Engineer remains an independent, Owner-authorized code/test/PR/merge/deploy executor using its own credentials. It is not a runtime provider or fallback and its connector credentials are never available to the Worker. BRɅIN's student-facing services and optional Owner BRɅIN context retain their separate existing boundaries.

## 2. Responsibility and permission boundaries

### 2.1 Gemini Owner Intelligence

Gemini is responsible for:
- Open-ended technical discussion and architecture exploration from the Owner's perspective.
- Creating structured proposals, alternatives, risks, assumptions and decision records.
- Reading ChatGPT-authored review reports and implementation evidence from the hub.
- Challenging weak approaches, detecting deviations from accepted constraints and recommending corrections.
- Producing implementation-ready briefs after the Owner confirms a decision.
- Curating project memory, progress, decisions and handoff notes through the deployed Owner Memory App's reviewed-save workflow.

Gemini must not:
- Commit application source code to project repositories.
- Push, merge or deploy application code.
- Treat a ChatGPT proposal/review as an accepted Owner decision.
- silently change the Owner's chosen model, project scope, security boundary or approved architecture.
- Write directly to the canonical accepted-decision record without explicit Owner approval.

The dedicated **BRɅIN Owner Memory** GitHub App is separate from ChatGPT's GitHub authorization and from BRVIN Connect. Its target installation is only the private Owner Memory Hub repository. Keep its permission set at repository Metadata read and Contents read/write, with no webhook events; install it in **Only select repositories** mode and select only the hub. Its credentials remain server-side in the Owner-scoped D1 vault. Do not install this write-capable App across source-code repositories merely to let Gemini discuss their code.

### 2.2 ChatGPT Software Engineer

ChatGPT is responsible for:
- Reading an Owner-approved implementation brief and the latest accepted project memory.
- Independently inspecting the actual source repositories, current code, tests, workflows and deployment configuration.
- Checking that the proposed work is compatible with the real codebase rather than blindly following stale documentation.
- Implementing only the approved scope; identifying and reporting contradictions before making a material architecture change.
- Running relevant tests and reporting exact commands/results.
- Creating branches and pull requests, addressing review, merging and deploying only under the Owner's instruction and the repository's established release protections.
- Writing a separate implementation report to the collaboration hub after execution.

ChatGPT uses its own separately authorized GitHub and deployment connections. It must never receive, copy, or depend on the Gemini Worker's GitHub App private key, client secret, installation token or D1 credential vault. The Worker must never use ChatGPT connector credentials as runtime credentials.

The Owner's authorization for ChatGPT to act as the Software Engineer does not turn a proposal into permission for unlimited changes. Every task still has a bounded brief, acceptance criteria, and the appropriate approval gate for merge/deploy.

### 2.3 Owner

The Owner remains the only authority for:
- Registering a new project or changing its identity/scope.
- Accepting/rejecting architecture decisions.
- Promoting a proposal into an accepted decision.
- Marking an implementation brief ready for execution.
- Authorizing material scope changes, merges and deployments where required.
- Approving shared memory changes and conflict resolutions.

A model may recommend a status. It cannot grant itself Owner approval.

## 3. Central repository and hierarchy

Recommended GitHub repository:

- Name: `owner-memory-hub`
- Visibility: Private
- Default branch: `main`
- Initial content: README only; the application will create the structured documents after the architecture is implemented.
- Owner Memory App installation: selected-only, with this one repository selected.

The target logical layout is:

```text
owner-memory-hub/
  README.md
  hub-manifest.json
  schema/
    hub-manifest.schema.json
    project-manifest.schema.json
    collaboration-thread.schema.json
  catalog/
    projects/
      <project-id>.json
  shared/
    owner-workspace-principles.md
    engineering-standards.md
    cross-project-decisions/
  projects/
    <project-id>/
      project.json
      overview.md
      manifest.json
      memory/
        index.md
        project-memory.md
        progress.md
        decisions/
        sessions/
        handoffs/
        archive/
      workstreams/
        <workstream-id>/
          workstream.json
          overview.md
          manifest.json
          memory/
          features/
            <feature-id>/
              feature.json
              overview.md
              manifest.json
              memory/
      collaboration/
        threads/
          <thread-id>/
            thread.json
            rounds/
              001-gemini-proposal.md
              002-chatgpt-review.md
              003-gemini-response.md
            owner-decision.md
      implementation-briefs/
        <task-id>.md
      implementation-reports/
        <task-id>.md
      archive/
```

This is a logical target. Do not pre-create empty trees by hand, and do not let an AI invent a new schema ad hoc. M4.4 must define and validate versioned JSON manifest schemas before relying on them at runtime. Markdown remains the human-reviewable content format.

### 3.1 Stable identity

Use immutable IDs for projects, workstreams, features, collaboration threads, decisions and implementation tasks. Slugs and display names are labels that may change; they are not foreign keys.

A project can reference multiple independent source-code repositories. A workstream groups a coherent area of work within a project. A feature is a narrower unit inside a workstream, but not every conversation needs to be classified as a feature. Keep the hierarchy flexible: projects may have workstreams without features, and workstreams/features may be related or independent.

A new or exploratory discussion starts as a D1 Scratchpad. Register it as a project only when the Owner decides it is durable enough to organize. Do not force every casual topic into the project catalog.

### 3.2 Scope rules

- A project is the top-level memory and isolation boundary.
- A workstream and optional feature narrow the active project scope.
- Each conversation has at most one primary project scope and may carry optional workstream/feature IDs.
- A Scratchpad has no project scope until deliberately promoted.
- Cross-project context is off by default. Load another project only when the Owner explicitly requests cross-project comparison/research or selects the additional scope.
- Shared documents are global only when explicitly registered as shared; do not infer that a decision applies to all projects merely because it appears in one project.
- Every loaded note must preserve source path, manifest revision, repository, branch and exact commit SHA.

The exact project/workstream/feature set is selected by the Owner or confirmed from a model suggestion. Automatic classification may suggest a destination and explain confidence/reasons; it must not silently move an existing conversation, create accepted decisions, or publish a write.

## 4. GitHub memory, source code and provenance

### 4.1 Memory is not source code

The hub stores:
- Stable project goals, architecture and constraints.
- Current progress and next steps.
- Owner-accepted decisions.
- Workstream and feature summaries.
- Curated session notes and rollover handoffs.
- Proposals, reviews, implementation briefs and implementation reports.
- Source repository names, file paths, branch names and commit references.

The hub does not store:
- Cloned/copied application source trees.
- Secrets, access tokens, service-account JSON, private keys, passwords or raw credentials.
- A replacement copy of the full D1 conversation transcript.
- Unreviewed raw dumps of every chat turn.

Each project manifest may include a source-repository registry such as repository full name, purpose, default branch, relevant directory/path hints and the last implementation commit reported by ChatGPT. These are pointers, not source copies. The ChatGPT Software Engineer checks the live source repository before implementation; a pointer or old commit is not proof that the current code still matches the note.

### 4.2 Current M4.3 compatibility

The deployed M4.3 save flow attaches a GitHub repository, branch and memory-root path to each flat Owner topic. Multiple topics can target the same hub repository while using distinct paths, for example:

- Project A: `projects/<project-id>/memory`
- Project B: `projects/<project-id>/memory`
- A future workstream-specific save, after scope support is implemented: `projects/<project-id>/workstreams/<workstream-id>/memory`

For the transition, use one Owner topic per project, the same hub repository and a unique project memory-root path. Do not create a separate GitHub repository for each project. Do not claim that current production topics already support hierarchical workstream/feature manifests; M4.4 must add that model and load it safely.

M4.3 currently uses a branch-head conflict check. This is safe against overwriting external changes, but it can report a conflict when an unrelated path changed. Do not weaken that check to hide conflicts. The future hub writer must add path-aware optimistic concurrency before enabling concurrent writers: validate the expected blob SHA for every touched path and relevant manifest; if only unrelated paths changed, rebase/rebuild the proposed tree on the latest head under a bounded retry and non-force ref update; if a touched file or governing manifest changed, stop and request review. Never force-push or silently discard an external change.

## 5. The AI collaboration exchange protocol

GitHub artifacts are the public-to-this-workflow exchange format. Private AI conversation transcripts are not automatically shared.

### 5.1 Artifact types

| Artifact | Author | Purpose | Authority |
|---|---|---|---|
| Architecture proposal | Gemini | Problem, goals, options, recommendation, trade-offs and risks | Proposal only |
| Independent review | ChatGPT | Validate assumptions, inspect relevant source/docs, point out weaknesses and alternatives | Review only |
| Rebuttal / revised proposal | Gemini | Respond to review, revise or defend the design | Proposal only |
| Owner decision | Owner (recorded by either AI) | Accept/reject/defer one explicitly identified proposal/revision | Authoritative decision record |
| Implementation brief | Gemini drafts; Owner approves | Convert accepted design into bounded engineering work | Execution contract after approval |
| Implementation report | ChatGPT | Record what was actually changed, tested, merged and deployed | Evidence report, not an architecture decision |
| Verification / correction note | Gemini or Owner | Compare shipped evidence against accepted brief and record discrepancies | Review finding until Owner resolves |

### 5.2 Collaboration thread structure

Each thread is append-oriented and pinned to a project/workstream/feature scope and the exact source proposal commit. A thread manifest should contain:
- Schema version and stable thread ID.
- Project ID and optional workstream/feature IDs.
- Human-readable title and problem statement.
- Current status and current round number.
- Proposal author/system identity and UTC timestamp.
- Artifact paths and immutable commit SHAs.
- Related source repository/path/commit references.
- Explicit assumptions, constraints and open questions.

Each round is a separate artifact. Do not overwrite Gemini's original proposal with ChatGPT's review or erase a prior response. If an artifact needs correction, add a new revision/round and record what it supersedes.

### 5.3 Status lifecycle

Use controlled statuses, validated by schema:

`draft` → `proposed` → `review-requested` → `reviewed` → `needs-owner-decision` → `accepted` → `implementation-ready` → `in-progress` → `implemented` → `verified`

Other terminal/side states: `rejected`, `deferred`, `blocked`, `superseded`, `archived`.

Only an Owner confirmation can move an artifact to `accepted` or `implementation-ready`. ChatGPT may set `in-progress` or submit an implementation report; Gemini may submit a review finding. Neither may self-approve its own proposal or declare a deployment verified solely because a tool call returned success.

### 5.4 Example: decentralized application

1. The Owner opens a new Gemini Scratchpad and explores a decentralized application architecture.
2. Gemini proposes registering a project and prepares an architecture proposal. The Owner confirms the project identity and proposal scope.
3. Owner Intelligence saves the proposal as a distinct collaboration artifact in the hub; it does not touch source-code repositories.
4. The Owner asks ChatGPT Software Engineer to read the exact proposal/commit and independently review it. ChatGPT inspects the relevant technical documentation and, when appropriate, actual source repositories, then publishes a separate review artifact with evidence and alternatives.
5. The Owner returns to Gemini, which reads the review artifact and discusses the disagreement/trade-offs with the Owner. Gemini may publish a revised proposal or response; it does not overwrite the review.
6. The Owner accepts one revision. The accepted decision records exactly which proposal/review revisions were considered and what was selected, rejected or deferred.
7. Gemini prepares an implementation brief. The Owner confirms it as `implementation-ready`.
8. ChatGPT reads the approved brief, checks latest code and workflows, creates a branch/PR, tests and, when authorized, merges/deploys. If reality conflicts with the brief, ChatGPT stops and proposes a documented deviation rather than quietly changing the architecture.
9. ChatGPT writes an implementation report with repository PR/commit, tests run and results, deployment workflow/run, deployed version IDs, production checks, rollback status and known gaps.
10. Gemini can review that evidence against the accepted design, identify mistakes or missing acceptance criteria, and draft a correction brief. The Owner decides whether another engineering task is needed.

This lets the two systems challenge each other through durable artifacts while the Owner controls the transition from idea to decision to execution.

### 5.5 Implementation brief contract

An implementation-ready brief must include:
- Stable project/workstream/feature/task IDs and links to accepted decision records.
- Problem, expected outcome and bounded scope.
- Source-code repository(ies), relevant paths and commit references (explicitly labelled as inspection hints, not assumed current).
- Accepted architecture and exact constraints that must not change.
- API/schema/data migration compatibility requirements.
- Explicit non-goals and excluded systems.
- Security, privacy, authorization and credential constraints.
- Required tests, test commands where known and acceptance criteria.
- Release/deployment workflow, environment boundaries, production smoke checks and rollback expectations.
- Unknowns ChatGPT must inspect before coding.
- Owner approval state, date and proposal/decision commit SHAs.

A brief is not valid for execution while it is merely `draft`, `proposed` or `needs-owner-decision`.

### 5.6 Implementation report contract

ChatGPT's report must distinguish actual outcomes from assumptions and include:
- Code repositories and changed paths.
- PR numbers/URLs, head and merge commit SHAs.
- Tests actually run, counts/results and any skipped checks.
- Deployment workflow/run URLs, deployed Worker/service version IDs and traffic state where applicable.
- Production smoke/acceptance results and rollback state.
- Deviations from the approved brief and the Owner's approval reference.
- Known defects, untested cases and exact next action.

A successful Git push is not proof of a successful deployment. A successful deployment workflow is not proof of every user journey. The report must not invent test or production evidence.

## 6. How the two assistants exchange information

The protocol is intentionally simple:
- Gemini publishes a proposal or brief to the hub through its Owner-reviewed memory workflow.
- The Owner asks ChatGPT to read a specific project/thread/commit and review or execute the approved brief.
- ChatGPT publishes a distinct review/report artifact through its own GitHub authorization.
- The Owner asks Gemini to inspect that artifact and discuss it.
- Owner acceptance controls promotion to canonical project memory and implementation readiness.

No private conversation is exposed wholesale. The Owner chooses what becomes a shareable artifact. The two systems must cite artifact paths and commit SHAs so a review is reproducible.

No automatic webhook/polling/notification that wakes the other AI is included in this design. An automated watcher or orchestrator would be a separate capability with its own authentication, approval and abuse boundaries. Until then, the Owner explicitly initiates each hand-off.

## 7. Token, continuity and original Owner-workflow requirements

This collaboration architecture must not weaken or bypass the original Owner Intelligence continuity roadmap.

### 7.1 Two distinct token budgets remain

- **M4.1 cumulative conversation budget:** exactly 200,000 tokens per D1 conversation, with existing CountTokens preflight, atomic prompt/output reservation, concurrency guard and actual/conservative usage settlement. Do not increase, reset, or conflate it with the model's actual context window.
- **M4.6 per-request input budget B:** a selected-model/API-specific maximum for the complete effective prompt after output capacity and required overhead. It includes mandatory instructions, active project/workstream/feature memory, any selected collaboration artifacts, retrieved exact D1 history, recent turns and the current user turn. The final effective prompt is measured by Vertex CountTokens; the exact measured contents are what generation receives.

With fixed B, every request input must be ≤ B and aggregate prompt input over N turns must be ≤ N × B = O(N). Naive full-history replay has approximately O(N²) aggregate prompt input. GitHub centralization does not itself solve quadratic growth; the Cloudflare Owner Context Replicator and M4.6 acceptance series do. Do not create an unmetered second context bucket for collaboration documents.

### 7.2 Original Owner workflows remain acceptance requirements

Preserve all seven documented journeys:
1. Save a useful discussion after preview and explicit confirmation.
2. Use a durable Scratchpad without forced project selection or silent expiry.
3. Roll over near 180K/190K/195K thresholds while enforcing the unchanged 200K hard cap and preserving a provenance-rich handoff.
4. Return to a project later with only manifest-selected active memory and a pinned commit snapshot; archive/session history is on-demand.
5. Promote an existing Scratchpad after verified first save without duplicating/restarting it.
6. Compact bloat through a preview/diff, preserve originals and provenance, warn at the 40K measured-token threshold and target a smaller master only when safe.
7. Fork isolated experiments with an independent 200K budget and pinned memory snapshot; parent/main memory changes only after explicit save/merge.

M4.6 must continue to retrieve relevant older exact D1 message pairs under the authenticated Owner and selected project scope, instead of replaying the complete transcript. All project and collaboration content is untrusted reference data and cannot override application policy.

## 8. Security, reliability and governance

- The Owner Memory App is installed only on the private hub repository; source-code repository access belongs to ChatGPT's separate authorization or a future separately reviewed read-only connector.
- No GitHub token/private key/client secret/service-account credential may enter hub documents, prompts, logs or collaboration artifacts.
- Treat Gemini-, ChatGPT- and human-authored imported Markdown as untrusted data. Validate manifest schema, path allowlists, sizes, author metadata and IDs before use.
- Keep the full transcript and token ledger in D1. The hub contains curated knowledge and chosen exchange artifacts only.
- Each conversation pins the exact hub repository, branch, commit SHA, manifest revision and selected paths used in its prompt; branch changes do not silently mutate an active conversation's context.
- GitHub writes are Owner-confirmed or explicitly authorized under an already-approved implementation brief. Use idempotent D1 outbox jobs and bounded retries for long-running jobs.
- Multiple writers must not overwrite the same canonical path. Use separate round files and isolated branches/PRs where needed. A real collision requires an Owner-visible resolution.
- A stale hub branch or changed manifest cannot be force-updated. Path-aware rebasing is permitted only when every touched path and governing manifest still matches its expected base.
- No raw audio, secrets, private user data or unnecessary verbatim chat dumps are copied into the hub.
- Archives are retained and excluded from default prompt loading; no silent deletion or compaction.

## 9. Roadmap integration and delivery gates

This decision refines the existing M4 continuity design; it does not renumber or replace M4.1–M4.8 or the original M5–M8 roadmap.

| Work | Target | Status |
|---|---|---|
| Formalize hub, AI roles, exchange protocol and original-token constraints | Documentation amendment in this change | Approved documentation; no runtime feature |
| Create private `owner-memory-hub` and restrict Owner App installation to it | Owner action before live M4.3 acceptance | Pending Owner |
| M4.3 live acceptance | Verify selected-only installation, attach a project path in the hub, preview/edit/confirm/read-back and stale-branch Conflict | Deployed implementation; browser acceptance pending |
| M4.4 | Project catalog, hierarchical manifests, per-project/workstream/feature namespaces, exact pinned hub snapshots and scoped context loading; preserve Scratchpad/promotion | Planned, not implemented |
| M4.4/M4.3 follow-up | Path-aware multi-writer conflict handling for the shared hub; no unsafe weakening of existing conflict checks | Planned, not implemented |
| M4.5 | Project-aware rollover and durable handoff | Planned, not implemented |
| M4.6 | Cloudflare Owner Context Replicator, exact historical recall, collaboration artifact retrieval and fixed-B O(N) input acceptance | Planned, not implemented |
| M4.7 | Project/workstream-aware compaction and isolated forks with immutable snapshots | Planned, not implemented |
| M4.8 | Measured cache/retrieval optimizations with scope- and snapshot-isolated keys | Planned, not implemented |
| ChatGPT implementation execution | Read approved brief, inspect code repositories, test, PR, merge/deploy when authorized, publish report | Operating convention; not an automatic integration |

M4.4 must not begin before the real M4.3 selected-only hub installation/save/read-back/conflict acceptance passes. Do not migrate source code, provision new Cloudflare services, broaden the Owner App's permissions, or enable automatic AI-to-AI triggers as part of this documentation decision.

The 2026-11-19 single-provider/Cloudflare Free policy is also locked. Complete M4.6-P0 (capacity, cost and outbox-recovery assessment) before M4.6; it does not alter the ongoing M4.3 live acceptance gate or authorize a Cloudflare plan upgrade/resource provision.

## 10. Acceptance scenarios for the complete system

The future implementation is not complete until tests and Owner acceptance cover:
- A new Scratchpad can remain unclassified until the Owner registers a project.
- One hub stores several projects with separate stable IDs and memory roots.
- Multiple workstreams/features can be created without changing the source-code repository layout.
- A conversation loads one project/workstream/feature scope and demonstrably excludes unrelated projects by default.
- An explicit cross-project question loads only the requested additional scopes.
- A Gemini proposal, ChatGPT review and Gemini response remain separate, pinned artifacts; neither overwrites the prior round.
- Only Owner confirmation promotes an accepted decision or implementation-ready brief.
- ChatGPT refuses to implement an unapproved/proposed-only brief and reports a scope conflict before code changes.
- A report records exact PR/commit/test/deployment evidence and Gemini can retrieve it as untrusted, provenance-bearing input.
- Two writers modifying distinct project paths do not lose each other's commits; edits to the same path or controlling manifest return a reviewable conflict.
- No source-code files are copied into the hub; source repository references resolve to the independent code repositories.
- Every model request includes collaboration artifacts in the same final CountTokens budget B.
- 10/50/100/200-turn tests prove per-request ≤ B and aggregate prompt input ≤ N × B for fixed B, while the full D1 transcript remains intact.
- All seven original Owner workflows remain supported without silent deletion, auto-sync, unreviewed writes or cross-project leakage.

These are planned acceptance criteria, not claims of deployed functionality or tests already passed.


## 11. Live hub, Owner App and M4.3 acceptance status — 2026-11-19 IST

GitHub metadata verifies `ashini-x/owner-memory-hub` exists (repository ID `1463342529`), has default branch `main`, contains README `# owner-memory-hub`, and is **Private**.

**Owner browser evidence:** the production Owner Intelligence panel previously displayed `Connected · 1 verified installation(s)`, account `ashini-x · User`, and repository `ashini-x/owner-memory-hub · Private`. The dedicated Owner App is installed only on this private hub with the exact permissions: repository Metadata read + Contents write. Do not uninstall, recreate, reinstall or broaden it.

**Topic route:** PR [#352](https://github.com/ashini-x/parmar-ai/pull/352), merge `c555d9428421fbbe600a872093730fa3dce644e1`, fixed topic list/create/rename to `/admin/api/intelligence/topics` and deployed in workflow [44411119143](https://github.com/ashini-x/parmar-ai/actions/runs/44411119143).

**Live Save acceptance, Owner-confirmed 2026-11-19:** an external edit to `projects/owner-intelligence/memory/progress.md` was made after a previous preview. That stale preview reached Conflict. The exact comment marker was present in a fresh preview; the Owner explicitly saved from the panel to `main`, then fetched/opened the committed file and confirmed the newly generated progress content appeared immediately below the manually authored comment. This demonstrates append-only preservation in the real Owner flow. Full sequence, preview IDs, external commit and code evidence are in [OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md](OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md).

**Implementation fixes:**
- PR [#355](https://github.com/ashini-x/parmar-ai/pull/355) merged as `64c8559ce92413ea46dfa96f77133e0786da001d` and hardened memory-draft timeouts, selected-model verification, explicit-429-only bounded retry and definitive-rejection reservation release.
- PR [#356](https://github.com/ashini-x/parmar-ai/pull/356) merged as `3ae456188fb7535db47bcab2a7909cf333b59285` and made proposed Markdown updates/checkpoints append-only, idempotent and protective of prior Owner edits.
- PR #356 validation [44455732385](https://github.com/ashini-x/parmar-ai/actions/runs/44455732385) passed TypeScript/check, 513 Vitest tests/75 files, 62 Node tests/9 files and all three Worker dry-run builds.
- Cloudflare verifies `parmar-ai` version `74fade9d-422e-4a91-8be4-f98340b76eb4` and `brvin-service` version `1999a4c1-9137-447e-8dc7-596f70a338b9` at 100% traffic.

**M4.3 closeout:** the live Save/read-back and Owner-content preservation subtest is passed. Before closing the entire milestone and starting M4.4, use read-only inspection to confirm the saved topic association/Scratchpad promotion and memory-draft usage settlement. Do not repeat the successful Save test; do not weaken the strict branch-head Conflict rule. M4.4 remains unimplemented and must add hierarchical hub manifests, stable project/workstream/feature identifiers, manifest-selected memory loading, immutable per-conversation repository/branch/commit snapshots, strict project isolation and safe multi-writer/path-aware conflict handling.
