# BRVIN Retrieval Provider Modernization — Approved Architecture and Migration Plan

**Decision date:** 8 November 2026
**Status reviewed:** 10 November 2026 — M14 staging now applies Core-side intent-weighted RRF after the version-72 component-rank review; human chunk qrels, latency/cost benchmarking and consumer answer-path acceptance remain open  
**Status:** APPROVED DESIGN / M13 MERGED / M14 LIVE STAGING PILOT IN PROGRESS / NO PROVIDER CUTOVER  
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

## 5.2 M14 implementation state — live isolated staging pilot (9 November 2026)

M14 foundation, corpus recovery, staging operator, Vertex/Qdrant indexing/evaluation routes and the Qdrant error-diagnostic correction are merged into Core `main`. The relevant merged PRs are [#148](https://github.com/ashini-x/parmar-ai/pull/148), [#149](https://github.com/ashini-x/parmar-ai/pull/149), [#152](https://github.com/ashini-x/parmar-ai/pull/152), [#155](https://github.com/ashini-x/parmar-ai/pull/155), [#156](https://github.com/ashini-x/parmar-ai/pull/156), [#157](https://github.com/ashini-x/parmar-ai/pull/157), [#159](https://github.com/ashini-x/parmar-ai/pull/159), [#160](https://github.com/ashini-x/parmar-ai/pull/160), [#169](https://github.com/ashini-x/parmar-ai/pull/169), [#171](https://github.com/ashini-x/parmar-ai/pull/171), [#174](https://github.com/ashini-x/parmar-ai/pull/174), [#177](https://github.com/ashini-x/parmar-ai/pull/177), [#182](https://github.com/ashini-x/parmar-ai/pull/182), [#186](https://github.com/ashini-x/parmar-ai/pull/186) and [#188](https://github.com/ashini-x/parmar-ai/pull/188). Core main is at `919b6215a9f7b454468c319d40f899d4bfd34a1d` (10 November 2026).

### Verified corpus and staging configuration

The retained Physics PDF was processed through the one-time staging OCR recovery path; no PDF re-upload was needed. The immutable corpus generation `57129957231e548064e5594d8fb9f501` has been independently read back and verified: source SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, recovered Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff`, three physical PDF pages and seven deterministic chunks (2/2/3). Raw OCR hashes, normalized-text hashes, chunk identities and formula metadata were verified.

The dedicated staging Worker is `parmar-ai-m14-staging` at `https://parmar-ai-m14-staging.thenewtongs.workers.dev`. Following Core PR #191, M14 staging workflow [#57](https://github.com/ashini-x/parmar-ai/actions/runs/42811222473) passed typecheck, the targeted staging Worker tests, versioned-settings guard and Wrangler dry-run, then deployed version 72 (`ec3614bf-0077-4c93-82e5-f685ea38456f`; deployment `e4bbe875-0216-4d96-a391-4ac4c43dbd76`) at 100%. Cloudflare read-back confirms Vertex `gemini-embedding-001` in `asia-south1`, 768 dimensions, Qdrant collection `brvin_m14_physics_pilot_v1`, and the expected HTTPS endpoint are present as non-secret vars on the active version. The dedicated D1 and GCP/admin/Qdrant secret bindings are also present; `BRVIN_M14_QDRANT_API_KEY`, `BRVIN_M14_ADMIN_TOKEN` and the GCP private key remain `secret_text` and are not recorded here. The versioned Wrangler config plus workflow guard now prevents the dashboard-only variable loss that affected version 70.

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

**Next:** run **Run non-gating negative + rank-stability diagnostics** once in the verified version-71 staging Worker. Inspect the complete unique candidate texts in `candidateEvidence` and its query/repeat/rank mapping, then create chunk-level relevance judgments with human review. This is query-only: do not rerun OCR, re-index or repeat the ten positive queries. After chunk review, test answer abstention separately through the private Teachers v2 consumer path.

**HNSW/benchmark note:** the two payload indexes are being added to the already-populated seven-point pilot collection to restore strict-filter query functionality; no point rewrite is needed for this query fix. Qdrant recommends creating payload indexes before ingesting vectors so filter-aware HNSW edges can be built with those indexes present ([Qdrant indexing guidance](https://qdrant.tech/documentation/manage-data/indexing/)). Before representative M15 latency/load benchmarking, verify whether the collection has built an HNSW graph and rebuild/re-optimize it after the new payload indexes, or use a fresh benchmark collection where the payload indexes are created before point ingestion. Do not treat the seven-point pilot query repair as proof of large-corpus HNSW performance.

Ten positive cases now have source-grounded expected pages across the three-page PDF: conceptual law (page 2), exact formula (page 2, `Fnet = m × a`), paraphrase (page 2), equivalent notation (page 2), uppercase `Fnet` symbol (page 2), 4 kg worked example (page 3), numerical force setup (page 3), mixed theory+formula (page 2), friction/net-force (page 3), and bus braking/answer key (pages 1 and 3). Two negative cases are OCR-reviewed but deferred from the positive query run: lowercase `f = ma` is absent, and the Planck constant is absent from all three pages. Full M14 acceptance still requires actual retrieval results for the ten positive cases, a defined/evaluated negative-case abstention policy, formula/symbol fidelity, page provenance, project isolation, deterministic re-index, latency, throughput, HNSW optimization and cost evidence.

### Production and consumer isolation

Core Release validation [#1040](https://github.com/ashini-x/parmar-ai/actions/runs/42811222451) passed typecheck, the full Vitest suite, Node tests and both Worker bundle validations after Core PR #191 merged. The paired Core release deployed production `parmar-ai` version `29a993ad-c175-40fe-89d0-58cda2241429` (version 698) and private `brvin-service` version `6ab2530e-c45f-4684-b0b2-1e20246adc32` (version 128), both at 100%. Version settings explicitly select `cloudflare-ai-search`; Core Admin has `BRVIN_CORPUS_MANIFEST_ENABLED=false`. The Qdrant adapter remains isolated to the M14 staging entrypoint, not either production Worker route. No provider cutover or user-facing provider route has changed.

The Teachers production Worker remains on its existing deployment/version; no consumer code, direct provider credentials, SDK, embedding logic or v2 contract change was introduced. The private v2 RPC, D1 authorization/readiness/quota checks and both admin workflows remain unchanged. The consumer owns any eventual final-answer generation, but the current Teachers repository does not yet implement a student/channel/model generation route.
 
## 6. Milestones and acceptance gates

The numbering extends the completed M6–M11 baseline. M12–M17 are the BRVIN retrieval modernization sequence. M12 is complete; M13 provider-boundary and corpus-writer code is merged. M14 adapter, OCR recovery, manifest backfill/read-back and Vertex/Qdrant operator code are merged and deployed. The M14 corpus is verified and the seven-point Vertex/Qdrant indexing action passed deterministic read-back/provenance validation; the three known-evidence Vertex/Qdrant hybrid queries now complete successfully after Core PR #171 added the missing `project_id`/`source_id` payload indexes; all 4/4 expected physical-page references appeared in the top five. The exact source PDF has now been checked against the manifest SHA, and Core is expanding the evaluation to ten positive source-grounded cases with explicit coverage/rank metrics; two negative/no-answer cases remain deferred. No replacement provider is active for production.

| Milestone | Owner(s) | Scope | Acceptance gate | Initial status | Tracking |
|---|---|---|---|---|
| **M12 — Architecture and UX contract freeze** | Core + Teachers | Record provider decision, trust boundaries, compatibility rules, target flow, milestone sequence and UI preservation. | Canonical docs in both repos link to one plan; current production path and no-migration guardrail are explicit. | **COMPLETE — documentation**  | [Core #141](https://github.com/ashini-x/parmar-ai/issues/141) |
| **M13 — Core provider boundary and rebuildable, math-aware corpus** | Core | Define provider/embedding interfaces; deterministic chunker and durable manifests; preserve raw OCR plus versioned normalized text and optional formula/LaTeX representations; content-type metadata; deterministic IDs and replay tests. No production provider switch. | Existing AI Search remains green; replay is deterministic; formula metadata never replaces raw OCR; mixed-content chunks preserve source/page identity; v2 contract unchanged; D1 remains authorization authority. | MERGED — provider boundary, immutable manifests and deterministic replay reader are implemented; the fixed Physics corpus was independently read back and replayed into the M14 staging index with deterministic point/provenance checks; production provider switch remains off and corpus writes remain default-off  | [Core #142](https://github.com/ashini-x/parmar-ai/issues/142) |
| **M14 — Vertex AI + Qdrant unified hybrid Physics pilot** | Core | Prove live Vertex document/query embeddings and Qdrant dense+sparse/RRF retrieval on the recovered Physics corpus; complete mixed-content, provenance, isolation, retry, latency, throughput and cost gates. | Conceptual, exact-formula, paraphrase, equivalent-notation, worked-example, numerical and mixed theory+math queries return relevant evidence with exact source/page provenance; OCR uncertainty is visible; re-index is deterministic; production stays on AI Search. | **IN PROGRESS** — 10/10 positive cases covered 11/11 expected pages; page-label precision@5 0.40 and first-expected-page MRR 0.7833 are not human chunk qrels. Authenticated full-text negative and version-72 component-rank diagnostics are reviewed. For friction, page-3 worked example ranks dense 1 / sparse 5; page-1 broad intro 5 / 1; page-2 context 2 / 2. Their equal-weight RRF scores all tie at 0.6667, explaining three result orders with one unchanged top-five set (expected chunk ranks 3/1/2). Do not change ranking before human qrels and multi-query benchmark. Teachers still lacks a deployed Gemini answer route, so answer-abstention acceptance is blocked. Formula fidelity, security/isolation, retries, HNSW-aware performance/load and cost gates remain open. | [Core #143](https://github.com/ashini-x/parmar-ai/issues/143) |
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

1. Obtain human chunk-level judgments for the positive and negative queries against the source PDF, then calculate chunk-level precision/recall/ranking metrics; keep physical-page metrics separately.
2. Add/verify formula-fidelity cases for the source's uppercase Fnet = m × a, case-sensitive lowercase f = ma, notation/operator differences and OCR uncertainty.
3. The M14 staging pilot now uses Core-side intent-weighted RRF (semantic 70/30 dense/sparse; symbolic 30/70) with stable per-component tie resolution and stable final ordering. The seven-point unit fixture reproduces the observed friction component ranks and the resulting direct-example-first scores. Run the authenticated ten-query and negative/repeatability receipts on the updated staging Worker, then compare the new receipts with the recorded equal-weight baseline. Measure the two-call latency/cost overhead and inspect all positive, formula, paraphrase and negative cases. Keep these weights provisional until human chunk qrels and a multi-query benchmark report aggregate metrics plus per-query regressions.
4. Complete no-grant/wrong-project isolation, revocation while vectors remain present, deterministic retry/recovery, HNSW/resource tuning, latency/concurrency/load and cost benchmarks.
5. Coordinate an actual consumer answer/abstention test only after a real consumer generation path exists and has an approved test boundary.

Do not re-upload, rerun Vision OCR, rebuild the seven-point corpus or repeat the ten positive queries for this diagnostic review. Continue to keep AI Search as the production provider and retain the rollback path through the required 14-day production soak.

For a new chat, read docs/BRVIN_2_MASTER_PLAN.md first, then this migration plan, docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md, docs/BRVIN_SYSTEM_REFERENCE.md, the frozen v2 RPC contract and the M14 runbook. Establish current commits, CI, deployment versions and provider settings in both repositories before changing code. Preserve the unified math-aware path, raw OCR and physical-page provenance, D1 authorization, private v2 contract and both admin experiences.
