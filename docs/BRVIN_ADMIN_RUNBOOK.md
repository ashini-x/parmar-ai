# BRVIN Administrator Runbook

**Audience:** an administrator who manages teachers' knowledge projects and connects independent applications.  
**Last reviewed:** 6 November 2026.  
**Workspace:** [BRVIN Admin](https://parmar-ai.thenewtongs.workers.dev/admin/brvin)

This is the day-to-day operating guide. The administrator does not need to create a database, Cloudflare Worker, search index or OCR pipeline for each teacher. BRVIN reuses the shared knowledge registry and retrieval service.

## 1. Open the workspace

1. Open the BRVIN Admin link above in a browser.
2. Sign in with your existing administrator account.
3. The left navigation is organised around **Knowledge sources**, **Collections**, **Knowledge projects**, **Live operations**, **Governance** and **Applications**. On a narrow phone screen, the navigation can scroll horizontally.
4. Use **Live operations** to check ingestion/retention jobs, application connections and recent activity.

Never send another person your admin password, browser session, cookies, private key, Cloudflare token, Google service-account key or a connection nonce/proof.

## 2. Create a teacher knowledge project

A knowledge project is the teacher's permission boundary—the teacher's digital brain.

1. Open **Governance**.
2. Under **Create a teacher knowledge project**, enter the Teacher / owner label (for example, `Teacher A · Mathematics`), a clear project name and a short description.
3. Create the project.
4. Open **Knowledge projects** and select **View details** to check the source count, assigned applications, monthly project searches and activity.

Creating a project does not create a separate application, GitHub repository, Worker, D1 database or search index.

## 3. Organise and upload knowledge sources

### Collections

A collection is a reusable group of books. It is not shared with a project until the administrator assigns it.

1. In **Governance**, create a collection with a meaningful name and description.
2. Add a PDF using **Add knowledge source**.
3. Choose a source title and collection; review the PDF's SHA-256 and page count.
4. Confirm the upload. The background pipeline stores the original PDF privately, submits Google Vision document OCR, indexes pages and runs retrieval-readiness checks.
5. Use **Live operations → Live pipelines** or the source's **Manage → Inspect processing pipeline** to follow the job. A source is retrieval-ready only after its full page count is indexed and QA has passed.

Do not close the browser during the initial upload transfer. After the upload has completed and the background job is running, processing continues in the Worker/Workflow infrastructure.

### Assign direct book access

1. Open **Knowledge sources** and find the PDF.
2. Select **Manage** → **Manage direct project access**.
3. Tick only the projects that should be allowed to retrieve this book.
4. Save the assignments.

### Assign collection access

1. Open **Knowledge projects** → **View details** for the teacher.
2. Select **Manage collection grants**, or use **Governance → Collection access**.
3. Choose the project and tick its allowed collections.
4. Save collection access.

Direct-book grants and collection grants are independent and additive. A book can be available through either path. Only ready, fully indexed books are returned by retrieval. New ready books added to a granted collection become eligible automatically.

## 4. Register and connect an application

An application is an independent bot, website or assistant that calls BRVIN.

1. Open **Applications**.
2. Under **Connect an existing application**, enter its name, owner label, purpose, repository URL/default branch (metadata only), runtime provider and environment details.
3. Register the application. Use a separate environment record for production, staging and preview.
4. Open the application's card and check the registered environment and Worker URL.
5. Use **Generate ChatGPT handoff** to create the non-secret integration prompt and manifest. Paste it into the engineering conversation that has access to the application's repository and deployment account.
6. Once the app's Worker has the private `BRVIN_SERVICE` Service Binding and the trusted environment ID configured, select **Verify connection** for that exact environment.
7. The environment should show **Connected** or **Connected · no ready knowledge**. The latter means the private connection works but no ready source is currently authorised.

Repository metadata does not grant ChatGPT GitHub access. Make sure the engineering chat has separately been authorised for the repository. The handoff never contains a Cloudflare master token, Google private key or BRVIN secret.

## 5. Grant or revoke application access

Application-to-project grants control which knowledge projects an application can retrieve.

- From an application's card, use **Grant selected project** to add another project.
- From a knowledge project's details, use **Grant application access** to add an application.
- Revoke access from either view. Future retrieval requests are denied after the grant becomes revoked.
- Grant history is retained for audit.

**Important:** an application-project grant is application-wide, not a per-teacher login policy. If one bot or website serves several teachers, that application must authenticate each end user and map that user to an allowed project on its own server before calling BRVIN. Do not expose multiple teacher projects to a shared end-user session without that application-side check.

## 6. Understand usage and quotas

The current v2 service enforces a maximum of **800 retrieval queries per knowledge project per UTC calendar month**. The administrator dashboard uses the same bounded limit as the retrieval service.

- Knowledge-project views show searches used, monthly limit and remaining allowance.
- Application cards show the project counters associated with their grants.
- If two applications share a project, they consume the same project allowance. The dashboard does not claim that these shared project queries are attributable to one application.
- Fatman's legacy v1 usage counter is retained and shown under the Fatman project; it is not silently combined with another project's usage.

When the project allowance is exhausted, BRVIN returns `MONTHLY_LIMIT_REACHED` before searching. It does not broaden access or fall back to unfiltered search.

## 7. Operate the Live operations view

The Operations page refreshes automatically and displays:

- Project search usage for the current month.
- Active environment connection failures.
- Failed and warning activity from the last seven days.
- Outstanding/running/failed OCR-only cleanup.
- Current pipeline jobs and the activity timeline.

Use the activity filter to narrow the event list to failures/warnings, storage retention, application connections, ingestion/indexing or governance.

For a failed or stuck source, open the source's **Manage** panel and select **Inspect processing pipeline**. Read the latest workflow, Vision and activity status before choosing any action. Use **Resume** only when the system reports that the failed import is resumable. Do not use full book deletion as a troubleshooting shortcut.

For PDF OCR failures, distinguish Vision's long-running operation status from the existence of its GCS output JSON. In **Inspect processing pipeline**, review the Vision-reported output destination and the object inventory under the expected temporary OCR prefix. Vision writes `output-N-to-N.json` directly inside the returned destination prefix; do not append a second `ocr/` directory. If Vision reports complete but the page JSON objects are missing, do not re-upload the PDF or resume indexing against absent files. Correct the Vision/GCS output issue first; a fresh OCR operation can incur another Vision charge and requires operator approval.

## 8. Google Cloud Storage and OCR retention

BRVIN retains three different things separately:

1. **Original source PDF** — the private uploaded document.
2. **Persistent indexed pages** — the searchable page text used by retrieval.
3. **Temporary Google Vision JSON** — intermediate OCR output used during indexing.

The OCR-only cleanup action removes only temporary Vision JSON. It must retain the original PDF, indexed page text, project grants and READY/archived state. Full book deletion is a different, destructive operation.

### Production permission and cleanup verification — 6 November 2026

The earlier production diagnostic found that the ingestion service account lacked `storage.buckets.get`. The administrator subsequently applied the bucket-scoped permission change and reported that the live read-only check showed:

- Core object access: **READY**.
- Bucket metadata inspection: available.
- Lifecycle permission check: no remaining permissions requested by the diagnostic.

The relevant bucket and service identity are:

- **Bucket:** `parmar-fatman-ocr-90db7be4`
- **Ingestion service account:** `telegram-bot@project-90db7be4-619f-4ed7-89b.iam.gserviceaccount.com`

The Rain Gardens test source was then manually retried using **Vision OCR cleanup only**. Production event `#854` is `source.vision_ocr_deleted`, status `completed`. A read-only D1 check confirmed the source remains `READY`, has `3/3` indexed pages, and has its OCR cleanup completion marker set. The event detail recorded `objectVersionsFound=0` and `objectVersionsDeleted=0`: the workflow checked the exact OCR prefix and verified no live object versions remained; it does not prove that this specific retry physically deleted object bytes. The original PDF and indexed search pages remain available.

### Verify the 30-day OCR lifecycle rule

Permission availability and an installed lifecycle rule are separate facts. The read-only diagnostic must report the actual bucket rule, not infer installation from IAM permissions alone.

The M11 lifecycle-verification release is now deployed (PR #101 / Main Release Validation #778). After a scheduled supervisor cycle (five-minute cadence), run the read-only check:

1. Open **Live operations** and select **Run read-only storage check**.
2. Confirm **Core object access: READY**.
3. Confirm **Lifecycle configuration permissions: READY**.
4. Confirm **30-day OCR lifecycle rule: INSTALLED (age 30 days)**. The rule must be a GCS Delete rule scoped to exactly `brvin/temporary-vision-ocr/`, with age no greater than 30 days.
5. If the rule says **NOT INSTALLED**, wait for the next five-minute retention-supervisor cycle, then run the read-only check again. The supervisor now verifies/installs the rule even when there are no cleanup candidates.
6. Run the read-only check again. Do not report the safety net as ready until the rule itself says **INSTALLED**.
7. If the result says **BLOCKED — unsafe existing Delete rule**, stop and ask a Google Cloud administrator to review the existing lifecycle policy. BRVIN intentionally refuses to replace or widen existing Delete rules that could affect original PDFs.

The scheduled supervisor preserves unrelated bucket rules, refuses unsafe rules that overlap source-PDF paths, and adds only the exact OCR temporary-prefix rule. The read-only diagnostic itself never updates lifecycle configuration, creates or deletes objects, or changes bucket settings.

**Production verification — 6 November 2026:** The user ran the protected read-only check after deployment and confirmed **Lifecycle configuration permissions: READY** and **30-day OCR lifecycle rule: INSTALLED (age 30 days)**. The live retention-rule acceptance check is complete. Do not repeat or manually modify the lifecycle configuration.

**Authenticated Operations walkthrough — 6 November 2026:** The user reviewed Operational summary, Live pipelines and Specialist activity:
- Operational summary: 33 project searches this month; 0 connection failures across active environments; 404 failed events during the last seven days; 0 OCR cleanup failures; retention note reported no attention required. The dashboard implementation confirms that “Failed events” is a seven-day count of activity rows whose status is `failed`; 404 is not an HTTP status code and does not by itself represent active/recoverable jobs.
- Live pipelines: the panel reported no active processing or deletion jobs. No retry or recovery action was used.
- Failures and warnings: the visible historical failures dated 5 November repeated the same `storage.buckets.get` denial for the ingestion service account on the private OCR bucket. The screenshots did not show a new failure type.
- Storage and OCR retention: the latest visible request at 3:36:38 AM on 6 November was an OCR-output-only deletion request that explicitly retained the original PDF and indexed pages. The 3:36:44 AM event was marked **COMPLETED** and stated that the OCR output was removed from the private prefix while the original PDF and indexed search pages remained available. Event detail reported `objectVersionsFound=0` and `objectVersionsDeleted=0`, so this specific run found no object versions and does not support a claim of a positive physical-deletion count.

The authenticated Operations walkthrough is complete. The remaining M11 gate is genuine teacher-focused application acceptance: connect an independent consumer app, verify retrieval from a real teacher project/source, revoke access and confirm denial.

### Safe cleanup procedure

1. Open the affected source's **Manage** panel and select **Retry Vision OCR cleanup** only after diagnosing/fixing the underlying storage issue.
2. Confirm the exact document title when prompted.
3. Wait for the workflow to finish. “Cleanup started” is not a completion result.
4. In Operations, verify `source.vision_ocr_deleted` is completed and the source remains `READY` with all indexed pages intact.
5. Read the event detail carefully. If `objectVersionsFound` is zero, the operation confirmed there were no live versions left under the dedicated OCR prefix; do not describe that run as having deleted a positive number of objects.
6. If GCS soft delete or a retention policy is enabled, deletion may remain recoverable until the provider's hard-delete time. Do not promise immediate physical erasure based only on a successful delete request.

The OCR-only action is separate from full book deletion. Never use full book deletion as an OCR-retention troubleshooting shortcut. The original PDF, indexed page text, project grants and READY/archived state must remain intact.
## 9. Connection failures

Open **Applications** and find the exact environment that failed. Review its last-check timestamp and safe failure code.

- `PROBE_UNREACHABLE`: the browser could not reach the configured consumer probe endpoint.
- `PROBE_REJECTED`: the deployed consumer did not return a valid private-service proof.
- `CHALLENGE_EXPIRED`: the short-lived challenge expired; run verification again.
- `ENVIRONMENT_CHANGED`: the target environment identity/configuration changed during verification.

Check the Worker URL, the consumer's private Service Binding target/entrypoint and the trusted environment ID in deployment configuration. Do not copy a proof or nonce into a support ticket. Do not mark an environment Connected manually; rerun the live check.

## 10. Safe operating rules

- Never share admin passwords, session cookies, private keys, OAuth client secrets, Cloudflare tokens, Google keys, raw challenge nonces or proofs.
- Do not create one database, search namespace, Worker or OCR pipeline per teacher.
- Do not assign every project to every application by default.
- Do not treat an app-wide grant as end-user teacher authorisation.
- Do not delete the PDF or search index when the intent is only to clean temporary Vision JSON.
- Do not manually edit production D1 rows to make a status look successful.
- Do not call the system commercially ready until a real independent consumer app has completed its user authentication, retrieval and operational acceptance.

## 11. Quick daily checklist

1. Open **Live operations**; check failed sources, connection failures and warnings.
2. Check quota remaining for projects that are in active use.
3. Resolve any source indexing or retention issue before uploading more material.
4. Check new application environments are correctly connected.
5. Review project/application grants and revoke access that is no longer required.
6. Preserve the existing Fatman and AskMoina production state.


## 12. Register the BRVIN Teachers management environment

This step is required before BRVIN Teachers classroom/collection/source screens can call Core. It does not create a teacher or knowledge project. BRVIN remains the knowledge authority.

1. Open **Applications** in BRVIN Admin.
2. Register an application with slug exactly `brvin-teachers`, name `BRVIN Teachers`, repository `https://github.com/ashini-x/brvin-teachers`, default branch `main`, and runtime provider **Cloudflare Workers**.
3. Add the production environment with key `production`, display name `BRVIN Teachers Production`, Worker name `brvin-teachers`, and Worker URL `https://brvin-teachers.thenewtongs.workers.dev`.
4. Save the application/environment. Confirm both are **Active** and the registered Worker name is exactly `brvin-teachers`.
5. Copy the environment UUID into the BRVIN Teachers repository's deployment-controlled Service Binding configuration in place of `BRVIN_TEACHERS_ENVIRONMENT_ID_REQUIRED`. This UUID is an integration identifier, not a secret; do not put it in a browser request or user-controlled field.
6. Deploy the consumer through its GitHub Actions release workflow. Its Service Binding targets the named `BrvinTeachersManagementApi` entrypoint on the same-account `parmar-ai` Worker. The manager health method must return the registered application/environment state before knowledge actions are enabled.
7. Do not create an application-project grant manually for each teacher classroom. The management entrypoint creates the application-project grant when it creates a teacher-owned project. That grant is application-wide, not end-user tenant authorization; the consumer still resolves the teacher from its own database on every operation.

**Current release state — 6 November 2026:** Core PR #107 is merged and deployed in [release #42171109140](https://github.com/ashini-x/parmar-ai/actions/runs/42171109140). Consumer PR #2 is merged and deployed in [release #42171352464](https://github.com/ashini-x/brvin-teachers/actions/runs/42171352464). The consumer's `BRVIN_MANAGEMENT` Service Binding is live and targets `parmar-ai` / `BrvinTeachersManagementApi`. A read-only registry query found no `brvin-teachers` application or environment row yet; the deployed app config retains the fail-closed placeholder. Therefore the management entrypoint must reject this consumer until the steps above are completed.

**Next actions:** complete this registration, place the generated UUID in the consumer deployment config and deploy it. Then configure the separate retrieval `BRVIN_SERVICE` binding to `brvin-service` / `BrvinRetrievalApi` with the same trusted environment ID and complete a real teacher/source retrieval test followed by revocation denial. The management entrypoint is not the retrieval contract and is not a public HTTP endpoint.

Do not replace the placeholder with an invented ID. The first teacher, project, collection or PDF must be created by an actual operator action, not deployment or migration.
