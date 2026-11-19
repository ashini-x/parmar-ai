# Legacy BRɅIN universal UI font assets

**Current asset bundle:** Poppins v24, distributed under the SIL Open Font License 1.1; see [`OFL.txt`](OFL.txt).

CSS family alias currently used by the existing Owner UI: `BRɅIN universal font`. Upstream font family: Poppins. Designers: Indian Type Foundry; Latin design by Jonny Pinhorn; Devanagari design by Ninad Kale. Source: Google Fonts / Fontsource Poppins v24.

Self-hosted WOFF2 subsets for weights 300, 400, 500, 600 and 700:
- Latin
- Latin Extended
- Devanagari

The alias is a product CSS-family name only. The upstream family metadata and attribution remain Poppins.

## Typography policy update — 2026-11-20

The Owner has selected a new role split for future BRɅIN design work:

- **Wordmark/logo only:** AERUNO is the requested display-font direction, subject to obtaining a commercial license covering brand/logo use. The supplied `AERUNO Trial` file is personal-use-only, includes restrictive all-rights-reserved metadata, and lacks the required U+0245 `Ʌ` glyph. Do not add that trial font to this public asset directory or deploy it.
- **All ordinary interface text:** target the ChatGPT/OpenAI Sans visual style, subject to receiving the official font kit and confirming that its terms permit BRɅIN product hosting/embedding. Do not scrape or rehost OpenAI font files from ChatGPT/CDN assets.
- **Migration safety:** Poppins is the existing/current legacy UI bundle. Keep these assets and their OFL license intact until a compliant replacement is installed, tested and released. Do not make CSS point to an unavailable font.

The canonical cross-product policy, source links, licensing notes, glyph limitation and future SVG asset path are documented in [`docs/BRVIN_BRAND_TYPOGRAPHY.md`](../../docs/BRVIN_BRAND_TYPOGRAPHY.md).