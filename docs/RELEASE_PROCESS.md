# Release Process

**Production line: 2.6.x**

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

## 6. Smoke test

At minimum, validate:

- Worker health
- Telegram webhook behavior
- one factual question
- one follow-up
- admin login
- affected administrative action
- relevant state/analytics changes

## 7. Rollback

Rollback to a previously verified production version.

Do not reconstruct a rollback manually from memory or from an edited working directory.

## 8. Post-release review

Confirm:

- production behavior matches the release;
- critical logs are clean;
- analytics are updating;
- no secret material entered the repository;
- documentation describes the released state.

## 9. Emergency changes

Security and outage fixes may prioritize stabilization first, but they still require a formal change record and documentation review before the next normal release.
