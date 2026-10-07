# Versioning and Release Discipline

## Version format
Production releases use `MAJOR.MINOR.PATCH`.
- Major: incompatible architecture/product change.\n- Minor: backward-compatible feature milestone.\n- Patch: bug, reliability, security, or operations correction.

## Current line
The current documented production line is **v2.6.x**.

## Release process
1. Freeze the previous verified artifact.\n2. Define the change and affected trust boundaries.\n3. Implement one coherent change set.\n4. Add regression coverage.\n5. Update affected documentation and legal notices.\n6. Run automated checks.\n7. Run relevant manual production tests.\n8. Review the exact revision.\n9. Deploy that exact revision.\n10. Record the Cloudflare version ID.

## State-sensitive changes
D1 schema, Durable Object state, Queue behavior, identity, retention, deletion, access control, prompts, and external credentials require explicit compatibility review.

## License changes
Changing from the proprietary license to a broader or open-source license is an ownership-level decision and must be made deliberately in a separate reviewed change.