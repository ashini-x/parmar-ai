# Changelog

## Unreleased: Mobile-safe Telegram progress labels
- Shortened every live status to 22 characters or fewer and removed long explanatory phrases so each progress state is designed to fit a single line in Telegram mobile bubbles.
- Centralized the labels and added a regression test for both the one-line constraint and maximum length.

## Unreleased: Live Telegram progress states
- Replaced the single generic wait label with contextual progress states for question understanding, Fatman retrieval and page review, current-source checks, image interpretation, quiz preparation, and safe retries.
- Reuses the original Telegram status message for every state and then transitions it into the existing streamed answer, avoiding separate status-message clutter.
- Serializes and coalesces edits to respect Telegram's practical edit cadence without dropping the latest answer chunk; progress edits remain best-effort and cannot interrupt generation.
- Added regression tests for status-to-answer transitions, chunk coalescing, and Telegram edit failures.

## Unreleased: Fatman Google Vision OCR importer
- Replaced Cloudflare image OCR with Google Cloud Vision Document Text Detection; extracted per-page text is indexed in the existing Cloudflare AI Search instance with exact PDF page metadata.
- Added a zero-image Google Vision connectivity check, explicit confirmation of at least 538 remaining free OCR units, sequential page processing, and resumable page indexing.
- Let Cloudflare index extracted text asynchronously while the admin page polls overall progress, so normal indexing delays do not stop page uploads.

## Unreleased: Fatman async indexing failures
- Wait for Cloudflare’s indexing result for each uploaded page and stop immediately when processing fails or remains pending.
- Surface the provider’s page error in the admin status instead of continuing bulk uploads.

## Unreleased: Fatman PDF importer fix
- Injected the approved PDF fingerprint into the browser-side import module so the full selected PDF can be validated before indexing begins.
- Added regression coverage for the served admin page fingerprint.

## Unreleased: Photo Doubt Support (feature branch)
- Added private Telegram photo doubts, including photo-only albums of up to 5 pictures, as one SSC doubt and one quota unit; albums over the limit are rejected.
- Explicitly reject videos and mixed photo/video albums; rate-limit unsupported-video notices to prevent reply spam.
- Added bounded image downloads and Gemini multimodal input; image bytes are not persisted.
- Album photo IDs stay in Durable Object retry state and are cleared when processing completes.


## 2.8.0: Production Multi-MCQ Quiz Batches
- Added bounded multi-MCQ requests with up to 10 independent native Telegram quizzes per request.
- Batch size is carried through Durable Object job state and accounted for against daily and burst controls.
- Underspecified batch requests ask for the topic and remember the requested quantity for the topic reply.
- Removed separate bot result messages after quiz selections; Telegram's native quiz result is the student-facing result surface.
- Persisted quiz outcomes into conversation context for follow-up questions about an answered quiz.
- Added cleanup for partial batch delivery and quiz-session persistence failures.

## 2.7.0: Intent-Driven Native Telegram Quizzes
- Added semantic response-mode selection so ordinary doubts remain text while genuine MCQ/test/quiz intents become native Telegram quizzes.
- Added non-anonymous Telegram quiz delivery with exactly one correct answer, compact in-card explanations, and immediate result feedback.
- Added D1 quiz-session persistence for poll correlation, deletion, retention, and correct/incorrect outcome tracking.
- Added poll-answer webhook handling and protected multi-bot quiz correlation.
- Added fallback behavior when quiz-session persistence is unavailable so a valid answer can still reach the student.
- Added regression coverage for quiz packet validation and poll-answer webhook subscription.

## 2.6.1: Production Hardening
- Aligned release metadata and runtime fallback on v2.6.1.
- Made dedicated Telegram credential encryption mandatory for production writes, with controlled legacy-read compatibility during key migration.
- Reduced the public health endpoint to a minimal health response.
- Reduced the production raw analytics retention baseline from 90 days to 30 days.
- Hardened Durable Object internal payload handling and centralized lease-ownership validation.
- Added regression coverage for freshness classification, lease ownership, malformed AnswerPackets, retention defaults, encryption configuration, and public health behavior.

## 2.6.0: Production Reliability & Access Control Hardening
- Fixed Student action-button event handling.
- Added D1 read-back verification for suspend/unsuspend.
- Hardened unlimited-access verification and audit handling.
- Fixed Access-tab Telegram ID validation.
- Fixed Telegram Test connection/Disconnect validation.
- Added proprietary licensing, AI/ML restrictions, brand policy, privacy notice, governance, support, and documentation-index files.
- Refreshed release, operations, and production test documentation.
- Lease-fenced Durable Object jobs and stale-job recovery.
- Correct processing/typing lifecycle and retry classification.
- End-to-end dashboard unlimited-access verification.
- Broader grounding detection and truthful analytics.
- Secure Telegram setup authentication.
- Explicit user data deletion.

Historical releases remain below this entry.