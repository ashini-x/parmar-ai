# BRVIN Retrieval Provider Modernization — Approved Architecture and Migration Plan

**Decision date:** 8 November 2026  
**Status:** APPROVED DESIGN / M13 IMPLEMENTATION IN REVIEW / NO PROVIDER CUTOVER  
**Owning repository:** ashini-x/parmar-ai  
**Coordinating consumer:** ashini-x/brvin-teachers  
**Scope:** Replace the retrieval/indexing providers behind the existing BRVIN product without redesigning the admin or consumer workflows.

> **Critical production rule:** The current Cloudflare AI Search implementation remains the production retrieval provider until the Qdrant + Vertex AI path passes every quality, authorization, latency, load, cost, recovery and rollback gate in this document. This approval is an architecture decision, not permission to change production infrastructure immediately.

## 1. Executive decision

Keep the product, user journey, admin workflows, data ownership and private API contract. Modernize the backend providers behind BRVIN Core.

The target is:

- **Cloudflare Workers:** keep as the application/runtime and private service host.
- **Cloudflare D1:** keep as the authoritative registry for projects, sources, readiness, application/environment identity, grants, quotas and audit.
- **Cloudflare Workflows:** keep as the durable ingestion and recovery orchestrator initially.
- **Google Cloud Storage:** keep private PDF, OCR output and durable derived-artifact storage.
- **Google Cloud Vision:** keep the existing OCR operation; do not re-OCR files just because the index provider changes.
- **Vertex AI embeddings:** use a paid, quota-managed Vertex AI embedding model for both document chunks and incoming questions. Select the exact model, region, dimensions and version through the pilot benchmark; do not hard-code an unverified model assumption.
- **Qdrant Cloud:** use Qdrant as the production vector/hybrid retrieval store after the pilot. Use a non-production deployment for the proof of concept; use an appropriately provisioned Qdrant Cloud production tier for production, not a free prototype node.
- **Hybrid retrieval:** use dense vectors plus BM25/sparse full-text retrieval and reciprocal-rank fusion (RRF). Tune weights/limits using the Physics pilot and a representative corpus.
- **Reranking:** optional. Add a separately hosted reranking provider only if measured evidence quality improves enough to justify its added latency and cost. Do not assume a reranker is required on day one.
- **Consumer generation:** stays in each consumer. BRVIN returns bounded evidence and physical PDF page provenance; BRVIN does not create the student's final answer.

The existing Cloudflare AI Search provider and its current retrieval configuration remain available as the baseline and rollback provider until the final legacy-retirement gate is passed.

## 2. What must stay the same

The user-facing product is not being rebuilt. The following behavior remains stable in both BRVIN Admin in parmar-ai and the BRVIN Teachers Operator Console:

1. Teacher/tenant workspace, teacher, classroom/project, collection/bookshelf and source/document creation.
2. Secure PDF upload, including the existing resumable upload and recovery behavior.
3. The existing Google Vision OCR stage and page-count discovery.
4. The same five-step source lifecycle: **Secure upload → OCR → Page indexing → Retrieval quality checks → Ready**.
5. The same per-page indexing map, page counts, page states, progress indicators and stage-level failure visibility.
6. The same Retry/Resume action and idempotent recovery behavior.
7. The same READY rule: every expected page is indexed and retrieval QA has passed.
8. The same project/collection/source ownership and permission controls.
9. The same operator workflow for inspecting a source and diagnosing failed pages.
10. The same student-facing answer experience, including source title and physical PDF page citations.

The workflow stays familiar even though the service performing page indexing changes.

## 3. Deliberate, small UI wording changes

Prefer vendor-neutral product language. Do not redesign page layout, navigation, visual style, cards, steppers or page-map geometry as part of this migration.

| Current wording / concept | Target wording | Rule |
|---|---|---|
| AI Search (when shown to an operator as the product capability) | Search index or Retrieval index | Avoid coupling the UI to a provider name. |
| Page indexing | Page indexing | Keep the existing step label. |
| Indexing page N | Indexing page N | Keep the familiar per-page progress language. |
| Provider-specific internal substate | Preparing chunks / Generating embeddings / Writing to search index / Verifying retrieval | Show only in expanded technical details or diagnostics. |
| AI Search retrieval test | Retrieval test | Keep the task name; do not expose provider implementation in the normal workflow. |
| Qdrant / Vertex model diagnostics | Provider details | Advanced/operator-only diagnostics may show provider, model/version, dimensions and index generation. |

The five top-level stages do not change. A user should not need to understand vectors, embeddings, BM25 or Qdrant to upload and manage a book.

Core and Teachers may show the provider name in a technical diagnostics panel for troubleshooting. Do not put provider branding in the normal page-map tiles, READY badge, student UI or core upload flow.

## 4. Target architecture and ownership boundaries

### 4.1 Ingestion

1. The existing admin initiates a source upload through the current Core management path.
2. The existing upload gateway stores the original PDF in private GCS.
3. The existing Workflow starts/continues the Vision OCR operation and verifies the OCR output.
4. The Workflow creates deterministic page chunks from the persisted OCR text using a versioned chunker. Start with the already tested pilot setting of **256 tokens per chunk with 10% overlap**; benchmark alternatives before changing it.
5. Core persists a versioned, durable chunk manifest and chunk text in a private GCS-derived-artifact prefix (or an equivalently durable private store). Do not make Qdrant the only copy of OCR-derived text or chunks.
6. Core calls Vertex AI embeddings in bounded batches with concurrency limits, retry/backoff and explicit quota handling.
7. Core upserts vectors, text and source metadata into the Qdrant collection using deterministic point identifiers.
8. Core runs the retrieval quality checks against the new provider and the same physical page/source constraints.
9. D1 records stage/page state and the final readiness decision. The source becomes READY only when every expected page is present and the QA gate succeeds.
10. The existing page-map and five-stage UI read the same persisted Core lifecycle model.

A provider retry must be safe to repeat. It must never re-run Vision OCR merely to retry chunking, embeddings or vector upsert.

### 4.2 Retrieval

1. The consumer calls the existing private BRVIN v2 Service Binding contract.
2. Core resolves the caller from the trusted binding identity and checks active application/environment state.
3. Core checks the application-to-project grant, project state, source grants, source readiness and quota in D1.
4. Core resolves the server-authorized source/item-key allowlist. The caller and browser do not supply trusted Qdrant collection names or arbitrary filters.
5. Core obtains the question embedding from Vertex AI using the same embedding-model/version family used for the indexed corpus.
6. Core runs one unified hybrid retrieval path across the authorised corpus: dense + BM25/sparse retrieval with RRF, constrained by server-built project/source filters. It does not route theory, formula, worked-example and numerical questions into separate subject bots or isolated indexes. Content-type metadata may support scoring, filtering within the already authorised scope and diagnostics, but must not create brittle hard-routing modes.
7. Core validates returned point IDs, source keys, item keys and physical PDF page metadata against the D1-authorized allowlist before returning evidence.
8. Core returns the same bounded evidence and provenance response shape currently expected by v2 consumers.
9. The consumer continues using its own Gemini/model, prompts, conversation state and response delivery.

BRVIN must never use Qdrant as the source of authorization truth. A revoked grant must block retrieval immediately even when the corresponding vector points still exist.

### 4.3 Provider boundary

Introduce a small provider boundary inside Core. Keep the RPC entrypoint and consumer adapter separate from the storage/search implementation.

- Keep a legacy Cloudflare AI Search provider for baseline, shadow comparison and rollback.
- Add a Qdrant provider behind the same Core-owned retrieval interface.
- Separate document/question embedding behind an embedding-provider boundary so model changes are versioned and testable.
- Keep provider selection server-side via deployment configuration/feature flags. Never accept provider selection from a consumer request or browser.
- Keep the v2 RPC request/response shape unchanged unless a separately reviewed, additive contract change is proven essential. Provider migration alone is not a reason to version or redesign the consumer API.

A provider interface must cover the operations actually needed by Core: deterministic upsert, query, source/index deletion, provider/index health and version/diagnostic metadata. Avoid a large generic framework.

### 4.4 Qdrant data model and durable corpus

Each indexed point should carry enough non-secret payload to validate provenance and apply safe search filters. At minimum:

- BRVIN project ID;
- source/book ID and collection ID where applicable;
- stable source item key;
- physical PDF page number;
- deterministic chunk ID and chunk index;
- chunker version and overlap/size configuration;
- content hash;
- embedding model/version and vector generation;
- source/index generation identifier;
- original OCR text, preserved without destructive normalization;
- normalized searchable text, stored as a separate versioned representation;
- formula/LaTeX text and a normalized formula-search representation when reliably extractable;
- content-type tags where confidently classified (explanatory text, definition, formula, worked example, numerical problem, answer key);
- OCR/extraction confidence or uncertainty signals when available, with physical-page provenance.

Use deterministic IDs derived from the immutable source/page/chunk identity plus the chunker and embedding generation. Re-indexing the same generation must upsert rather than duplicate. New embedding dimensions or incompatible embedding versions must use a separate collection/generation and a controlled rebuild.

The canonical original PDF and OCR outputs remain in private GCS. The chunk text/manifest must also be durable, versioned and recoverable independently of Qdrant. Define a dedicated retention policy for derived chunk artifacts; do not accidentally subject the only rebuildable corpus copy to the OCR cleanup rule.

### 4.5 Unified math-aware retrieval policy

BRVIN must retrieve mixed educational content through one unified retrieval system—not separate theory, maths, numerical or subject-specific bots. A single student question may need explanatory prose, a definition, an equation, a worked example and a numerical setup; the candidate-generation and evidence-return path must be able to retrieve all of these together.

- Preserve the raw OCR text as the immutable source-derived representation. Never overwrite it with cleaned or normalized text.
- Store normalized searchable text separately and version its normalization rules.
- Where the OCR/source extraction actually provides it, retain formula text/LaTeX and a separate normalized formula-search representation. Preserve the original expression alongside any normalized form; normalization must not erase sign, exponent, subscript, fraction, vector, unit or operator distinctions.
- Attach content-type metadata such as `explanatory_text`, `definition`, `formula`, `worked_example`, `numerical_problem` and `answer_key` only as descriptive signals. Use it for optional ranking/diagnostics, not as a mandatory route that can hide useful evidence from another content type.
- Dense retrieval contributes semantic matching; BM25/sparse retrieval contributes lexical and symbol-token matching; RRF combines ranked candidate lists. Do not claim that BM25 over raw LaTeX guarantees exact mathematical equivalence or exact symbol discrimination. Tokenization, OCR quality and notation variation must be tested.
- A mixed query should be able to return both conceptual explanation and the relevant formula/numerical passage, with the physical PDF page and source identity attached to every result.
- Where formula extraction or OCR is uncertain, preserve the uncertainty and source-page reference. Do not silently present a corrupted OCR equation as a verified formula; the original PDF remains the audit reference.
- Formula-aware extraction/normalization must be versioned and rebuildable like chunking and embeddings. It must not make Qdrant the sole copy of the source-derived content.

This migration is a retrieval/indexing project, not a new symbolic algebra engine or an answer-generation service. Final explanation remains consumer-owned. Exact calculation tooling, where needed by a consumer, is a separate consumer-level decision and must not be simulated by silently altering retrieved source values.

### 4.6 Authorization, isolation and deletion

- D1 remains authoritative for ownership, readiness, grants, quotas and revocation.
- Build Qdrant filters only from the current server-side D1 authorization result.
- Validate every returned item against the authorised key allowlist after retrieval.
- Never trust a project ID, collection name, source list, Qdrant filter or provider name supplied by an untrusted client.
- On source/project deletion, enqueue idempotent Qdrant cleanup and track completion. Logical D1 access is revoked first; physical vector deletion may follow asynchronously.
- Keep audit events content-free and do not log embeddings, raw question text, source text or secrets.
- A missing/unavailable Qdrant or Vertex AI dependency fails closed. Do not silently fall back to a broader query or another project's data.

## 5. Explicitly retained and replaced components

| Component | Decision | Reason |
|---|---|---|
| Cloudflare Workers runtime | Keep | Runtime and application hosting are separate from Workers AI. |
| Cloudflare D1 | Keep initially | Registry, grants, readiness, quota and audit authority. |
| Cloudflare Workflows | Keep initially | Existing durable ingestion, recovery and QA orchestration. |
| GCS private source storage | Keep | Durable source-of-truth for original PDFs. |
| Google Vision OCR | Keep | Proven OCR pipeline; migration is downstream of OCR. |
| Cloudflare AI Search | Replace only after gated rollout | New Qdrant retrieval provider; old index remains rollback during the soak period. |
| Workers AI embeddings used by retrieval | Replace after model/quality/quota tests | Vertex AI becomes the embedding provider. |
| Workers AI BGE reranking | Do not assume a direct replacement | Benchmark Qdrant hybrid retrieval first; add an external reranker only if needed. |
| Consumer Gemini generation | Keep | Final answer generation remains consumer-owned. |
| BRVIN v2 private RPC | Keep unchanged | Protect existing consumers and avoid a coordinated breaking migration. |

This work does **not** replace all Cloudflare infrastructure and does not require migrating D1, Workflows, the upload gateway, admin hosting or consumer Workers.

## 5.1 M13 Core implementation state — merged 8 November 2026

M13 PR [#147](https://github.com/ashini-x/parmar-ai/pull/147) was squash-merged into `main` on 8 November 2026 as `4ab292ff57addef051b28e32477e2136d91add8d`. Its final-head Release validation [#42470635764](https://github.com/ashini-x/parmar-ai/actions/runs/42470635764) passed TypeScript, 259 Vitest tests, 54 Node tests and both Worker dry-runs. The merge triggered the normal paired Core release; Cloudflare metadata records `parmar-ai` version `44edc5d7-ba06-4623-80fa-47dbef8f998f` and private `brvin-service` version `ab1b92da-71b9-4fef-be09-94f313389a85` at 100% traffic. The deployment did not change the provider selector or enable corpus writes. The merged implementation includes:

- `src/brvin/provider-contract.ts`: a narrow `RetrievalProvider` port for upsert, query, item/source deletion and health, plus a separate `EmbeddingProvider` port. The concrete adapter available in M13 is Cloudflare AI Search only; an unknown provider selection fails closed.
- `src/brvin/retrieval.ts` and `src/fatman/workflow.ts`: existing semantic query, page upsert and source deletion are routed through the Core adapter. The v2 request/response shape, D1 permission/readiness/quota checks, source-prefix constraints, page-key validation and bounded evidence remain unchanged.
- `src/brvin/corpus.ts`: deterministic Unicode lexical/symbol chunking (256 lexical tokens, 26-token overlap), SHA-256 chunk identities/content hashes, NFC + whitespace-only normalized text, descriptive content tags and conservative formula-line candidates. Original formula text is stored beside a clearly marked `candidate-unverified` normalized representation; the heuristic does not claim mathematical correctness or repair OCR. Page manifests retain the stable Core item key and physical PDF page. Vision page confidence is recorded only when the OCR response supplies it; missing confidence is explicitly marked `page-confidence-not-returned`, and a supplied score is a source signal rather than a correctness guarantee.
- `src/brvin/corpus-store.ts`: immutable source-generation and per-physical-page manifests in private GCS under `brvin/derived-corpus/{sourceId}/{generationId}/`, outside the temporary Vision OCR prefix. The generation ID includes the original PDF hash, persisted Vision operation ID and chunker/normalizer versions; each generation has one fixed `pages/page-{pdfPage}.json` object. Create-only writes accept only byte-identical retries; changed OCR output requires a new Vision operation/generation rather than overwriting or leaving competing page versions in one generation. Full source deletion includes the derived-corpus prefix; the 30-day Vision-only lifecycle rule does not.
- The raw Vision OCR string is preserved unchanged in page manifests. The existing legacy AI Search payload continues using its previous bounded/sanitized representation.

The corpus writer is gated by `BRVIN_CORPUS_MANIFEST_ENABLED` and defaults off. Production pins `BRVIN_CORPUS_MANIFEST_ENABLED=false` and `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`. Cloudflare currently reports the paired Worker versions above at 100% traffic; no Vertex model call, Qdrant collection, API key or route was enabled by the M13 release.

## 5.2 M14 implementation state — non-production pilot branch

M14 adapter/replay foundation PR [#148](https://github.com/ashini-x/parmar-ai/pull/148) was squash-merged into `main` as `8d665b48f08cc7197ca306cb0b00417d2321fc72`. Final CI passed TypeScript, 277 Vitest tests, 54 Node tests and both Worker dry-runs. The remaining safe backfill step is being developed on `brvin/m14-physics-vision-backfill`. This is still not a completed or live-verified pilot:

- `src/brvin/corpus-reader.ts` reads the immutable source manifest and every physical page manifest from private GCS. It recomputes the deterministic generation ID, verifies raw OCR and normalized-text SHA-256 values, verifies chunk identities/content hashes and refuses incomplete page generations.
- `src/brvin/m14-pilot-runner.ts` replays the verified page/chunk manifests to a provider sequentially. It has no PDF upload or Vision OCR dependency, checks complete page/chunk counts, and preserves page key, project/source identity and generation provenance.
- `src/brvin/vertex-embedding.ts` implements Vertex REST document/query embeddings using the `gemini-embedding-001` model ID, `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task types and explicitly configured output dimensions. Inputs are sent one at a time; silent truncation and dimension mismatches are rejected. The actual non-production region, dimensions, quota and model version still need live verification.
- `src/brvin/qdrant-hybrid-pilot.ts` implements an isolated named dense + sparse collection, Qdrant IDF sparse scoring, deterministic point IDs, dense+sparse prefetch with RRF, exact project/source filters on each prefetch and the final query, post-retrieval authorization checks, and source-scoped deletion. Sparse token IDs retain case and mathematical operator distinctions. Existing collections with an incompatible dense/sparse schema are rejected rather than mutated.
- `src/brvin/m14-physics-evaluation.ts` records the existing three-page Physics pilot identity and a fixed query matrix for theory, exact formula, paraphrase, equivalent notation, symbol sensitivity, worked examples, numerical setup, mixed theory+math, friction, bus braking and no-answer behavior. Only Newton page 2, the 4 kg worked example page 3 and bus-braking answer page 3 / related explanation page 1 have prior retrieval evidence. The other page labels remain explicitly pending OCR-ground-truth inspection; the fixture file does not claim they have passed.
- `src/brvin/m14-vision-backfill.ts` orchestrates a one-time backfill from the already-completed Google Vision operation. It checks the exact D1 import/source identity, original PDF SHA-256, saved operation ID, completed status, operation output prefix and exactly one stored `output-N-to-N.json` object per physical page before reading any page. It reuses `readFatmanVisionOutputPage` and `fatmanIndexPageKey`; it does not upload the PDF or call Vision submission. Writes go to `BRVIN_M14_CORPUS_BUCKET`, which must be distinct from the original `FATMAN_GCS_BUCKET`. The operation is fail-closed unless `ENVIRONMENT=staging` and `BRVIN_M14_PILOT_ENABLED=true`.
- Unit tests mock Vertex and Qdrant HTTP responses. They validate request shapes, deterministic replay/point IDs, hybrid RRF, symbol-sensitive sparse terms, project/source filters, post-validation and failure behavior. These tests do not replace a live non-production Vertex/Qdrant acceptance run.

The registered pilot source is `Force and Laws of Motion - Class IX pilot handout` (`01238b3a-9902-4a42-90b4-574048ee4f00`), under Physics project `448249b4-fed9-45f5-9137-6014f242ddbe`. D1 reports it READY at 3/3 pages, SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, with saved Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2`. The source PDF must not be re-uploaded and Google Vision must not be rerun. Because the production manifest flag was false, no derived manifest for this source is assumed to exist; the non-production pilot must first persist/replay the existing stored Vision outputs into the derived corpus.

The staging backfill branch adds only optional M14 environment types and guarded code. Production Wrangler configs are unchanged; no M14 values or secrets are present there. No Qdrant cluster/collection is provisioned, no non-production Vertex service-account/region/quota has been verified, and no M14 live-provider query has been executed. Production remains on AI Search; the existing v2 RPC, D1 authorization/readiness/quota checks and consumer response path are unchanged.

## 6. Milestones and acceptance gates

The numbering extends the completed M6–M11 baseline. M12–M17 are the BRVIN retrieval modernization sequence. M12 is complete; M13 provider-boundary and corpus-writer code is merged; M14 adapters/replay support are under review. No replacement provider is active for production, and no M14 Qdrant resource or live Vertex pilot has been provisioned.

| Milestone | Owner(s) | Scope | Acceptance gate | Initial status | Tracking |
|---|---|---|---|---|
| **M12 — Architecture and UX contract freeze** | Core + Teachers | Record provider decision, trust boundaries, compatibility rules, target flow, milestone sequence and UI preservation. | Canonical docs in both repos link to one plan; current production path and no-migration guardrail are explicit. | **COMPLETE — documentation**  | [Core #141](https://github.com/ashini-x/parmar-ai/issues/141) |
| **M13 — Core provider boundary and rebuildable, math-aware corpus** | Core | Define provider/embedding interfaces; deterministic chunker and durable manifests; preserve raw OCR plus versioned normalized text and optional formula/LaTeX representations; content-type metadata; deterministic IDs and replay tests. No production provider switch. | Existing AI Search remains green; replay is deterministic; formula metadata never replaces raw OCR; mixed-content chunks preserve source/page identity; v2 contract unchanged; D1 remains authorization authority. | MERGED — replay-reader/re-index acceptance is being added by M14 branch; production corpus flag remains false  | [Core #142](https://github.com/ashini-x/parmar-ai/issues/142) |
| **M14 — Vertex AI + Qdrant unified hybrid Physics pilot** | Core | Provision non-production Qdrant; verify the Vertex embedding model/region; reuse the existing Physics OCR and add only approved representative formula/numerical fixtures or corpus samples; index unified dense + sparse/BM25 representations with RRF. | Conceptual, exact-formula, paraphrase, equivalent-notation, worked-example, numerical and mixed theory+math queries return relevant evidence with exact source/page provenance; OCR uncertainty is visible; re-index is deterministic; production stays on AI Search. | IN PROGRESS — adapter and mocked-test implementation; non-production resources and live validation pending  | [Core #143](https://github.com/ashini-x/parmar-ai/issues/143) |
| **M15 — Shadow benchmark for relevance, math fidelity, security, load and cost** | Core | Compare AI Search and Qdrant on the same versioned corpus and unified mixed-content query suite; shadow without changing answers; measure p50/p95/p99, quality, formula/symbol fidelity, provenance, cost, concurrency 1/50/100/500/1,000, throttling and recovery. | No authorization/provenance regression; overall and math-specific quality meet the agreed baseline; exact formula/symbol cases and mixed queries pass; failures/OCR uncertainty are reported; 500-concurrency behavior, rollback and cost gates pass. | PLANNED  | [Core #144](https://github.com/ashini-x/parmar-ai/issues/144) |
| **M16 — Consumer and admin experience parity** | Core + Teachers | Connect the same v2 contract to the provider flag; preserve both admin UIs, five stages, page map, source CRUD, retry and READY gating; update only provider-specific wording/advanced diagnostics; test the real consumer. | User can perform the same upload/manage/retrieval journey without retraining; consumer code has no direct Vertex/Qdrant access; existing response/citation UI works; grant revoke/re-grant still passes. | PLANNED  | [Core #145](https://github.com/ashini-x/parmar-ai/issues/145) · [Teachers #18](https://github.com/ashini-x/brvin-teachers/issues/18) |
| **M17 — Controlled production cutover and legacy retirement** | Core + Teachers | Stage rollout using a provider flag; canary/shadow, gradual traffic, monitor and roll back; retain AI Search during the soak; retire Workers AI/AI Search only after acceptance and explicit review. | Production quality, access, page provenance, load, failure, cost and UI tests pass; rollback is demonstrated; at least 14 days of stable full-production soak completed before legacy deletion; docs/runbooks reflect actual deployed state. | PLANNED  | [Core #146](https://github.com/ashini-x/parmar-ai/issues/146) |

M12 is documentation work only. M13 provider/corpus-writer code is merged, while the verified replay-reader and OCR-free re-index path are being delivered as an M14 prerequisite. M14 remains incomplete until the isolated Vertex/Qdrant environment is provisioned and live acceptance passes. A green code PR does not authorize a production provider cutover. M14–M17 are not production deployment steps merely by being listed. Each milestone must be implemented, tested, reviewed and released through the repositories' normal controls.

## 7. Benchmark protocol and performance goals

The current M11 acceptance is evidence of useful retrieval, correct physical page provenance and authorization revocation/restoration. It is **not** a measured latency baseline. Before comparing providers, capture the current AI Search path under the same region, corpus, query set, request shape and load profile.

Measure separately:

- question-embedding latency;
- Qdrant dense retrieval, BM25 and RRF latency;
- optional reranker latency;
- end-to-end BRVIN retrieval latency (entry to bounded evidence response);
- final consumer model-generation latency (reported separately);
- p50, p95 and p99 latency, throughput and error/timeout rate;
- quality (relevance, recall at k, rank position, passage usefulness and physical page correctness);
- embedding/indexing throughput, retry rate and time to READY;
- cost per 1,000 retrievals, per 1,000 embedded pages/tokens and stored-index capacity;
- behavior at 1, 50, 100, 500 and 1,000 concurrent requests.

Initial engineering goals for the **retrieval component only** are p50 below 250 ms and p95 below 700 ms, with stable operation at 500 concurrent requests. These are aspirational acceptance targets, not measured results or service guarantees. The decision must also consider quality and cost; do not accept a faster provider if evidence relevance, citation accuracy or authorization is worse. If these targets prove unrealistic for the selected Vertex endpoint/region, record the measured baseline and approve a reasoned target change rather than hiding the result.

Run the same Physics pilot queries used by the current retrieval test. The fixed suite must include conceptual/theory, exact formula and symbol-sensitive retrieval, paraphrase, equivalent notation, worked example, numerical setup, unit-bearing query, mixed theory+math, cross-page reasoning, lexical lookup and no-answer cases. Include controlled OCR-noise/uncertainty cases and hard negatives where a one-character or operator difference changes meaning (for example, minus vs hyphen, `x` vs `×`, subscript vs ordinary digit, or exponent changes). Add representative multi-page PDFs or approved test fixtures before any production decision. Report results by query class as well as overall; a strong aggregate score must not conceal weak formula retrieval. Test source revocation while vectors remain physically present to prove D1 authorization and post-query validation work independently of vector cleanup.

## 8. Rollout and rollback policy

1. Preserve the current AI Search namespace/items and current provider implementation.
2. Build the provider boundary and Qdrant index in non-production.
3. Rebuild the Physics pilot from existing stored OCR output. Do not re-upload the PDF or call Vision again.
4. Run shadow comparisons. User-facing answers continue to come from the current production provider.
5. Pass M15 and M16; rehearse provider-flag rollback.
6. Roll out Qdrant by controlled canary/traffic percentage. Keep the legacy path warm and queryable.
7. Monitor quality, page provenance, authorisation denials, latency, errors, usage and cost at each step.
8. If a gate regresses, switch the server-side provider flag back to AI Search. Do not alter consumer code or grants to work around a retrieval-provider fault.
9. Keep both providers during at least a 14-day stable full-production soak. Only then may a separate explicit review approve deletion of the legacy index/provider and Workers AI dependencies.

The rollback switch must be server-controlled, auditable and tested. Never make an unreviewed migration irreversible.

## 9. Cross-repository responsibility split

### ashini-x/parmar-ai (BRVIN Core)

Owns the retrieval provider abstraction, chunking/manifest, Vertex embedding integration, Qdrant storage/search integration, D1 authorization/filter construction, provider rollout flag, ingestion/QA updates, provider metrics, recovery and Core admin diagnostics.

Core owns the provider migration; it is not implemented in the consumer by direct Qdrant access.

### ashini-x/brvin-teachers (downstream consumer)

Owns the Operator Console and student-facing experience. It continues calling the existing BRVIN v2 private binding and continues generating its own answers. Its migration work is limited to verifying compatibility, preserving the current UI/workflow, replacing provider-specific wording where present with neutral labels, and optionally displaying safe provider diagnostics returned through an approved operator-only route.

No Qdrant credentials, Vertex credentials, embedding logic, Qdrant SDK or direct AI Search dependency may be added to the consumer.

### Coordination rule

Any change to the v2 response contract, management RPC lifecycle, readiness semantics or source metadata requires a coordinated Core-first PR and consumer PR. Prefer no contract change. Update both repositories' docs in the same coordinated delivery and state exactly which Core commit/contract revision the consumer expects.

## 10. Non-goals and guardrails

- Do not redesign either admin panel or rebuild the upload flow.
- Do not move GCS, Vision OCR, D1 or Workflows as part of this retrieval-provider migration.
- Do not create a database, Qdrant cluster, index or ingestion pipeline per teacher or student.
- Do not allow consumer/browser direct access to Qdrant, Vertex AI, GCS, Core D1 or provider credentials.
- Do not make Qdrant payload filters the only isolation control.
- Do not re-upload or re-OCR existing READY documents just to change the index provider.
- Do not remove the current AI Search implementation before the production soak and rollback acceptance.
- Do not claim a speedup until same-condition benchmarks have been run and recorded.
- Do not change student answer generation, prompts, user authentication, chat history or consumer quota as part of the provider migration.

## 11. New-chat continuation

For a new chat, read this file after the Core master plan and inspect the latest commits, issues, implementation and production state in both repositories. M12 documentation is complete; M13 is the next implementation milestone. Current production remains on Cloudflare AI Search; do not assume Vertex, Qdrant or a new index has been provisioned. Implement one unified math-aware hybrid retrieval path for theory, formulas, worked examples and numerical problems—never separate subject bots—and preserve raw OCR, formula/source uncertainty and physical page provenance. Keep D1 as authorization authority, v2 unchanged, both admin experiences familiar, and Core/Teachers docs synchronized.

