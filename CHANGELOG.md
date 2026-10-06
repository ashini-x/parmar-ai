# Changelog

## [2.4.2] - Privileged Access Controls

- Add explicit bot-owner/admin Telegram identity configuration.
- Add D1-backed unlimited-AI access overrides targeted by Telegram user ID.
- Add admin-only `/grant <telegram_user_id>`, `/revoke <telegram_user_id>`, and `/unlimited <telegram_user_id>` commands.
- Keep the normal 20/day limit for ordinary users.
- Keep 5/10-second burst protection for all accounts, including unlimited/admin accounts.
- Make `/profile` display unlimited access for privileged accounts.
- Keep public-source secret boundaries intact.

All notable production changes are recorded here.

## [2.4.1] - Stable

- Separate daily and burst rate-limit messages.
- Separate daily and burst analytics events.
- Preserve rebuilt v2.4 profile-learning architecture.

## [2.4.0]

- Add evidence-based learning signals.
- Add safe profile normalization/migration.
- Add profile persistence isolation.

## [2.3.0]

- Add conversation intelligence and answer reliability improvements.

## [2.2.1]

- Fix D1 initialization.

## [2.2.0]

- Add centralized admin analytics.
