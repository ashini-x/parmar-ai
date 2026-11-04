# Release Process

**Production line: 2.8.0**

Parmar AI releases are controlled changes, not ad-hoc source uploads.

## 1. Change definition

Start with a defined change set and a clear acceptance condition.

Do not mix unrelated feature work into reliability or security releases.

## 2. Engineering review

Review:

- affected source files
- data-model impact
- authentication/authorization impact
- provider/API impact
- migration requirements
- backward compatibility
- rollback plan

## 3. Automated validation

Run the repository's configured type-check, test, and format checks.

For production changes, the exact artifact intended for deployment must be the artifact validated.

## 4. Documentation review

Update the affected:

- changelog
- release notes
- project status
- security/privacy documentation
- operations/test documentation

## 5. Deployment

Deploy the exact verified artifact and record the provider-side deployment/version identifier.

## 6. Live release acceptance

Run `node scripts/production-release-acceptance.mjs` after deployment and before declaring the release accepted. The script is read-only and requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

It must confirm:
- the newest `parmar-ai` deployment has exactly one version at 100% traffic;
- the newest `brvin-service` deployment has exactly one version at 100% traffic;
- the public root endpoint identifies the परमार्थAI Worker;
- `/health` is healthy, its BRVIN binding is connected, Fatman retrieval is ready, and at least one authorised source exists.

The script writes `dist/production-release-manifest.json` and appends a GitHub Actions summary. The manifest contains deployment/version IDs, source revision, workflow run, endpoint checks, and timestamp; it must not contain secrets or student data. A manual `workflow_dispatch` run performs the same read-only check without deploying.

## 7. Smoke test

At minimum, validate:

- Worker health
- Telegram webhook behavior
- one factual question
- one follow-up
- admin login
- affected administrative action
- relevant state/analytics changes

## 8. Rollback

Rollback to a previously verified Cloudflare version.

Do not reconstruct a rollback manually from memory or from an edited working directory.

## 9. Post-release review

Confirm:

- production behavior matches the release;
- critical logs are clean;
- analytics are updating;
- no secret material entered the repository;
- documentation describes the released state.

## 10. Emergency changes

Security and outage fixes may prioritize stabilization first, but they still require a formal change record and documentation review before the next normal release.
