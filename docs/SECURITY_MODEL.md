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

The Owner workspace is served with `no-store`, `noindex,nofollow`, a restrictive same-origin script Content Security Policy, `nosniff` and `no-referrer`. The browser sends conversation IDs and message/title content only; the server resolves Owner identity from the signed session and configured Owner principal. Conversation IDs are UUID-validated and every D1 query includes the Owner scope. The production Owner scope currently maps to `OWNER_DASHBOARD_USER=admin`; changing that username requires an explicit data migration to preserve existing conversations.

The Owner API enforces a cumulative 200,000-token budget per conversation on the server; browser state and submitted usage values are never authoritative. Before committing a new, edited or regenerated prompt, the Worker calls Vertex CountTokens for the exact model input, calculates the remaining output allowance, and atomically reserves prompt plus output capacity in D1. The reservation update is conditional on current usage, no existing reservation and no locked reason, so concurrent requests cannot both claim the same remaining budget. Only after reservation succeeds are prompt mutations committed and generation started. The Worker settles from Vertex `usageMetadata.totalTokenCount`; interrupted streams without a final usage event are conservatively charged at the reservation amount. The Vertex stream timeout is 8 minutes and stale reservations expire after 10 minutes, charging the reserved amount rather than freeing potentially consumed capacity. A new conversation has a separate budget. This is an application-level Owner safeguard, not a replacement for Vertex quotas, billing controls or model context limits.



## Owner Vertex AI model registry and provider boundary

The Owner model catalogue is served only below the `/admin/api/intelligence/*` namespace and inherits the route's `requireOwner` guard. It never accepts a project, location, Owner ID, provider URL or credential from browser input. Project/location are read from Worker configuration; candidate model IDs, API versions, modality scope, thinking metadata and token limits are maintained server-side. Google service-account credentials and access tokens remain server-side.

For every centrally allowlisted candidate, the Worker calls Vertex AI Count Tokens using the configured project/location. Only a successful response marks the model selectable. 400/404 means unavailable; 401/403 means access denied; transient failures/timeouts remain unverified. The cached catalogue lasts 90 seconds, probes are limited to three concurrently and each probe times out after 8 seconds. The UI renders only entries with `selectable: true`.

The general-purpose Owner adapter and stream handler require a recently selectable model and reject unverified or unlisted IDs. Both validate the thinking level against that model's server registry entry and never silently switch models or thinking levels. The Owner generation endpoint remains under the existing `requireOwner` route guard, requires same-origin mutation checks, scopes every conversation/message/metadata operation to the configured Owner principal and accepts no project, location, provider endpoint or credential from the browser. Google service-account credentials remain server-side.

The Vertex SSE reader emits only user-facing candidate text and ignores parts marked as thought. Stop/request disconnect aborts the upstream stream, and partial assistant text remains persisted in Owner D1 with a truthful status. Regenerate/edit operations remove later turns before the new request to prevent stale replies from being presented as current conversation context. The generation pipeline does not use the student's SSC prompt, `AnswerPacket`, profile, quota, or automatic BRɅIN/Fatman context.


## Owner Intelligence GitHub App boundary (M4.3)

Owner project memory uses a dedicated private GitHub App, separate from BRVIN Connect. The required permission set is exactly Metadata: read and Contents: write; the App is installed on selected repositories only. An installation that grants all repositories or has additional permissions is rejected. The Worker re-checks the App ID, installation ID, exact permission set and repository-selection mode before repository operations. Installation tokens are minted server-side and narrowed to the single repository ID for preview/save operations.

The App private key is encrypted with AES-GCM using a key derived from the configured session secret and is stored only in Owner-scoped D1. The browser receives neither the private key nor an installation token. OAuth/manifest and installation callbacks are outside the SameSite=Strict session-cookie path by necessity, but each consumes a cryptographically random, hashed, short-lived, single-use state bound to the configured Owner. The callback cannot authorize another Owner or a student/admin session.

Every Owner GitHub API mutation remains behind requireOwner and the same-origin Origin/Sec-Fetch-Site check. Repository, branch, topic and conversation values are re-resolved and validated server-side. Existing GitHub Markdown and D1 transcript excerpts are untrusted reference material. The initial Save preview explicitly labels its bounded transcript excerpts and template files; it does not call Gemini or silently promote an inferred summary to accepted project memory. Ordinary chat turns do not write GitHub.

Save requires an editable preview and explicit confirmation. The Worker checks the expected branch head, creates a Git tree and commit, and updates the branch without force. A stale head or GitHub non-fast-forward response remains Conflict; external edits are not overwritten. The Worker reads back the commit and each expected file at that commit before marking D1 Synced or promoting a Scratchpad to a project. D1 remains canonical for the full transcript and 200K budget/reservations. This M4.3 feature branch is not production-accepted until PR validation, deployment and Owner-authenticated GitHub App/Save acceptance are recorded.

The Owner page client script is served as a protected same-origin JavaScript asset under script-src 'self'. Its Content Security Policy adds form-action access to github.com solely for the GitHub App manifest POST; connect-src remains same-origin and no generic external fetch is enabled.
