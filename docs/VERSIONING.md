# Versioning and Release Discipline

## Version format

Production releases use `MAJOR.MINOR.PATCH`.

- **Major:** incompatible architectural/product changes.
- **Minor:** backward-compatible feature milestones.
- **Patch:** bug fixes, reliability corrections, messaging/operations corrections that do not change the public data contract.

## v2.4.x rule

The v2.4 line is the evidence-based personalization line built on the known-good v2.3 conversation-intelligence architecture.

The release sequence is:

- `2.3.0` — conversation intelligence and answer reliability.
- `2.4.0` — rebuilt evidence-based personalization milestone.
- `2.4.1` — quota messaging and stable release polish.
- `2.5.2` — privileged owner/admin access and targeted unlimited daily-AI grants.

## Release process

1. Freeze the previous production artifact.
2. Implement one coherent change set.
3. Update tests and regression cases.
4. Run type-check/tests/format checks.
5. Run the manual production test plan.
6. Update release notes and changelog.
7. Package an immutable release artifact.
8. Deploy the exact artifact.
9. Record the Cloudflare version ID.

Never silently edit a production artifact after deployment and continue calling it the same version.
