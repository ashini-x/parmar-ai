# Data Directory

This directory is intentionally lightweight in the public repository.

Do not commit:

- production D1 exports,
- Telegram user exports,
- raw message dumps,
- service-account files,
- private datasets,
- copyrighted/unauthorized source material,
- generated user-level analytics snapshots.

Reference schemas belong in the repository (see `migrations_0001_initial.reference.sql`). Runtime production data belongs in the configured Cloudflare services, not in Git.
