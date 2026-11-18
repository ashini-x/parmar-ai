# Security Model

## Trust boundaries
`Telegram -> Cloudflare Worker -> Durable Object / D1 / Queue -> Vertex AI`

`Protected /admin -> D1 analytics + access controls + audit log`

## Authentication
Telegram webhook requests require the configured secret header. `/telegram/setup` requires its setup secret. `/admin*` uses an HMAC-signed 12-hour `parmar_admin_session` cookie with `HttpOnly`, `Secure`, and `SameSite=Strict`; production should additionally be protected by Cloudflare Access.

The web session carries a server-signed `admin` or `owner` role. The role is never accepted from browser input. Legacy pre-role session payloads remain valid as admin-only and do not acquire Owner privileges. Owner sessions use a signature key derived from `ADMIN_SESSION_SECRET` and the currently configured Owner credential, so rotating the Owner credential invalidates existing Owner sessions.

Analytics/BRɅIN schema initialization must not cache unresolved module-global Promises across Worker requests. The deployed implementation records only completed initialization per D1 binding and makes additive SQLite column migrations re-check after concurrent DDL races. The Owner login handler is awaited inside the Worker route error boundary so initialization failures are logged through the standard request error handler rather than escaping as an uncaught Worker exception.

Production currently configures `OWNER_DASHBOARD_USER=admin` in `wrangler.jsonc`, explicitly assigning the single existing admin account to the Owner role. It reuses the existing admin login credential; no additional Owner password is stored in source. A future distinct Owner principal must use a different username and the `OWNER_DASHBOARD_PASSWORD` Cloudflare Worker secret. The Telegram `BOT_OWNER_TELEGRAM_USER_ID` is not a web-admin identity.

## Authorization
`requireAdmin` permits valid admin and Owner sessions for the existing admin application. `requireOwner` permits only the Owner claim. The M2 `/admin/intelligence` page and `/admin/api/intelligence/*` handlers are guarded by `requireOwner`. Anonymous requests receive 401 and authenticated non-Owner admins receive 403. Conversation/message queries also filter by the normalized configured Owner principal, rather than trusting a browser-supplied owner identifier. Mutations require a matching same-origin Origin header and reject cross-site fetches. Owner sessions use a signature key derived from the configured Owner credential; password rotation revokes existing Owner sessions.

Dashboard access mutations are server-side, same-origin protected, and verified against D1. Protected administrator identities cannot be suspended through ordinary student controls.

## Data separation
Durable Object holds student private-chat operational state, profile, rate metadata and job lifecycle. D1 holds student analytics, AI usage, access overrides, audit entries and Telegram bot metadata. Queue is transport for asynchronous student processing. Owner Intelligence has separate D1 tables `owner_intelligence_conversations`, `owner_intelligence_messages` and `owner_intelligence_generation_metadata`; Owner prompts, assistant responses and generation metadata are not written into student `questions`, student AI usage, profiles or student Durable Object state.

## Secrets
Credentials must remain in secure deployment configuration. Never log tokens, private keys, cookies, authorization headers, or secret environment values.

## Telegram lifecycle
Dashboard-managed bot secrets are encrypted in D1. New bot connections are verified before switching from the active bot, with rollback safeguards.

## AI boundaries
Use bounded conversation/profile context and validate structured model output before delivery.

## Incident response
Rotate credentials, disable compromised access, inspect logs/audit events, assess impact, deploy the verified fix, and preserve an internal incident record.

## Owner Intelligence workspace controls

The Owner workspace is served with `no-store`, `noindex,nofollow`, a per-response nonce-based script Content Security Policy, `nosniff` and `no-referrer`. The browser sends conversation IDs and message/title content only; the server resolves Owner identity from the signed session and configured Owner principal. Conversation IDs are UUID-validated and every D1 query includes the Owner scope. The production Owner scope currently maps to `OWNER_DASHBOARD_USER=admin`; changing that username requires an explicit data migration to preserve existing conversations.

The Owner API enforces a cumulative 200,000-token budget per conversation on the server; browser state and submitted usage values are never authoritative. Before committing a new, edited or regenerated prompt, the Worker calls Vertex CountTokens for the exact model input, calculates the remaining output allowance, and atomically reserves prompt plus output capacity in D1. The reservation update is conditional on current usage, no existing reservation and no locked reason, so concurrent requests cannot both claim the same remaining budget. Only after reservation succeeds are prompt mutations committed and generation started. The Worker settles from Vertex `usageMetadata.totalTokenCount`; interrupted streams without a final usage event are conservatively charged at the reservation amount. The Vertex stream timeout is 8 minutes and stale reservations expire after 10 minutes, charging the reserved amount rather than freeing potentially consumed capacity. A new conversation has a separate budget. This is an application-level Owner safeguard, not a replacement for Vertex quotas, billing controls or model context limits.



## Owner GitHub App authorization boundary

The Owner GitHub connection is separate from BRVIN Connect and from the ChatGPT GitHub connector. It is a private App with only repository Metadata read and Contents write, installed on selected repositories. App private key/client secret are encrypted in the Owner-scoped D1 vault; one-use callback state is hashed and Owner-bound. An installation callback's `installation_id` is untrusted until PKCE user authorization completes and GitHub's authenticated-user installations endpoint confirms the exact App ID + installation ID. The short-lived user token is discarded after verification. Repository discovery/attachment tokens are minted server-side with Contents read and a single selected repository ID; they are not stored in D1 or exposed to the browser. A Contents write token is minted only after the Owner confirms the reviewed Save commit. Topic repository, branch and memory-root are verified against GitHub and scoped by the Owner principal on every attachment mutation. Save-to-GitHub must remain preview/confirm/conflict-aware and must read back the resulting commit before any Synced status is written.

## Owner Vertex AI model registry and provider boundary

The Owner model catalogue is served only below the `/admin/api/intelligence/*` namespace and inherits the route's `requireOwner` guard. It never accepts a project, location, Owner ID, provider URL or credential from browser input. Project/location are read from Worker configuration; candidate model IDs, API versions, modality scope, thinking metadata and token limits are maintained server-side. Google service-account credentials and access tokens remain server-side.

For every centrally allowlisted candidate, the Worker calls Vertex AI Count Tokens using the configured project/location. Only a successful response marks the model selectable. 400/404 means unavailable; 401/403 means access denied; transient failures/timeouts remain unverified. The cached catalogue lasts 90 seconds, probes are limited to three concurrently and each probe times out after 8 seconds. The UI renders only entries with `selectable: true`.

The general-purpose Owner adapter and stream handler require a recently selectable model and reject unverified or unlisted IDs. Both validate the thinking level against that model's server registry entry and never silently switch models or thinking levels. The Owner generation endpoint remains under the existing `requireOwner` route guard, requires same-origin mutation checks, scopes every conversation/message/metadata operation to the configured Owner principal and accepts no project, location, provider endpoint or credential from the browser. Google service-account credentials remain server-side.

The Vertex SSE reader emits only user-facing candidate text and ignores parts marked as thought. Stop/request disconnect aborts the upstream stream, and partial assistant text remains persisted in Owner D1 with a truthful status. Regenerate/edit operations remove later turns before the new request to prevent stale replies from being presented as current conversation context. The generation pipeline does not use the student's SSC prompt, `AnswerPacket`, profile, quota, or automatic BRɅIN/Fatman context.


## Owner Intelligence M4.3 reviewed GitHub Save boundary

The dedicated Owner Memory App is separate from BRVIN Connect and the ChatGPT GitHub connector. It requests exactly repository Metadata read and Contents write, no webhook events, and is installed on selected repositories only. The private key and client secret are encrypted with AES-GCM in Owner-scoped D1. The derived vault key includes the server session secret and configured Owner principal; rotating the session secret makes the stored bundle unreadable and requires reconnecting the App. Manifest/installation/PKCE state values are random, stored as SHA-256 hashes, purpose-bound, Owner-bound, expiring and single-use. The installation ID in GitHub's public setup callback is not trusted until PKCE user authorization confirms the exact App and installation IDs in the authorized user's installation list. The temporary user token is discarded.

Every API call is routed through requireOwner and every mutation checks same-origin. Short-lived installation tokens are minted server-side and restricted to a single repository ID. Repository discovery and attachment use Contents read only. Before token issuance the Worker verifies the App ID, installation ID, exact permissions and selected-only installation mode; permission drift or "all repositories" fails closed. The Contents write token is minted only after the Owner explicitly confirms a reviewed preview.

The draft operation uses the model/thinking level already selected in the workspace and the existing Vertex provider adapter. It calls CountTokens on the same conversation contents plus fixed system instruction sent to GenerateContent, reserves prompt and bounded output through the existing conversation D1 budget/reservation ledger, and settles measured provider usage or conservatively charges the reservation. The token meter is refreshed after the draft attempt. There is no unmetered background summarizer and no silent model switch. Transcript/project Markdown are untrusted reference data, and the model system instruction expressly disallows following instructions embedded in those sources. Common credential patterns are redacted best-effort before prompt construction and before GitHub persistence, but redaction is not perfect secret detection; Owner inspection of every proposed file is still required.

No GitHub write occurs before explicit confirmation. The D1 preview stores the Owner, conversation/topic, repository ID, branch, memory root, expected base commit SHA, file set, expiry and state. Only the exact five preview paths and bounded content sizes can be confirmed. The Worker checks the current branch head, creates one Git tree/commit, persists its SHA before a non-force branch ref update, and recovers interrupted committing/verifying work from the recorded SHA. It fetches the exact commit and every expected file by that SHA and compares content before setting Synced. A conflict or failed verification cannot be reported as Synced. Topic promotion and current commit metadata update occur only after file read-back succeeds. D1 transcript rows remain intact; the draft's measured/estimated usage is charged to the existing 200K chat ledger.

PR #346 is still a release candidate until current-head validation passes, it is merged/deployed and an authenticated Owner completes the real GitHub App installation/save/conflict browser acceptance.


### M4.3 production status

PR #346 is merged and deployed. Production release [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed. The Owner must still perform the live private App creation/selected-repository installation and preview/confirm/read-back/conflict acceptance. The server-side least-privilege, PKCE, encryption and non-force commit controls described above are deployed; live acceptance is not yet complete.

## Owner Intelligence — central Memory Hub and AI role separation (approved design, not implemented)

The approved target is one private `owner-memory-hub` repository for curated project memory and document-mediated AI collaboration. It is not a source-code monorepo. Source code remains in independent repositories and is referenced by repository name, paths and commit SHA only.

- The Owner is the final decision/authorization authority.
- Gemini Owner Intelligence is the architect/planner/reviewer and curated-memory author. The dedicated BRɅIN Owner Memory App must be installed on the hub only, in selected-repository mode, with the existing exact repository permissions (Metadata read + Contents read/write; no events). Do not install that write-capable App across source repositories.
- ChatGPT Software Engineer uses separate Owner-authorized GitHub/deployment connections to inspect and implement source code, test, PR, merge and deploy only against an Owner-approved implementation brief and authorization. Its credentials are not available to the Worker and must never be copied into the Owner App vault.
- GitHub documents are explicit exchange artifacts, not a live agent-to-agent RPC channel. Private conversation histories are not implicitly shared; the Owner chooses what is published.
- Proposals/reviews/implementation reports are untrusted data. They never override system policy, credentials, authorization, model selection or accepted Owner decisions. Only Owner confirmation may mark a decision accepted or a task implementation-ready.
- Every conversation is scoped to at most one primary project with optional workstream/feature scope. Cross-project retrieval requires explicit Owner intent. A project may reference multiple source repositories without copying them into the hub.
- Keep D1 as canonical complete transcript and token/accounting store. GitHub holds curated memory and approved exchange documents only.
- All loaded project memory, reviews and historical turns share the same exact per-request CountTokens budget B. No collaboration-specific/unmetered context bucket is permitted.
- Multi-writer hub commits require path-aware preconditions, append-oriented round artifacts and no-force updates. A changed touched path or manifest must stop for review; unrelated-path rebase is permitted only after verifying all touched-file preconditions. Until path-aware handling is implemented, retain the current strict branch-head conflict guard.
- No secret, token, key, service-account credential or raw private chat dump may enter the hub.

See [OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md](OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md). This is an approved target, not a deployed collaboration automation.
