# BRVIN Retrieval Provider Modernization — Approved Architecture and Migration Plan

**Decision date:** 8 November 2026
**Status reviewed:** 13 November 2026 — M14 is complete as the scoped non-production Vertex/Qdrant Physics pilot; M15 remains active. The paired 17-query retrieval/34-generation OCR-only evaluation, five-query/ten-generation original-PDF notation audit and owner-waived AI assessment of 109 candidates are complete; the AI assessment is not independent human qrels and human-review fields remain blank. Live Core v2 authorization/revocation passed 8/8 under receipt `e305a581-3d3c-469c-b2b5-093598783df4`. Corrective Core PR #241 fixed the Items Workers upload metadata wire format; the custom metadata schema continues to define `pdf_page` as numeric. Protected two-source Prepare has now succeeded and the independent staging read-back confirms both authorized sources READY, 7 second-source Qdrant points, 3 completed AI Search page items with `pdf_page` 1–3, and no paired evaluation receipt yet. Core Release validation #43317133059 and staging workflow #43317133051 passed; Worker `a1158a7c-4422-4768-93e0-140363e791c2` is deployed at 100% via deployment `b46a8d37-362c-4ac3-94f8-68f602d367a3`. The next action is the protected five-case paired Core v2 evaluation (ten staging query reservations). Production remains on Cloudflare AI Search, with no production Qdrant/Vertex bindings or cutover.
**Status:** APPROVED DESIGN / M13 MERGED / M14 PILOT COMPLETE / M15 SHADOW BENCHMARK ACTIVE / NO PROVIDER CUTOVER  
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

M13 PR [#147](https://github.com/ashini-x/parmar-ai/pull/147) was squash-merged into `main` on 8 November 2026 as `4ab292ff57addef051b28e32477e2136d91add8d`. Its final-head Release validation [#42470635764](https://github.com/ashini-x/parmar-ai/actions/runs/42470635764) passed TypeScript, 259 Vitest tests, 54 Node tests and both Worker dry-runs. The merge triggered the normal paired Core release; The latest Cloudflare metadata check (8 November 2026, approximately 10:45 UTC) records `parmar-ai` version `b40095a5-fbe7-4e49-ae6b-67ce5d1b85d0` / deployment `006ed2c3-c6fd-4fab-adb0-0019008883d6` and private `brvin-service` version `f98de22d-6441-4148-98a5-403c62b0f357` / deployment `a5720b14-43f5-4291-961d-aa8e6c8ac5c2`, both at 100%. This is deployment metadata, not a new live health acceptance run. The deployment did not change the provider selector or enable corpus writes. The merged implementation includes:

- `src/brvin/provider-contract.ts`: a narrow `RetrievalProvider` port for upsert, query, item/source deletion and health, plus a separate `EmbeddingProvider` port. The concrete adapter available in M13 is Cloudflare AI Search only; an unknown provider selection fails closed.
- `src/brvin/retrieval.ts` and `src/fatman/workflow.ts`: existing semantic query, page upsert and source deletion are routed through the Core adapter. The v2 request/response shape, D1 permission/readiness/quota checks, source-prefix constraints, page-key validation and bounded evidence remain unchanged.
- `src/brvin/corpus.ts`: deterministic Unicode lexical/symbol chunking (256 lexical tokens, 26-token overlap), SHA-256 chunk identities/content hashes, NFC + whitespace-only normalized text, descriptive content tags and conservative formula-line candidates. Original formula text is stored beside a clearly marked `candidate-unverified` normalized representation; the heuristic does not claim mathematical correctness or repair OCR. Page manifests retain the stable Core item key and physical PDF page. Vision page confidence is recorded only when the OCR response supplies it; missing confidence is explicitly marked `page-confidence-not-returned`, and a supplied score is a source signal rather than a correctness guarantee.
- `src/brvin/corpus-store.ts`: immutable source-generation and per-physical-page manifests in private GCS under `brvin/derived-corpus/{sourceId}/{generationId}/`, outside the temporary Vision OCR prefix. The generation ID includes the original PDF hash, persisted Vision operation ID and chunker/normalizer versions; each generation has one fixed `pages/page-{pdfPage}.json` object. Create-only writes accept only byte-identical retries; changed OCR output requires a new Vision operation/generation rather than overwriting or leaving competing page versions in one generation. Full source deletion includes the derived-corpus prefix; the 30-day Vision-only lifecycle rule does not.
- The raw Vision OCR string is preserved unchanged in page manifests. The existing legacy AI Search payload continues using its previous bounded/sanitized representation.

The corpus writer is gated by `BRVIN_CORPUS_MANIFEST_ENABLED` and defaults off. Production pins `BRVIN_CORPUS_MANIFEST_ENABLED=false` and `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`. Cloudflare currently reports the paired Worker versions above at 100% traffic; no Vertex model call, Qdrant collection, API key or route was enabled by the M13 release.

## 5.2 M14 implementation state — live isolated staging pilot (10 November 2026)

M14 foundation, corpus recovery, staging operator, Vertex/Qdrant indexing/evaluation routes and the Qdrant error-diagnostic correction are merged into Core `main`. The relevant merged PRs are [#148](https://github.com/ashini-x/parmar-ai/pull/148), [#149](https://github.com/ashini-x/parmar-ai/pull/149), [#152](https://github.com/ashini-x/parmar-ai/pull/152), [#155](https://github.com/ashini-x/parmar-ai/pull/155), [#156](https://github.com/ashini-x/parmar-ai/pull/156), [#157](https://github.com/ashini-x/parmar-ai/pull/157), [#159](https://github.com/ashini-x/parmar-ai/pull/159), [#160](https://github.com/ashini-x/parmar-ai/pull/160), [#169](https://github.com/ashini-x/parmar-ai/pull/169), [#171](https://github.com/ashini-x/parmar-ai/pull/171), [#174](https://github.com/ashini-x/parmar-ai/pull/174), [#177](https://github.com/ashini-x/parmar-ai/pull/177), [#182](https://github.com/ashini-x/parmar-ai/pull/182), [#186](https://github.com/ashini-x/parmar-ai/pull/186) and [#188](https://github.com/ashini-x/parmar-ai/pull/188). Core PR [#194](https://github.com/ashini-x/parmar-ai/pull/194) is squash-merged as `ab3974bc7b0125498a6d0c2453018b3e75e61fca` (10 November 2026); Core main includes the intent-weighted M14 fusion implementation and its seven-candidate regression fixture.

### Verified corpus and staging configuration

The retained Physics PDF was processed through the one-time staging OCR recovery path; no PDF re-upload was needed. The immutable corpus generation `57129957231e548064e5594d8fb9f501` has been independently read back and verified: source SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, recovered Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff`, three physical PDF pages and seven deterministic chunks (2/2/3). Raw OCR hashes, normalized-text hashes, chunk identities and formula metadata were verified.

The dedicated staging Worker is `parmar-ai-m14-staging` at `https://parmar-ai-m14-staging.thenewtongs.workers.dev`. PR #194 first deployed Worker version 73; Core PR #196 subsequently corrected worded-formula intent routing and the current version-74 deployment is confirmed at 100% by Cloudflare read-back (`330f46a7-6b69-4359-b7e0-ccb43fce0d2c`; deployment `274fdb7c-c405-4ae4-be61-e53d50f0d6f0`). M14 workflow #61 and Core Release validation #1050 passed before merge. Vertex `gemini-embedding-001` in `asia-south1`, 768 dimensions, Qdrant collection `brvin_m14_physics_pilot_v1` and the HTTPS endpoint remain configured. The dedicated D1 and GCP/admin/Qdrant secret bindings remain present; `BRVIN_M14_QDRANT_API_KEY`, `BRVIN_M14_ADMIN_TOKEN` and GCP credentials are secret bindings, never plaintext vars.

### Live indexing and current retrieval blocker

The authenticated operator's **Qdrant indexing completed** action returned success. The implementation sends the seven verified chunks through Vertex document embeddings, upserts seven deterministic points, waits for completed Qdrant writes and reads back each point to validate its exact project, source, page, generation and chunk identity. This is live staging evidence, not full M14 acceptance.

The first post-fix **Run 3 known-evidence Physics retrieval checks** action completed successfully through Vertex embeddings and Qdrant dense+sparse/RRF. The operator returned `ok: true`, `queryCount: 3`, collection `brvin_m14_physics_pilot_v1`, model `gemini-embedding-001`, 768 dimensions and five results per query. The three result arrays were:

| Case | Expected pages | Retrieved top-five pages | Expected coverage | Top score |
|---|---:|---|---|---:|
| Newton's second-law concept | 2 | 2, 2, 1, 1, 3 | 2 | 0.8333334 |
| 4 kg worked example | 3 | 3, 3, 2, 2, 1 | 3 | 1 |
| Bus braking answer | 3, 1 | 3, 3, 1, 2, 2 | 3, 1 | 1 |

Thus all four expected physical-page references were present in the returned top five. Their first ranks were 1, 1, and 1/3 respectively. The score is the Qdrant fusion score, not a calibrated relevance probability.

The source document `Class_IX_Force_and_Laws_of_Motion_Teacher_Pilot.pdf` was found in the Library, read page by page and SHA-256 checked against the exact immutable M14 source hash `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`. It is therefore the same three-page PDF as the indexed M14 generation. Ground-truth findings:
- Physical PDF page 2 contains the explanation of Newton's second law and the canonical equation `Fnet = m × a`; the current `F = ma` expected-expression label was too loose and has been corrected.
- Physical PDF page 3 contains the worked 4 kg rough-floor example: 20 N rightward pull, 8 N leftward friction, resultant 12 N rightward, acceleration 3 m/s² rightward.
- Friction/net-force is therefore supported on page 3.
- Bus-braking inertia is explained on page 1; the learner answer-key explanation appears on page 3.

**Evaluation caveat:** the prior three-case endpoint returned `ok: true` when all three query operations completed; it did not itself enforce a quality threshold. The screenshot's `expectedPageCoverage` values prove complete expected-page coverage, but do not measure precision, irrelevant-result rate, exact formula fidelity or answer correctness.

Core PR #174 merged the ten-positive-case source-grounded evaluator and staging Worker version `5bb5c0af-6c11-4157-8f67-838a9e418866` is deployed at 100%. The first ten-positive staging receipt covered all 11/11 expected physical pages, with strict expected-page-label precision@5 of 0.40 and first-expected-page MRR of 0.8333333. After Core PR #177 added ranking fields, the user reran the ten positives. The second receipt again returned `queryCount=10`, 11/11 pages covered, 50 results, 20 expected-page-labeled results, precision@5 of 0.40, and MRR of 0.7833333. First expected-page ranks were `[1,2,3,1,2,1,1,1,2,1]`. Only the friction query moved from rank 1 to rank 2; its page-3 result count remains one, and the aggregate precision is unchanged. The MRR movement is therefore a rank-order change, not a page-coverage or expected-page-result-count regression. Page-label precision remains a diagnostic proxy, not human chunk-level relevance.

Core PR [#182](https://github.com/ashini-x/parmar-ai/pull/182) merged as `20a6a00` and introduced the authenticated, staging-only, non-gating negative/repeatability diagnostic. The user's run returned five candidates for each expected-no-match query; the supplied previews did not show the requested exact target. Three friction repeats returned one stable top-five set but two ordered sequences because the top two tied at `0.6666667`; expected page-3 rank was 2/1/1. This does not test answer abstention. Core PR [#186](https://github.com/ashini-x/parmar-ai/pull/186) merged as `0fa5b4c` and extends that diagnostic with a deduplicated `candidateEvidence` array containing complete stored chunk text, point/chunk IDs, physical page, content types and every query/repeat/rank/score association. M14 staging workflow [#49](https://github.com/ashini-x/parmar-ai/actions/runs/42547930766) passed validation and deployed Worker `f43676e0-d97b-492d-af6c-3495897e3f7b` (version 70) at 100%. Core Release validation [#1021](https://github.com/ashini-x/parmar-ai/actions/runs/42547930835) passed paired production deployment and smoke/acceptance; production provider settings still select AI Search and corpus-manifest writes remain disabled.

**Next:** run the authenticated positive and non-gating negative/repeatability diagnostics on staging version 74. Compare the weighted-fusion receipt with the recorded equal-weight baseline, inspect formula/paraphrase cases and score all results against `docs/BRVIN_M14_CHUNK_QRELS.md`. Measure the two-component-query latency/cost overhead. The operator token remains an unreadable Worker secret, so this authenticated call must be run through the staging UI by entering the existing token there; do not retrieve or replace the secret. This is query-only: do not rerun OCR, re-index or repeat the corpus indexing action. Do not claim answer abstention; the Teachers Gemini generation route is not deployed.

**HNSW/benchmark note:** the two payload indexes are being added to the already-populated seven-point pilot collection to restore strict-filter query functionality; no point rewrite is needed for this query fix. Qdrant recommends creating payload indexes before ingesting vectors so filter-aware HNSW edges can be built with those indexes present ([Qdrant indexing guidance](https://qdrant.tech/documentation/manage-data/indexing/)). Before representative M15 latency/load benchmarking, verify whether the collection has built an HNSW graph and rebuild/re-optimize it after the new payload indexes, or use a fresh benchmark collection where the payload indexes are created before point ingestion. Do not treat the seven-point pilot query repair as proof of large-corpus HNSW performance.

Ten positive cases now have source-grounded expected pages across the three-page PDF: conceptual law (page 2), exact formula (page 2, `Fnet = m × a`), paraphrase (page 2), equivalent notation (page 2), uppercase `Fnet` symbol (page 2), 4 kg worked example (page 3), numerical force setup (page 3), mixed theory+formula (page 2), friction/net-force (page 3), and bus braking/answer key (pages 1 and 3). Two negative cases are OCR-reviewed but deferred from the positive query run: lowercase `f = ma` is absent, and the Planck constant is absent from all three pages. Full M14 acceptance still requires actual retrieval results for the ten positive cases, a defined/evaluated negative-case abstention policy, formula/symbol fidelity, page provenance, project isolation, deterministic re-index, latency, throughput, HNSW optimization and cost evidence.

### Production and consumer isolation

Core Release validation #1047 for PR #194 passed typecheck, the full Vitest suite, Node tests and both Worker bundle validations. The paired Core release then deployed production `parmar-ai` version `0bc1b19b-4824-44a9-9de6-710afb687d6a` (version 700) and private `brvin-service` version `74bf2f0c-584c-44d0-9f60-86ce20d52064` (version 129), both at 100%. Version settings explicitly select `cloudflare-ai-search`; Core Admin has `BRVIN_CORPUS_MANIFEST_ENABLED=false`. The Qdrant adapter remains isolated to the M14 staging entrypoint, not either production Worker route. No provider cutover or user-facing provider route has changed.

The Teachers production Worker remains on version 12 (`68d6694c-6371-4cae-8a25-4af40ca15706`, deployment `31ff2a01-b0f4-4be8-92d3-63e2d91adddf`) at 100%; no consumer code, direct provider credentials, SDK, embedding logic or v2 contract change was introduced. The private v2 RPC, D1 authorization/readiness/quota checks and both admin workflows remain unchanged. The consumer owns any eventual final-answer generation, but the current Teachers repository does not yet implement a student/channel/model generation route.
 
## 6. Milestones and acceptance gates

The numbering extends the completed M6–M11 baseline. M12–M17 are the BRVIN retrieval modernization sequence. M12 is complete; M13 provider-boundary and corpus-writer code is merged. M14 adapter, OCR recovery, manifest backfill/read-back and Vertex/Qdrant operator code are merged and deployed. The M14 corpus is verified and the seven-point Vertex/Qdrant indexing action passed deterministic read-back/provenance validation; the three known-evidence Vertex/Qdrant hybrid queries now complete successfully after Core PR #171 added the missing `project_id`/`source_id` payload indexes; all 4/4 expected physical-page references appeared in the top five. The exact source PDF has now been checked against the manifest SHA, and Core is expanding the evaluation to ten positive source-grounded cases with explicit coverage/rank metrics; two negative/no-answer cases remain deferred. No replacement provider is active for production.

| Milestone | Owner(s) | Scope | Acceptance gate | Initial status | Tracking |
|---|---|---|---|---|
| **M12 — Architecture and UX contract freeze** | Core + Teachers | Record provider decision, trust boundaries, compatibility rules, target flow, milestone sequence and UI preservation. | Canonical docs in both repos link to one plan; current production path and no-migration guardrail are explicit. | **COMPLETE — documentation**  | [Core #141](https://github.com/ashini-x/parmar-ai/issues/141) |
| **M13 — Core provider boundary and rebuildable, math-aware corpus** | Core | Define provider/embedding interfaces; deterministic chunker and durable manifests; preserve raw OCR plus versioned normalized text and optional formula/LaTeX representations; content-type metadata; deterministic IDs and replay tests. No production provider switch. | Existing AI Search remains green; replay is deterministic; formula metadata never replaces raw OCR; mixed-content chunks preserve source/page identity; v2 contract unchanged; D1 remains authorization authority. | MERGED — provider boundary, immutable manifests and deterministic replay reader are implemented; the fixed Physics corpus was independently read back and replayed into the M14 staging index with deterministic point/provenance checks; production provider switch remains off and corpus writes remain default-off  | [Core #142](https://github.com/ashini-x/parmar-ai/issues/142) |
| **M14 — Vertex AI + Qdrant unified hybrid Physics pilot** | Core | Deliver the isolated non-production Vertex/Qdrant index, unified dense+sparse retrieval/RRF, fixed Physics corpus and source-grounded positive/negative/repeatability evidence. | Ten positive cases complete with provenance; formula-discovery ranking experiment reviewed; negative retrieval and repeatability receipts recorded; production remains on AI Search. | **COMPLETE — scoped pilot exit, 11 November 2026.** Staging Worker v78 is deployed and the immutable 3-page/7-chunk Physics corpus was indexed/read back. The ten-positive v78 receipt covers 11/11 expected pages and scores qrels v0.1 at nDCG@5 0.8853, MRR@5 0.9000, grade-2+ recall 1.0000 and precision 0.4000. The exact-formula query ranks both direct page-2 chunks first/second. Negative/repeatability results are documented. Independent human labels, broader corpus, provider comparison, latency/cost, authorization/revocation, retry/recovery and load are explicitly transferred to M15; their absence does not mean those gates passed. | [Core #143](https://github.com/ashini-x/parmar-ai/issues/143) |
| **M15 — Shadow benchmark for relevance, math fidelity, security, load and cost** | Core | Compare current AI Search and isolated Vertex/Qdrant across the fixed eight-page M15 benchmark plus a verified second Physics source through the real Core v2 resolver; assess formula/mixed-query coverage, provenance, authorization, recovery, Worker latency, cost, load and rollback. | No authorization/provenance regression; both providers can discover the D1-authorized sources; overall and math-specific quality meet the agreed baseline; exact formula/symbol and mixed queries pass; recovery, controlled load/cost and rollback gates pass. | **IN PROGRESS — 13 November 2026.** The eight-page source and existing paired evaluations/assessment are complete with the documented limitations; the owner-waived 109-candidate AI assessment is not independent human qrels. Live Core v2 authorization/revocation passed 8/8 under receipt `e305a581-3d3c-469c-b2b5-093598783df4`. Core PRs #237/#238/#241 are merged. The two-source Prepare action has now passed: exact staging D1 read-back shows 2 mapped/READY sources (8/8 and 3/3 pages); the second-source checkpoint has 7/7 Qdrant points and 3/3 AI Search items READY; all three exact item keys are `completed` and carry numeric page metadata. No paired-run receipt exists yet. Next: run five paired Core v2 cases (ten staging query reservations), then interpret per-query coverage/provenance/no-match behavior. Remaining: broader claim grounding/formula fidelity, retry/recovery/throttling, HNSW/load, repeatable latency/throughput/cost and rollback. Production remains Cloudflare AI Search; no cutover. | [Core #144](https://github.com/ashini-x/parmar-ai/issues/144) |
| **M16 — Consumer and admin experience parity** | Core + Teachers | Connect the same v2 contract to the provider flag; preserve both admin UIs, five stages, page map, source CRUD, retry and READY gating; update only provider-specific wording/advanced diagnostics; test the real consumer. | User can perform the same upload/manage/retrieval journey without retraining; consumer code has no direct Vertex/Qdrant access; existing response/citation UI works; grant revoke/re-grant still passes. | PLANNED  | [Core #145](https://github.com/ashini-x/parmar-ai/issues/145) · [Teachers #18](https://github.com/ashini-x/brvin-teachers/issues/18) |
| **M17 — Controlled production cutover and legacy retirement** | Core + Teachers | Stage rollout using a provider flag; canary/shadow, gradual traffic, monitor and roll back; retain AI Search during the soak; retire Workers AI/AI Search only after acceptance and explicit review. | Production quality, access, page provenance, load, failure, cost and UI tests pass; rollback is demonstrated; at least 14 days of stable full-production soak completed before legacy deletion; docs/runbooks reflect actual deployed state. | PLANNED  | [Core #146](https://github.com/ashini-x/parmar-ai/issues/146) |

M12 is documentation work only. M13 provider/corpus-writer code and deterministic replay are merged. M14 is complete as the isolated Vertex/Qdrant pilot milestone; broad cross-provider acceptance is now M15. A green code PR or pilot receipt does not authorize a production provider cutover. M15 shadow validation, M16 consumer/admin parity and M17 controlled canary/soak are separate milestones. Each must be implemented, tested, reviewed and released through the repositories' normal controls.

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
3. Rebuild the Physics pilot from the retained source PDF using the staging-only, one-time OCR recovery route (the original temporary Vision JSON was removed by normal post-READY retention). Do not re-upload the PDF; verify the new three-page OCR output before manifest backfill.
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

Owns the Operator Console and student-facing experience. It continues calling the existing BRVIN v2 private binding. The consumer owns any eventual final-answer generation; as verified on 10 November 2026, the current Teachers repository has no deployed student/channel/model answer-generation or abstention route. Its migration work is limited to verifying compatibility, preserving the current UI/workflow, replacing provider-specific wording where present with neutral labels, and optionally displaying safe provider diagnostics returned through an approved operator-only route.

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


## 11. Current M14 checkpoint and new-chat continuation — 10 November 2026

Core PR #188 repaired and pinned the isolated staging configuration. Core PR [#191](https://github.com/ashini-x/parmar-ai/pull/191) is now squash-merged as `7a5587a9af4743c9216b62902768f817ec57183b`. Its PR validation passed the full Core typecheck, Vitest suite, Node tests and both Worker bundle validations; the M14 staging check passed typecheck, the targeted staging-worker test, versioned-settings guard and Wrangler dry-run. The main-branch M14 deployment created isolated staging Worker version 72 (`ec3614bf-0077-4c93-82e5-f685ea38456f`, deployment `e4bbe875-0216-4d96-a391-4ac4c43dbd76`) at 100%. Cloudflare read-back confirms Vertex `gemini-embedding-001` / `asia-south1` / 768 dimensions, collection `brvin_m14_physics_pilot_v1`, HTTPS Qdrant endpoint and secret separation (Qdrant key, M14 operator token, GCP private key). Core production was paired-released at `parmar-ai` version 698 (`29a993ad-c175-40fe-89d0-58cda2241429`) and `brvin-service` version 128 (`6ab2530e-c45f-4684-b0b2-1e20246adc32`), both 100%. Both production provider selectors still read `cloudflare-ai-search`; `BRVIN_CORPUS_MANIFEST_ENABLED=false`. Teachers remains on its existing Worker/version and no consumer code, v2 contract or provider credential change was made.

The authenticated, query-only candidateEvidence diagnostic has now been run and its receipt reviewed. It returned five candidates for each expected-no-match query. For the exact lowercase-symbol prompt (Find a source expression containing lowercase f = ma, not uppercase F = ma), none of the returned full chunk texts contains the requested lowercase expression. The nearby formula material is uppercase F/Fnet; the corpus's canonical expression is Fnet = m × a. This is a symbol-sensitive near miss, not evidence that the lowercase expression exists in the source.

For the out-of-corpus Planck-constant prompt, all five candidates are unrelated Physics-handout chunks. The top RRF score is 1.0, which is a rank-fusion score and emphatically not a confidence probability or evidence that the Planck constant is present. These retrieval-only results do not demonstrate answer abstention.

The friction query returned the same top-five point set in all three repeats but three distinct orderings. The direct page-3 worked-example chunk (be24fe40-ee0d-5324-8f77-3baab3322c69; 4 kg box, 20 N pull, 8 N friction, 12 N net force, 3 m/s² acceleration) ranked 1, 1 and 3. The leading candidates were tied at RRF 0.6666667; the first expected page rank was 1, 1 and 3. This is observed within-run ordering variation in a three-call sample, not top-five candidate-set drift and not a formal stability benchmark.

### Provisional chunk reading — not gold qrels

The receipt supports the following first-pass evidence interpretation, which must not be reported as human-reviewed relevance labels:

- be24fe40-ee0d-5324-8f77-3baab3322c69 (page 3): directly relevant to the friction query; it contains the exact worked example and result.
- 057bcdfa-b2bb-535f-8dc4-f47f1c1229df (page 2): supporting context; it explains Newton's second law and includes the general statement that friction and air resistance slow a moving object, but it is not the page-3 worked calculation.
- 6bb2552e-417c-5169-822f-93c91a8b752f (page 1): broad force/net-force background, weaker support than the worked example.
- c601e70a-8570-5122-ab56-4d23b9f334c9 (page 1): inertia and zero-net-force context, not direct friction evidence.
- 020b9743-4a6f-5211-8836-b044137502f7 (page 2): formula and Newton's third-law material, not direct support for the friction calculation.

A reviewer must confirm the chunk relevance against the immutable source PDF and explicitly label each query/chunk pair before the positive and negative set can become accepted qrels. Do not turn page labels, RRF scores or this first-pass reading into gold relevance judgments.


## Component-rank receipt review — 10 November 2026

The authenticated version-72 receipt returned `ok: true` for the same immutable seven-point Physics corpus. The dense-only and sparse-only traces both returned the same seven eligible point IDs under the pinned project/source filter. Their first five candidates are the same set, but dense and sparse reverse the positions of the direct page-3 worked example and broad page-1 overview:

| Chunk / source role | Dense rank (score) | Sparse rank (score) | Equal-weight RRF contribution |
|---|---:|---:|---:|
| `be24fe40-ee0d-5324-8f77-3baab3322c69`, page 3; exact 4 kg / 20 N pull / 8 N friction worked example | 1 (0.6746742) | 5 (3.2805996) | 1/2 + 1/6 = 0.6666667 |
| `057bcdfa-b2bb-535f-8dc4-f47f1c1229df`, page 2; second-law explanation and general friction context | 2 (0.64888996) | 2 (7.658746) | 1/3 + 1/3 = 0.6666667 |
| `6bb2552e-417c-5169-822f-93c91a8b752f`, page 1; broad force/net-force introduction | 5 (0.6418122) | 1 (8.145531) | 1/6 + 1/2 = 0.6666667 |
| `c601e70a-8570-5122-ab56-4d23b9f334c9`, page 1; inertia / zero-net-force context | 3 (0.648811) | 3 (3.6299407) | 1/4 + 1/4 = 0.5 |
| `020b9743-4a6f-5211-8836-b044137502f7`, page 2; formula / third-law context | 4 (0.6447945) | 4 (3.6138535) | 1/5 + 1/5 = 0.4 |

The other two points ranked 6 and 7 in both component lists: page-3 answer-key chunk `2971ad8d-59c4-5a97-8779-15a5c874b132` (dense 0.60316366; sparse 2.017408), followed by page-3 attribution chunk `0a2a4f69-be34-5482-b861-4cdf2c8c94f7` (dense 0.5972749; sparse 0.84754217).

**Interpretation:** dense retrieval puts the exact worked example first; the lexical/sparse leg puts the broad page-1 introduction first. The page-2 chunk ranks second in both legs. Under Qdrant's documented equal-weight RRF formula with \(k=2\) and zero-based component positions ([Qdrant hybrid-query reference](https://qdrant.tech/documentation/hybrid-queries/)), all three of those candidates receive the same score, 0.6666667. This exactly explains why the hybrid response retained the same top-five set but returned three different orders. The expected page-3 worked-example chunk ranked 3, 1 and 2 across the three new repeats; the three leading candidates were tied on score in each run. This is tie-order variation, not top-five candidate-set drift.

The raw dense scores (roughly 0.60–0.67) and raw sparse scores (roughly 0.85–8.15) are different scales. RRF fuses positions, not these raw score magnitudes. The component scores must not be compared directly or represented as calibrated confidence.

**Decision and staging implementation update — 10 November 2026:** the observed tie justified a bounded M14 staging-policy change. Core now obtains dense-only and sparse-only candidate lists independently, applies the identical D1-authorized project/source filter to both, validates every candidate's stored provenance, and fuses the two lists inside Core with **contribution-weighted reciprocal-rank fusion** (RRF, (k=2)). This is not Qdrant's native weighted-RRF API and does not require assuming a Qdrant server version that has not been confirmed.

The initial intent policy is:
- Natural-language/conceptual questions: **70% dense / 30% sparse**.
- Formula, operator or exact-symbol questions: **30% dense / 70% sparse**.
- Query intent is detected from explicit mathematical operators, common LaTeX commands and compact expression patterns. These weights are initial ranking-policy parameters, not calibrated confidence probabilities and not a claim of learned optimum.

For the observed friction ranks (dense positions 1/2/5 and sparse positions 5/2/1), the semantic policy yields:
- Direct page-3 worked example: (0.7/2 + 0.3/6 = 0.4000000).
- Page-2 supporting context: (0.7/3 + 0.3/3 = 0.3333333).
- Broad page-1 overview: (0.7/6 + 0.3/2 = 0.2666667).

This resolves the observed three-way tie in favor of the direct worked example. Component lists are sorted only within their own score scale (descending score, then point ID); raw dense and sparse scores are never compared with each other. Final equal-fusion-score ties use intent-primary rank, secondary rank, then point ID, so the output order is deterministic for a fixed pair of component lists. Dense/sparse payload disagreement for the same point fails closed. The Core unit fixture replays all seven observed component candidates and checks both semantic and symbolic weighting, score arithmetic, authorization filters and stable tie handling.

The cost of the change is two component-query calls instead of one Qdrant-native RRF call. Measure the added query latency and Qdrant request/compute cost during M14/M15; do not claim that deterministic ordering or the improved friction rank establishes overall retrieval quality. Human chunk-level qrels remain required for the multi-query benchmark and for deciding whether these initial weights should be retained, tuned or replaced. The two expected-no-match prompts remain retrieval-only evidence: no answer-abstention pass/fail is asserted, and a rank-fusion score is not a probability.

The component-rank trace was collected only for the friction prompt. It does not provide dense/sparse rankings for either expected-no-match prompt and does not test answer abstention. The lowercase-symbol and Planck cases remain retrieval-only evidence, and the Teachers Gemini answer route remains unavailable as documented above.

### Consumer answer/abstention path finding

The current Teachers repository does not contain the live Gemini answer path that the earlier continuation note assumed. The deployed src/index.ts routes to the Operator Console and health handler; src/retrieval-test.js calls retrieveTeacherKnowledge through the private BRVIN v2 binding and renders returned passages; src/brvin-v2.js is a retrieval adapter. The Teachers repository guide/README also states that student, channel and model runtime are deferred. Therefore there is currently no consumer-owned Gemini answer/abstention route on which to run the two no-answer prompts. The protected retrieval-test page must not be described as an answer test. A future M16 consumer runtime or separately approved operator-only answer harness is needed before answer/abstention acceptance can be measured. No direct provider access or v2 contract change is warranted.

### Remaining M14/M15 work

1. Use the source-grounded assistant-adjudicated chunk labels in [BRVIN_M14_CHUNK_QRELS.md](BRVIN_M14_CHUNK_QRELS.md) for the first reproducible precision/recall/ranking pass across all positive and no-match cases; keep physical-page metrics separately. The current matrix was assigned from the immutable PDF and the seven exact stored chunk texts; it is not represented as an independent human annotation.
2. Keep formula-fidelity cases for the source's uppercase Fnet = m × a, case-sensitive lowercase f = ma, notation/operator differences and OCR uncertainty. Merged PR #196 now recognizes both literal operators and worded cues such as “equation”, “formula”, “expression”, “uppercase”, “lowercase” and “multiplied by”; fresh staging query receipts must verify the routing behavior.
3. The M14 staging pilot now uses Core-side intent-weighted RRF (semantic 70/30 dense/sparse; symbolic 30/70) with stable per-component tie resolution and stable final ordering. The seven-point unit fixture reproduces the observed friction component ranks and the resulting direct-example-first scores. The updated v78 ten-query and negative/repeatability receipts have been run and scored against qrels v0.1; preserve the observed exact-formula improvement but keep intent weights provisional pending independent human labels and broader multi-document validation. Next, measure two-component latency/cost and complete authorization, retained-vector revocation, retry/recovery, HNSW and representative-load gates. Measure the two-call latency/cost overhead and inspect all positive, formula, paraphrase and negative cases. Keep these weights provisional until the source-grounded qrels in `docs/BRVIN_M14_CHUNK_QRELS.md` are evaluated across the full live positive suite and no-match cases, with aggregate metrics plus per-query regressions. The qrels are an explicit model adjudication, not an independent human annotation.
4. Complete no-grant/wrong-project isolation, revocation while vectors remain present, deterministic retry/recovery, HNSW/resource tuning, latency/concurrency/load and cost benchmarks.
5. Coordinate an actual consumer answer/abstention test only after a real consumer generation path exists and has an approved test boundary.

Do not re-upload, rerun Vision OCR, rebuild the seven-point corpus or repeat the ten positive queries for this diagnostic review. Continue to keep AI Search as the production provider and retain the rollback path through the required 14-day production soak.


### Authenticated M14 version-74 negative and repeatability receipt — 10 November 2026

The fresh authenticated non-gating diagnostic returned `ok: true` against project `448249b4-fed9-45f5-9137-6014f242ddbe`, source `01238b3a-9902-4a42-90b4-574048ee4f00`, collection `brvin_m14_physics_pilot_v1`, embedding model `gemini-embedding-001`, 768 dimensions. It used the existing seven-point immutable corpus; no OCR, upload or re-index occurred.

For `friction-and-net-force`, all three repeats returned the identical top-five sequence: page-3 worked example (P3-worked), page-2 second-law support (P2-laws), page-1 overview (P1-overview), page-1 inertia (P1-inertia), and page-2 formula tail (P2-tail). The expected page-3 result ranked first in all three calls. Against the source-grounded assistant-adjudicated qrels, the grades are 3, 2, 1, 1, 1: nDCG@5 1.0000, MRR@5 (grade >=2) 1.0000 and recall@5 of grade-2+ chunks 2/2. The receipt reports one distinct ordered sequence, one distinct top-five set and `rankStableAcrossRepeats: true`. This is a one-query, three-repeat staging observation, not broad acceptance evidence.

The friction component trace confirms the expected dense/sparse complementarity: dense ranks P3-worked first and P2-laws second; sparse ranks P1-overview first and P2-laws second, with P3-worked fifth. The live weighted fusion places P3-worked first and P2-laws second. Raw dense and sparse scores are incomparable scales; rank-fusion scores are not confidence probabilities.

The two `expectedNoMatch: true` prompts each returned five candidates:
- Lowercase-symbol hard negative (`Find a source expression containing lowercase f = ma, not uppercase F = ma.`): five candidates, top RRF 0.425, all five grade 0 against the qrels because the requested lowercase expression is absent.
- Planck-constant out-of-corpus negative: five candidates, top RRF 0.5, all five grade 0 because all retrieved chunks are unrelated.

These results confirm that retrieval alone does not suppress candidate lists for no-match queries. They do **not** establish an answer failure or pass/fail abstention behavior: the diagnostic is retrieval-only and explicitly does not invoke a Teachers Gemini answer route. The current Teachers repository still has no deployed answer-generation/abstention path. Do not interpret the scores as confidence or permit them to justify unsupported answers.

**Next M14 action:** run the authenticated ten-positive-query diagnostic on the same v74 staging page, then score all live query lists against `docs/BRVIN_M14_CHUNK_QRELS.md`. The ten-positive suite, two-call latency/cost, authorization isolation, revocation with vectors retained, deterministic recovery/retry, HNSW/resource tuning and representative load tests remain open. Production stays on Cloudflare AI Search.

For a new chat, read docs/BRVIN_2_MASTER_PLAN.md first, then this migration plan, docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md, docs/BRVIN_SYSTEM_REFERENCE.md, the frozen v2 RPC contract and the M14 runbook. Establish current commits, CI, deployment versions and provider settings in both repositories before changing code. Preserve the unified math-aware path, raw OCR and physical-page provenance, D1 authorization, private v2 contract and both admin experiences.


### Authenticated M14 version-74 ten-positive-query receipt — 10 November 2026

The protected ten-positive-query action returned `ok: true` for all ten cases on the fixed pilot: 11/11 expected physical pages were present in the top five (100% expected-page coverage), 50 candidates were returned, 20 were from expected pages, the strict physical-page-label precision proxy@5 was 0.4000, and mean reciprocal first-expected-page rank was 0.8333333. Per-query first expected-page ranks were conceptual 1, exact formula 2, paraphrase 3, equivalent notation 1, uppercase symbol 2, worked example 1, numerical setup 1, theory+formula 1, friction 1 and bus braking 1 (the bus-braking second expected page ranked 3). Compared with the previous recorded equal-weight page-level baseline MRR of 0.7833333, this is +0.0500; expected-page coverage and the page-label precision proxy are unchanged.

These are **page-level retrieval proxies**, not chunk-qrels metrics. The v74 positive receipt returned only page numbers/ranks, not point IDs, chunk IDs or text; it cannot be joined to the seven-chunk relevance matrix and cannot establish chunk-level nDCG/MRR/recall, exact formula fidelity or answer correctness. The exact formula, paraphrase and uppercase-symbol expected pages appeared at ranks 2, 3 and 2, but the exact evidence chunks are unknown from this response.

Core PR #199 adds the ranked point/chunk IDs, per-query intent/fusion weights and full stored text once per unique point to the authenticated, staging-only positive receipt. After PR validation, merge and staging deployment, rerun the ten-query action on the updated staging version and score all ten lists against `docs/BRVIN_M14_CHUNK_QRELS.md`. No retrieval behavior, corpus, indexing, D1 authorization or production selector is changed by this instrumentation.

The separately completed v74 negative/repeatability receipt remains as recorded above: the friction query had a stable ordered top five in all three repeats and the direct worked example ranked first; both expected-no-match prompts returned five grade-0 candidates. This does not test answer abstention. Production remains on Cloudflare AI Search.


### Authenticated M14 version-75 positive chunk-qrels evaluation — 10 November 2026

The expanded protected positive receipt was run on staging Worker v75 against the immutable seven-point Physics corpus. Its seven unique point/chunk identities and text entries all matched the qrels inventory. All ten query checks returned five ranked candidates, with the following macro metrics against the source-grounded assistant-adjudicated qrels (gain (2^{rel}-1), MRR/recall threshold grade >=2):

- **nDCG@5: 0.8556**
- **MRR@5: 0.8500**
- **Recall@5 of grade-2+ chunks: 1.0000 (20/20 relevant chunk occurrences retrieved)**
- **Precision@5 of grade-2+ chunks: 0.4000 (20/50)**
- A grade-2+ chunk ranks first in 7/10 queries.

Per-query nDCG@5 / MRR@5: concept 0.8453/1.0; exact formula 0.6968/0.5; paraphrase 0.7557/1.0; equivalent notation 0.8596/1.0; uppercase symbol 0.7482/0.5; worked example 0.9828/1.0; numerical setup 0.9828/1.0; theory+formula 0.9364/1.0; friction 1.0000/1.0; bus braking 0.7482/0.5. All ten queries retrieved every qrels chunk with grade >=2 in their top five.

The classifier applied semantic 70/30 dense/sparse to six semantic queries and symbolic 30/70 to the four formula/symbol/mixed-formula queries, matching the intended reviewed query categories. For these small subsets, symbolic queries average nDCG@5 0.8103 and MRR@5 0.7500; semantic queries average nDCG@5 0.8858 and MRR@5 0.9167. This is not enough evidence to tune global weights.

**Observed focused weaknesses:** for the exact-formula query, the page-1 overview chunk (qrels grade 0 for this exact-formula prompt) ranked first; the direct page-2 second-law and formula-tail chunks ranked second and third. For the uppercase-symbol prompt, the page-3 worked-example chunk (grade 1 context) ranked first, with direct page-2 formula chunks at ranks two and three. For bus-braking, the page-3 worked-example context (grade 1) ranked first, with the grade-3 answer-key and inertia chunks at ranks two and three. These cases retain full grade-2+ recall@5 but lose first-rank precision; exact formula and uppercase symbol each have MRR 0.5. Equivalent notation and theory-plus-formula rank the direct page-2 law chunk first.

The 0.40 chunk Precision@5 is not the same metric as the 0.40 physical-page-label precision proxy in the page-level receipt; they happen to be equal numerically. The qrels are assistant-adjudicated/source-grounded, not an independent human gold set. The earlier negative diagnostic remains retrieval-only: both expected-no-match cases returned grade-0 candidates, and no answer-abstention test occurred.

**Decision:** retain the current 70/30 and 30/70 weights as provisional while investigating exact-formula and uppercase-symbol top-rank behavior. Inspect the component-rank diagnostics for those prompts and test a narrow formula-evidence improvement on this and a broader corpus before changing global policy. Do not infer a universal benefit from the seven-chunk pilot. Production remains on Cloudflare AI Search; Qdrant stays isolated staging.


### Authenticated M14 version-76 component-rank diagnostic — 10 November 2026

Core PR #201 is merged and deployed to the isolated M14 staging Worker v76. The authenticated negative/repeatability action now returns independent dense-only and sparse-only rank lists for the exact-formula and uppercase-symbol prompts, including point/chunk IDs and physical-page provenance. It also retains full candidate evidence for the two no-match cases and the three-repeat friction trace. This is read-only diagnostics; no retrieval behavior or fusion weights changed.

For the natural-language exact-formula query (`What equation expresses Newton's second law of motion?`), dense ranks the P2 formula-tail and P2 second-law chunks first and second, both qrels grade 3. Sparse ranks the P1 overview first (grade 0), P2 second-law second (grade 3), and P2 formula-tail sixth (grade 3). The v75 30/70 symbolic fusion placed the grade-0 overview first and the two direct formula chunks second/third. The literal-free word `equation` cue currently makes a formula-discovery question symbolic even though dense retrieval is clearly stronger for this reviewed prompt.

For the uppercase-symbol query (`Find the source expression containing uppercase F in the second-law formula.`), dense ranks the P3 attribution chunk first (grade 0), then the two direct P2 formula chunks second/third (grade 3/3). Sparse ranks the P3 worked-example context first (grade 1), followed by the same P2 direct formula chunks second/third (grade 3/3). The v75 fused output selected the worked-example context first and the direct chunks next. Because both component lists agree on direct evidence at ranks 2/3 but disagree on their top distractor, a global weight shift alone is not a robust fix; it simply changes which distractor can win.

The same receipt shows both expected-no-match prompts still return five grade-0 candidates. Lowercase `f = ma` retrieves uppercase-symbol-adjacent content, not the requested case-sensitive expression; Planck returns unrelated Physics chunks. These are retrieval-only observations, not an answer-abstention test. Friction returns one identical ordered top five across all three repeats, with the page-3 worked example rank 1 on each call.

**Decision:** do not change global weights from this small pilot. Keep the current 70/30 semantic and 30/70 symbolic policy provisional. Evaluate a narrow distinction between natural-language formula discovery and explicit symbol/case requests, plus a deterministic case-sensitive exact-expression evidence signal for explicit symbol queries. Add regression tests, replay all ten positive qrels cases and the two no-match cases, then compare with v76. Production remains Cloudflare AI Search; staging remains isolated. No re-index/OCR is needed.


### Authenticated M14 version-78 positive chunk-qrels and negative/repeatability receipts — 11 November 2026

Both authenticated actions returned `ok: true` against the immutable project `448249b4-fed9-45f5-9137-6014f242ddbe`, source `01238b3a-9902-4a42-90b4-574048ee4f00`, collection `brvin_m14_physics_pilot_v1`, Vertex `gemini-embedding-001`, 768 dimensions. The seven unique point IDs and chunk IDs in the positive receipt matched the inventory in [BRVIN_M14_CHUNK_QRELS.md](BRVIN_M14_CHUNK_QRELS.md). No source upload, Vision OCR, corpus rebuild or Qdrant re-index was performed.

#### Positive suite scored against qrels v0.1

The ten queries returned 50 candidates. Scoring the top-five point IDs against the existing seven-chunk source-grounded qrels using graded gain (2^{rel}-1), first grade-2+ MRR and grade-2+ recall/precision gives:

| Metric | v75 | v78 |
|---|---:|---:|
| Macro nDCG@5 | 0.8556 | **0.8853** |
| Macro MRR@5 | 0.8500 | **0.9000** |
| Macro Recall@5, grade >=2 | 1.0000 | **1.0000 (20/20)** |
| Macro Precision@5, grade >=2 | 0.4000 | **0.4000 (20/50)** |
| Queries with grade-2+ evidence at rank 1 | 7/10 | **8/10** |

Per-query grades and metrics:

| Query | Grades@5 | nDCG@5 | MRR@5 | Recall@5 |
|---|---|---:|---:|---:|
| newtons-second-law-concept | 2,3,1,0,1 | 0.8453 | 1.0000 | 100% (2/2) |
| newtons-second-law-exact-formula | 3,3,0,1,0 | 0.9942 | 1.0000 | 100% (2/2) |
| net-force-paraphrase | 2,0,3,2,1 | 0.7557 | 1.0000 | 100% (3/3) |
| force-mass-acceleration-equivalent-notation | 3,1,0,3,2 | 0.8596 | 1.0000 | 100% (3/3) |
| uppercase-force-symbol | 1,3,3,0,0 | 0.7482 | 0.5000 | 100% (2/2) |
| four-kilogram-worked-example | 3,0,1,0,0 | 0.9828 | 1.0000 | 100% (1/1) |
| numerical-force-setup | 3,0,1,0,0 | 0.9828 | 1.0000 | 100% (1/1) |
| theory-plus-formula | 3,1,3,1,0 | 0.9364 | 1.0000 | 100% (2/2) |
| friction-and-net-force | 3,2,1,1,1 | 1.0000 | 1.0000 | 100% (2/2) |
| bus-braking-answer | 1,3,3,0,0 | 0.7482 | 0.5000 | 100% (2/2) |

The v78 exact-formula query is the only per-query qrels score that changed from v75: the direct page-2 second-law and formula-tail chunks now rank 1 and 2, changing grades from `0,3,3,0,1` to `3,3,0,1,0`. Its nDCG@5 improves from 0.6968 to 0.9942 and MRR@5 from 0.5 to 1.0. The other nine per-query metrics match v75. Seven checks record 70/30 dense/sparse weights and three record 30/70. The exact-formula check records 70/30 but omits the `queryIntent` field from its candidate entries; retain this as a telemetry/receipt observability gap rather than inferring an unreported label.

The same receipt reports 11/11 expected physical pages covered, 20/50 expected-page-labelled candidates, page-label precision proxy@5 0.4000 and mean reciprocal first-expected-page rank 0.8833333. These physical-page metrics are separate from the chunk-level qrels metrics; do not compare the page-level MRR directly with qrels MRR.

#### Negative and repeatability receipt

Both expected-no-match prompts returned five candidates, each grade 0 against qrels:

| Case | Returned candidates | Top RRF | Result |
|---|---:|---:|---|
| lowercase `f = ma` hard negative | 5 | 0.425 | All candidates are formula-adjacent but none contains the requested lowercase expression; source text records uppercase `Fnet = m × a`. |
| Out-of-corpus Planck constant | 5 | 0.5 | All candidates are unrelated Physics chunks; the requested constant/value is absent. |

The negative diagnostic is retrieval-only. It proves that the top-k retrieval action returns grade-0 neighbours for these no-match prompts; it does not invoke a consumer answer model or assert answer abstention. RRF scores are rank-fusion values, not calibrated confidence probabilities.

The friction query returned the same ordered top five across all three calls: P3-worked, P2-laws, P1-overview, P1-inertia, P2-tail. The expected page-3 worked-example chunk ranked first on each repeat; there was one distinct ordered sequence and one distinct top-five set. The ordering and scores were stable for this three-call sample only.

#### Acceptance status

The v78 result is a measurable improvement over v75 on the existing seven-chunk assistant-adjudicated qrels, particularly for natural-language exact-formula discovery. It is not independent human validation and does not establish generalization to larger collections. M14's staging pilot is complete. The independent human qrels/expanded corpus, two-component-query latency/Qdrant cost, wrong-project/no-grant isolation, revocation with vectors retained, deterministic retry/recovery, and HNSW-aware load/performance are M15 acceptance gates. Production remains on AI Search; the existing v2 contract and D1 authorization boundary are unchanged. The current Teachers application has no deployed Gemini answer/abstention route; do not infer answer correctness or abstention from these Core retrieval receipts. Production remains on AI Search with the existing v2 contract and D1 authorization boundary unchanged.


### M15 read-only AI Search baseline — 11 November 2026

The current production AI Search source was queried read-only through the existing shared instance `fatman-2026-8b183803`, filtered to the exact Physics source folder `brvin/books/01238b3a-9902-4a42-90b4-574048ee4f00/pages/`. The three source items were already `completed`; their internal AI Search chunk counts are 3/4/4 (11 total). Their source ID, three physical pages and original SHA-256 match the immutable M14 Physics source. No item uploads/deletes, index creation, OCR, selector or production Worker changes were performed.

The fixed 12-case suite (10 positives, 2 no-match) produced 14 AI Search candidates in total. On the ten positive queries, **8/11 expected physical-page targets** appeared in the top five (72.7% page-target coverage); the expected-page-label precision proxy was 11/14 (78.6%), and mean reciprocal first-expected-page rank was 0.6833. These are physical-page-label proxies only—not chunk-level relevance judgments.

Focused observations:
- Natural-language exact-formula query returned one page-2 general passage (score 0.8805) that did not contain the formula; the separate equivalent-notation query did return the formula chunk at rank 1.
- The uppercase-`F` symbol query returned no candidates despite the source containing `Fnet = m × a`.
- The four-kilogram numerical-setup query returned no candidates; the related worked-example query did return page 3 at rank 1.
- Friction returned page 2 at rank 1 and the direct page-3 worked example at rank 2.
- Bus-braking returned two page-3 candidates, including the answer-key text, but did not return its expected page-1 explanation.
- Both reviewed no-match prompts returned zero candidates. This is retrieval behavior only, not a Gemini abstention test.

The Qdrant v78 pilot receipt covered 11/11 expected physical-page targets. Its chunk-qrels v0.1 metrics were nDCG@5 0.8853, MRR@5 0.9000, grade-2+ recall 1.0000 and precision 0.4000 against source-grounded model-adjudicated labels. **Do not compare the Qdrant chunk-qrels metrics directly with AI Search:** AI Search and Qdrant use different chunk boundaries (11 AI Search chunks vs 7 Qdrant chunks). The same PDF/source is used, but this first checkpoint is an end-to-end source-level comparison, not a chunk-equivalent experiment.

The connector-side request round trips were 1.203–5.065 seconds; they include API/control-plane/client overhead and are **not** Worker-side retrieval latency or evidence against the M15 p50/p95 goals. M15 still needs Worker-timed paired shadow measurements, human passage qrels, broader corpus, query-cost and embedding/storage accounting, D1 authorization/revocation tests, throttling/recovery and concurrency/load tests.

### M15 comparison caveats and next step

The M15 first baseline used the production AI Search instance in read-only mode; the exact source folder filter prevented unrelated index items from entering the candidate set. This is a current-provider behaviour snapshot on the same source PDF/hash as the Qdrant pilot, not a test of a dedicated cloned index and not a matched-chunk experiment. Do not score AI Search output chunks against the seven Qdrant qrels as though chunk boundaries/IDs match. Create independent passage-level qrels for each provider or a normalized source-span mapping before reporting nDCG/MRR on passages. That code increment is complete: Core PR #209 merged and deployed staging Worker v79 with the authenticated `/admin/m15/shadow/evaluate` route, narrow search-only AI Search binding and Qdrant query-only mode. The next action is the 12-query operator receipt; after it, use the results to create human passage qrels and expand to a representative corpus before the remaining security/performance/cost/load gates.


## M15 staging shadow runner — deployed 11 November 2026

Core PR #209 is merged as `136687511673ddcb17ff26aaf4589c3872265466`. The protected M15 read-only paired shadow runner is deployed to isolated staging Worker **v79**, version `a3da7cc7-3556-4e12-a57f-51f2898edb5f`, deployment `8fb4c6cc-0b0a-4d7a-8387-b8550f299807`, serving 100%.

The existing operator page exposes `POST /admin/m15/shadow/evaluate` via the **Run AI Search vs Qdrant shadow benchmark** button. The route requires the staging operator bearer token and exact Physics source confirmation. It runs the fixed 12-case suite (10 positives, 2 no-match) using:
- A search-only AI Search binding to `fatman-2026-8b183803`, with every request constrained to the exact Physics source folder.
- The existing Vertex/Qdrant hybrid query path with exact project/source filters and `ensureCollection: false`, which skips collection/index preparation. Hybrid retrieval still performs its intended dense and sparse `points/query` calls.
- Per-provider Worker-side elapsed time, top-five physical page/passage previews, candidate scores/component ranks, source/page provenance violations and expected-page summary statistics.

Regression coverage includes route auth/source-confirmation/missing-binding gates and a direct Qdrant unit test proving read-only shadow mode makes exactly two dense/sparse `points/query` calls and no collection GET/PUT or payload-index creation.

CI after merge: M14 staging workflow #86 passed, Release validation #1084 passed (typecheck, test, node tests and both Worker dry-run bundles). The production-scope job classified the commit as staging/docs-only (`deploy=false`); production deploy/acceptance jobs were skipped.

Cloudflare read-back confirms staging `ENVIRONMENT=staging`, the AI Search instance binding, the existing Vertex model/location/dimensions and Qdrant collection. Production remains `parmar-ai` v710 and `brvin-service` v134, each at 100%, with `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`; corpus-manifest writes remain disabled and no Qdrant/Vertex production bindings were introduced.

**Execution receipt still pending:** the public staging endpoint could not be invoked by the current tool session (the external request path is denied), and the staging admin token is intentionally not read or copied into chat. Run the new button from the operator page after entering the token locally, then review the 12-query JSON receipt. Do not re-index, re-upload or rerun OCR. The button call is read-only; no AI Search or Qdrant data is mutated.

This is the first M15 execution surface, not M15 acceptance. Passage-level human qrels, broader corpus, grant/no-grant and revoke-with-vectors-retained tests, throttling/recovery, HNSW-aware load, Worker p50/p95/p99 and cost accounting remain open.

## M15 first paired shadow receipt — 11 November 2026

The operator returned `ok=true` for all 12 cases from the pinned 3-page Physics source (10 positive, 2 expected-no-match), with 12/12 successful queries and zero provider failures. Both providers reported zero source/page provenance violations. The receipt's side-effect counters were all zero: no AI Search item uploads/deletes, no Qdrant point upserts/deletes, no source/OCR changes, no provider-selector changes and no consumer-answer changes.

### Page-level results (not passage-qrels scores)

| Metric | Cloudflare AI Search | Vertex + Qdrant |
|---|---:|---:|
| Expected page targets covered | 8/11 (72.7%) | 11/11 (100%) |
| Mean reciprocal first expected-page rank | 0.6833 | 0.8833 |
| Returned candidates across 12 queries | 14 | 60 |
| Expected-page-labelled candidates | 11 | 20 |
| Old returned-candidate page-label ratio | 11/14 (78.6%) | 20/60 (33.3%) |
| No-match queries with any candidate | 0/2 | 2/2 |
| False-positive candidates across no-match queries | 0 | 10 |
| Observed Worker-side p50 | 965 ms | 656 ms |
| Observed Worker-side p95 / p99 | 4,487 / 4,487 ms | 1,316 / 1,316 ms |

The original receipt's `pageLabelPrecisionAt5` field used expected-page-labelled candidates divided by *actual candidates returned*. Since AI Search returned 14 total candidates while Qdrant returned 60, this was not a fixed-denominator P@5 comparison. The original values are preserved above as **returned-candidate page-label ratios** for historical traceability.

The corrected scorecard is merged in Core PR #211 and deployed in staging Worker v80. It now reports fixed-cutoff metrics on every future run. Recomputing this receipt with the fixed denominators gives:
- **All-suite page-label P@5:** AI Search 11/60 = 18.3%; Qdrant 20/60 = 33.3%.
- **Positive-only page-label P@5:** AI Search 11/50 = 22.0%; Qdrant 20/50 = 40.0%.
- **No-match false-positive query rate:** AI Search 0/2 = 0%; Qdrant 2/2 = 100%.

These are physical-page label proxies, not independently judged passage relevance. Qdrant retrieved the expected page targets more reliably and earlier, including the uppercase-symbol target (page 2 at rank 2), numerical setup (page 3 at rank 1), friction worked example (page 3 at rank 1), and both expected bus-braking pages (page 3 rank 1, page 1 rank 3). AI Search returned no candidates for uppercase-symbol and numerical-setup positives, and only the page-3 portion of the bus-braking target. Both providers found the expected page 2 for the formula/concept and mixed theory+formula questions, but the receipt does not establish exact passage-level formula correctness.

The most important counter-signal is Qdrant's no-match behavior: it returned five candidates for each negative query, whereas AI Search returned zero. The reported Qdrant scores (0.425 and 0.5) are RRF fusion scores, **not calibrated confidence probabilities**; do not invent a cutoff from these two examples. This is retrieval-only evidence and does not test Gemini answer abstention.

The 12 sequential timing samples are staging observations, not production SLOs, load tests, p99 capacity evidence or cost measurements. Qdrant's observed p50/p95 are lower in this small sample, but broader controlled tests remain required. AI Search has 11 auto-chunks (3/4/4 per source page); Qdrant has 7 custom chunks. No nDCG/MRR cross-provider passage comparison is valid until independent passage qrels or normalized source-span mapping exists.

### Current deployment and next M15 actions

The scorecard correction is Core PR #211 (merge `44986b2504ece84ca66bbf2a3ad55c118cac4085`) and staging Worker **v80** (version `da7d1874-e762-496b-8eca-17d72f358883`, deployment `d66de3af-53f1-4070-8200-e78ee8ec81e7`) at 100%. Focused staging workflow #88 and full Release validation #1089 passed. The production-scope classifier returned `deploy=false`; production deploy/verification jobs were skipped. Production `parmar-ai` remains v710 and `brvin-service` remains v134; both remain at 100% on `cloudflare-ai-search`.

Next: obtain independent human passage relevance judgments for both chunk schemes (or normalize source spans), expand the corpus beyond this single 3-page source, then run wrong-project/no-grant isolation and revoke-with-vectors-retained checks. Follow with retry/recovery, HNSW-aware controlled load, Worker p50/p95/p99 under representative concurrency, and embedding/index/storage/query cost. Do not change the production provider selector or claim M15 acceptance from this receipt.



## 11 November 2026 — M15 second-source staging operator ready

Core PR #213 merged the source-pinned eight-page benchmark pipeline and its separate AI Search/Qdrant staging resources. PR #214 corrected the production-scope allowlist after the first merge unnecessarily ran the normal production release workflow; PR #215 fixed monotonic source-stage reporting, AI Search partial-index retry and the one-use-token UI flow. Staging Worker v82 is deployed at 100% (`5784e06d-33a8-4feb-b75b-09c9a5565d47`, deployment `184ad701-884e-4a96-b101-2c8ccab7de74`).

The new operator lives at `/admin/m15/benchmark`. It accepts only `BRVIN_M15_Physics_Benchmark_Source_v1.pdf` (62,012 bytes, eight pages, SHA-256 `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92`). It stores the source and OCR results in the private staging bucket, builds immutable manifests, indexes the same eight OCR pages into AI Search instance `brvin-m15-physics-staging-v1`, and indexes deterministic Vertex embeddings into Qdrant collection `brvin_m15_physics_benchmark_v1`. The runner compares the two staging indexes on 12 positive, 4 out-of-corpus and 1 exact-symbol near-miss queries. It performs retrieval/search only and does not invoke Gemini answer generation.

**Current state:** the eight-page source is uploaded and OCR/corpus/indexing are complete in the dedicated staging resources. The operator reports that the paired 17-query retrieval-only receipt completed with 12/12 positive expected-page coverage for both providers, Qdrant candidates on all four out-of-corpus controls, H01 corrective-page retrieval, zero provenance violations and no indexing/production side effects. Full details and operating instructions are in [BRVIN_M15_SECOND_SOURCE_BENCHMARK.md](BRVIN_M15_SECOND_SOURCE_BENCHMARK.md). The receipt is a page-level retrieval result, not an answer/abstention result or passage-qrels judgment. Human passage qrels, security/revocation, recovery, latency/cost and controlled load remain open. Production remains on Cloudflare AI Search.

The first merge did trigger a normal production redeploy because the release-scope allowlist omitted the new staging module/test/config-verifier paths. Production acceptance passed and the production provider settings remained `cloudflare-ai-search` with corpus manifests disabled; current production read-back is `parmar-ai` v714 and `brvin-service` v135 at 100%. Core PR #214 added those staging-only paths to the classifier. Subsequent M15 staging-only merges skip production deployment.

## M15 consumer answer and abstention evaluation — 11 November 2026

The retrieval-only second-source receipt and the consumer answer/abstention receipt are separate M15 subtests. The latter used the completed eight-page source and the original P01–P12, N01–N04 and H01 suite. BRVIN v2 remains a retrieval RPC. The isolated staging adapter calls the existing consumer-owned `generateGeminiAnswer` function; answer generation was not moved into Core, the RPC contract was not changed, and production routing/provider selection was not changed.

The operator completed **17/17 query pairs and 34 Gemini generations** at 2026-11-11 15:32:24 UTC using `gemini-3.8-flash` (global). The original downloaded auto-grade reported Cloudflare AI Search 9/17 and Qdrant + Vertex 13/17. Those are preserved as the raw receipt counters, but the review found false negatives in the initial deterministic rules:

- P07: both answers correctly calculate the requested kinetic-friction magnitude (9.8 N); a direction explanation was not required by the question.
- P09: both answers correctly calculate 19.6 N downslope and 33.95 N normal force; the original regex was position-sensitive.
- P11: both answers correctly give −4.5 kg·m/s and −90 N; their negative signs preserve direction even without a separate verbal phrase.
- N01–N04: both generators explicitly abstain 4/4. AI Search returned no passages, so its run demonstrates no-evidence abstention but does not exercise ignoring irrelevant evidence (0/4 challenge contexts). Qdrant returned unrelated in-corpus passages and the generator abstained in all four cases (4/4 resistance demonstrated).
- H01: the original PDF page 8 visibly prints `F_s = −k × x` and explicitly rejects `F_s = +k × x`. Both answers reject the positive-sign premise, but the indexed OCR and generated answers show `F_s = -k xx`, so exact-symbol preservation fails at the OCR-to-answer boundary. The original PDF is correct and no source/OCR/index artifact was modified.

The calibrated rules re-grade the saved answer text to **16/17 for each provider**, leaving H01 as an exact-notation failure. This is an offline rubric re-grade, not another Gemini run. Positive-query content P01–P12 is correct on manual review for both providers. No single aggregate score should hide the distinction between empty-evidence abstention, irrelevant-evidence resistance and exact-symbol fidelity.

The new evaluator also separates two negative metrics: abstention correctness and whether the irrelevant-evidence challenge was actually exercised. It no longer marks a correct no-evidence abstention as a failure merely because no candidates were returned. It relaxes the P07/P09/P11 false-negative rules while retaining a strict canonical-expression check for H01. Regression tests were added. The current raw JSON is not rewritten.

The report's generation-latency averages are 7,430.06 ms (AI Search) and 6,011.24 ms (Qdrant); medians are nearly identical at 5,580 and 5,560 ms. AI Search has outliers P08 20,880 ms and N02 18,782 ms. Retrieval latency averages 1,993.65 ms (AI Search) and 788.29 ms (Qdrant), with medians 1,652 and 792 ms respectively. These are one 17-query staging sample, not production SLOs or representative load measurements.

The 17/17 citation counters mean the expected physical-page citations were appended and matched the expected page labels. They do not prove claim-by-claim entailment. Likewise, the reported source-grounding counter is a deterministic page-presence/answer-rubric proxy, not independent semantic grounding. Claim-to-passage review is still required.

**Implementation status:** evaluator, calibrated regression tests and original-PDF one-page visual-evidence audit are merged in Core PR [#223](https://github.com/ashini-x/parmar-ai/pull/223), merge commit `3c4e7b815bb4f5c21318b083712b2d138b882475`. Final PR-head M14 staging validation [#43076308815](https://github.com/ashini-x/parmar-ai/actions/runs/43076308815) passed typecheck, focused M14/M15 tests, provider-config verification and Wrangler staging dry-run. Final Core Release validation [#43076309218](https://github.com/ashini-x/parmar-ai/actions/runs/43076309218) passed TypeScript, full Vitest, Node tests and both Worker bundle dry-runs. After merge, push-triggered M14 workflow [#43076503307](https://github.com/ashini-x/parmar-ai/actions/runs/43076503307) deployed only the isolated staging Worker. Cloudflare deployment read-back confirms `parmar-ai-m14-staging` deployment `9eaac13a-38a9-4823-9d16-c31ff97c9eab`, version `ed239c04-3d71-4194-88c0-d08c8948929c`, at 100%. Release validation [#43076503215](https://github.com/ashini-x/parmar-ai/actions/runs/43076503215) passed; its production-scope classifier reported staging/docs-only, and production deployment/verification jobs were skipped.

**Execution status — completed 11 November 2026:** the original 34 OCR-only staging generations remain complete and immutable. The separate PDF-assisted run completed all five pairs / ten Gemini generations against the pinned source using `gemini-3.8-flash` / `global`; the original source SHA-256 matched exactly. Both providers passed 5/5 answer correctness, source-grounding, citation and mathematical-symbol checks with zero provenance violations, and each cited the expected support page. The only permitted original physical page was extracted into a transient one-page PDF per query; no other source pages were attached. The source PDF, Vision OCR, normalized text, manifests, D1 records and indexes remain unchanged. This demonstrates notation recovery with visual PDF evidence, but the OCR-only formula defects remain in the stored representations and the OCR-only answers. The optional `src/ai/gemini.ts` source-document branch is invoked only by this isolated staging audit; existing production callers omit it and production deployment was explicitly skipped.

The H01 near-miss is not an abstention case. Page 8 contains `F_s = +k × x` as an explicitly rejected expression, so retrieving page 8 is appropriate corrective evidence. Both models state the source equation is `F_s = −k × x`; the summary correctly reports zero abstention-applicable queries for this audit. The audit's retrieval mean/median was 3,848/3,599 ms for AI Search and 913.2/895 ms for Qdrant. Generation mean/median was 8,435.6/7,442 ms for AI Search and 14,278/5,749 ms for Qdrant; Qdrant P11 generation took 50,041 ms. This five-query sample does not establish an end-to-end latency win. Independent claim-level grounding remains open.

See [BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md](BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md) for the complete receipts, adjudication, test rubric and separately benchmarked relevance-gating/reranking recommendations.

**Decision:** the migration remains **IN PROGRESS**. The bounded five-query PDF-assisted formula audit passed for both providers, but that does not repair the stored OCR/index representation or prove that all normal OCR-only answers preserve notation. Do not call the retrieval migration production-ready or change the production provider selector until a production-appropriate symbol-fidelity path is validated across a broader multi-document/formula set, independent claim-level grounding and passage qrels are reviewed, the calibrated evaluator passes CI, and the remaining M15 security/isolation/revocation, recovery, repeatability, latency, cost, load and rollback gates pass.

## 12 November 2026 — M15 first incomplete gate: independent passage review

The first incomplete M15 acceptance task is independent passage relevance and claim-to-passage grounding for the eight-page Physics source. Core now carries the 109 bounded source-provenanced excerpts in [BRVIN_M15_PASSAGE_QRELS_REVIEW_PACK.md](BRVIN_M15_PASSAGE_QRELS_REVIEW_PACK.md), backed by [the machine-readable review fixture](../test/fixtures/brvin-m15-passage-qrels-review-pack.json). The fields for Reviewer A, Reviewer B and adjudicated grade are intentionally blank. Reviewers must work independently and use the literal source notation and source spans; do not substitute model grades for human qrels or conflate retrieval relevance with answer-generation correctness.

The original-PDF-assisted five-query notation audit passed 5/5 for both providers, but that result applies only to the one-page visual-evidence route. It does not repair the immutable raw OCR, normalized text or indexed passages. The OCR-only answer and retrieval receipts remain separately preserved.

After independent annotation/adjudication, continue the explicit M15 issue gates: broader multi-document formula/mixed-query relevance, wrong-project/no-grant isolation, revoke-with-vectors-retained, throttling and idempotent recovery, HNSW-aware concurrency/latency/throughput, embedding/index/storage/query costs, and rollback rehearsal. Keep D1 authoritative and the private v2 contract unchanged. Production remains `cloudflare-ai-search`; no production selector change or cutover is authorized.

## 12 November 2026 — M15 authorization regression guardrails

Core PR #229 adds unit coverage for two boundaries that the M15 implementation must preserve:

- A revoked application→project grant is rejected by the v2 service resolver as `PROJECT_NOT_AUTHORIZED` before quota reservation and before provider search.
- The Qdrant hybrid helper applies the current per-request project/source allowlist to both dense and sparse calls, and an empty authorized-source list exits before query embedding or Qdrant network requests.

This is deliberately **unit-level evidence**. It does not prove a live v2 request routed through Qdrant, a live D1 grant revocation while vector points remain, or provider-side cache invalidation. The live M15 authorization/isolation and revoke-with-vectors-retained acceptance subsequently passed on 12 November under persisted receipt `e305a581-3d3c-469c-b2b5-093598783df4`; see the 13 November continuation below. The provider port on production private v2 still selects AI Search; these staging routes do not add Qdrant to production retrieval or change the frozen contract.

## 12 November 2026 — release-scope classifier correction

Core PR #229 added only tests and migration documentation. The v2 authorization unit-test path was not in the explicit production-scope allowlist, although the companion Qdrant test path was. As a result, the main-branch workflow treated the test-only v2 file as a production runtime change and uploaded new paired Worker versions. This was an unnecessary redeploy, not a retrieval-provider cutover: Cloudflare read-back still showed Core `parmar-ai` and `brvin-service` at 100% with `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`, `BRVIN_CORPUS_MANIFEST_ENABLED=false`, and Teachers unchanged on its existing private bindings.

Core PR #230 merged the correction that adds `test/brvin-v2-service.test.ts` to the unit-test-only allowlist. Release validation run #43106817349 passed TypeScript, full Vitest, Node tests and both Worker dry-runs; the production deployment, credential and live-production verification jobs were skipped. Actual source/provider/binding changes remain subject to the normal production classifier and paired deployment/acceptance process.

## 12 November 2026 — M14 staging workflow test-only deployment guard

Core PR #229 changed a Qdrant authorization test, which correctly triggered M14 staging validation on the pull request. The same test path was also listed under the M14 workflow's `push` trigger, so merging the test-only change caused an unnecessary staging Worker upload even though no staging runtime/config source changed. The resulting staging version remained the isolated Vertex/Qdrant environment; no production provider selection was changed by this staging deploy.

Core PR #231 merged this trigger correction. Staging-related tests remain in `pull_request.paths` so a PR validates the M14/M15 staging tests and dry-run; the test-only paths and the workflow's own file are removed from `push.paths`. Main-branch test merges continue to receive full Core Release validation through the general `test/**` trigger, while actual M14 runtime/config changes still trigger isolated staging deployment. PR Release validation run #43107762545 and M14 staging workflow #43107761955 both passed; production deployment and M14 staging deploy steps were skipped on the PR event.


## 12 November 2026 — current deployment and coordinated acceptance receipt

Cloudflare read-back after Core PRs #228–#231 confirms production `parmar-ai` version `9d289364-a65d-4fa4-9df7-84f9418eeac2` / deployment `fae0c117-5330-428d-b0cb-0ccb4798acc7` and private `brvin-service` version `fd1fb0c0-98f9-46a8-bf63-6b0f86167359` / deployment `f1c1e8d7-953b-4c75-838c-45c9884f1380`, each at 100%. Both still select `cloudflare-ai-search`; `parmar-ai` retains `BRVIN_CORPUS_MANIFEST_ENABLED=false`. These Core versions were uploaded by the test-only redeploy caused by PR #229's missed test-only allowlist entry; no runtime source/provider/contract was changed in PR #229. PR #230 corrected that classification. No provider cutover occurred.

The isolated staging Worker remains `parmar-ai-m14-staging` version `e58546a5-c9e2-4bef-8d27-da8c606995a7` / deployment `2cbed610-fae7-4212-87ac-0cb5c2a9ff48`, 100%. Teachers remains production Worker version `68d6694c-6371-4cae-8a25-4af40ca15706` / deployment `31ff2a01-b0f4-4be8-92d3-63e2d91adddf`, 100%, with only the private Core management and retrieval bindings.

Core PR #228 merged the 109-excerpt review pack and synchronized documentation. Teachers PR #46 synchronized consumer documentation. Core PR #229 merged unit tests for revoked D1 app-project grants and per-request Qdrant source filtering; those tests passed with the full suite and staging dry-run, but do not prove live D1-to-Qdrant revocation while points remain. Core PR #230 merged the production-scope allowlist correction. Core PR #231 merged the M14 staging push-path correction. Both CI fixes passed their PR validation and their deployment steps were skipped.

**M15 status at this checkpoint:** the project owner explicitly waived the two-independent-reviewer requirement for the isolated staging gate and accepted the separate 109-candidate AI-assisted assessment; this must not be described as human qrels, and the human-review fixture remains blank. The live wrong-project/no-grant and revoke-with-vectors-retained authorization subgate subsequently passed under receipt `e305a581-3d3c-469c-b2b5-093598783df4`. The immediate next action is the deployed multi-source Prepare/Evaluate operator run; afterward, continue claim-to-passage/formula grounding, retry/recovery/throttling, HNSW-aware representative load, repeatable latency/throughput/cost and rollback. Keep the v2 contract, D1 authorization authority, GCS-derived-artifact durability and both existing admin experiences unchanged. No production cutover is authorized.


## 12 November 2026 — M15 owner-waived AI passage assessment

Core PR #233 records a source-grounded AI assessment of all 109 saved retrieval candidates, explicitly authorized by the project owner instead of two independent human reviewers. The original review fixture's Reviewer A/B/adjudication fields remain blank; the assessment is stored separately at `test/fixtures/brvin-m15-owner-waived-ai-passage-assessment.json` and summarized in [the assessment report](BRVIN_M15_OWNER_WAIVED_AI_PASSAGE_ASSESSMENT.md). Do not describe this as independent human qrels.

For P01–P12, both providers put a grade-2+ passage at rank 1 in all 12 queries and both have MRR 1.0. Mean nDCG@5 is 0.9977 AI Search and 0.9905 Qdrant. AI Search returned 22 positive candidates with 19 graded 2+ (86.4% precision among returned candidates; fixed-depth P@5 31.7%). Qdrant returned 60 with 22 graded 2+ (36.7% for both precision denominators). Across N01–N04, AI Search returned zero; Qdrant returned 20 candidates, 15 grade 0, five grade 1 and zero grade 2+. H01's page-8 sign-correction passage ranked first for both.

Interpretation: Qdrant's strong rank-1 evidence and faster sequential timing warrant continued staging evaluation, but its larger candidate/no-match noise means it is not a demonstrated quality winner. The fixed suite is small, single-source and AI-graded. Proceed to live authorization/revocation with vectors retained, claim-to-passage/answer grounding, broader multi-document formula fidelity, throttling/recovery, representative HNSW/load, repeatable latency/throughput/cost and rollback. No production selector change is authorized.


## 12 November 2026 — real Core v2 Qdrant staging authorization path

Core PR #234 is merged and deployed to the isolated `parmar-ai-m14-staging` Worker. It uses the same Core `retrieveBrvinForApplicationV2` implementation as the frozen private v2 service contract, with the server-side staging override `qdrant-vertex`. The D1 source registry resolves the fixed eight-page Physics source and current active application/project grant; the Qdrant adapter receives the Core-resolved project ID and source IDs and applies those filters to dense+sparse RRF. Qdrant writes/deletes remain disabled; explicit page/image retrieval remains on AI Search.

The protected route `POST /admin/m15/v2/authorization-check` is available from the existing M14 operator page. It seeds a temporary isolated application/environment/project/grant fixture, performs an authorized retrieval, checks unknown-project denial and revoked-grant denial before quota, verifies the exact Qdrant source point count while revoked, and restores the staging grant in a `finally` block. It does not alter production D1 or production identities. See [M15 Core v2 authorization staging runbook](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md).

Core PR [#235](https://github.com/ashini-x/parmar-ai/pull/235) is now merged (commit `99708ceab9ca83c415bb10cdf2c74ded012c9997`) and deployed to the isolated staging Worker. It adds a D1 receipt row before the run, persists the final JSON/status to `m15_v2_authorization_runs`, and adds focused persistence regression tests. The schema is initialized lazily by the protected action's `ensureFixture`; a read-only query returning `no such table` before the first invocation is expected. The latest staging deployment is version `ffbaa06f-e2ca-46e4-8e82-7516c6738555`, deployment `f4878038-ca99-477a-93f2-2de0c7b1f219`, at 100%. M14 staging validation and deploy [#43219853491](https://github.com/ashini-x/parmar-ai/actions/runs/43219853491) passed; Core Release validation [#43219853527](https://github.com/ashini-x/parmar-ai/actions/runs/43219853527) passed with production deployment skipped.

**Operator execution — completed 12 November 2026.** The protected action produced persisted receipt `e305a581-3d3c-469c-b2b5-093598783df4`, status `passed`, with all eight named checks true. It returned three authorized passages (pages 4, 5 and 8), denied the unknown-project and revoked-grant calls before quota, confirmed all 14 points remained while revoked, consumed exactly one authorized quota unit and restored the staging grant. See the receipt details in [the runbook](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md). Production remains on Cloudflare AI Search.



## 13 November 2026 — M15 live Core v2 authorization and two-source continuation

The live Core v2 authorization/revocation staging action has now completed. Persisted receipt `e305a581-3d3c-469c-b2b5-093598783df4` is `passed`: all eight checks are true. The authorized v2 call returned three passages on physical pages 4, 5 and 8 with valid source/project provenance; wrong-project and revoked-grant calls returned `PROJECT_NOT_AUTHORIZED` before quota/provider retrieval; all 14 existing Qdrant points remained while the grant was revoked; the staging quota moved from 0 to 1 only for the authorized query; and the temporary grant was restored. See [the v2 authorization runbook](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md). This closes the live authorization/revocation subgate for the fixed M15 staging fixture, not M15 as a whole.

The next M15 subgate is a two-source Core v2 retrieval check, implemented in Core PR [#237](https://github.com/ashini-x/parmar-ai/pull/237). The isolated project already contains the eight-page M15 benchmark source. The action adds the existing immutable three-page/seven-chunk M14 Physics corpus as a second source, reuses its original private GCS manifests/raw OCR, indexes it only into the separate M15 staging AI Search instance and Qdrant collection, and marks it READY only after both provider indexes are verified. It then runs five fixed positive/mixed/formula/no-match cases through the real Core `retrieveBrvinForApplicationV2` path with each provider. Each of the ten provider queries uses the same D1 grant/readiness/quota boundary; the receipt records searched-source counts, source/page provenance, expected-location coverage, no-match candidate presence and quota accounting.

**PR/CI/deployment state:** Core PR [#237](https://github.com/ashini-x/parmar-ai/pull/237) introduced the two-source operator; follow-up PR [#238](https://github.com/ashini-x/parmar-ai/pull/238) corrected `pdf_page` to numeric metadata to match the dedicated M15 AI Search schema and added regression coverage. Both are merged. PR #238's typecheck/full test/build, focused M14 staging tests and Wrangler dry-run passed. M14 staging workflow [#43311490119](https://github.com/ashini-x/parmar-ai/actions/runs/43311490119) deployed Worker `8d732f8b-b14c-4e47-aeae-ce39d8db9f9f` at 100%; Release validation [#43311489792](https://github.com/ashini-x/parmar-ai/actions/runs/43311489792) passed and skipped production deploy/verification after the production-scope classifier succeeded. The only pending step in this subgate is the protected multi-source Prepare/Evaluate action.

Now that CI and isolated staging deployment are complete, use [the M15 multi-source staging runbook](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md) and the operator page `/admin/m15/benchmark/multi-source`. Preparation reuses the immutable source: no PDF upload or Vision OCR is needed. If AI Search returns `queued`/`running`, re-enter the local staging token and repeat preparation to inspect the same deterministic key. Once the action reports exactly two READY sources and both indexes are verified, run the paired five-query evaluation once; it reserves ten staging query units.

This is a bounded source-discovery/provenance subtest, not independent human passage qrels, claim-to-passage adjudication, consumer answer correctness/abstention, a representative load test, an SLO or a complete cost evaluation. It does not change the frozen v2 contract or require any Teachers runtime, binding, SDK, credential or UI change. Production remains on Cloudflare AI Search with AI Search retained as rollback provider through the required 14-day soak after any separately approved future cutover. M15 remains **IN PROGRESS**; M16 and M17 remain later gates.
