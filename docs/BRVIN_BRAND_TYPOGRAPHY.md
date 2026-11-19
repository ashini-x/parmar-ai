# BRɅIN Brand Typography and Asset Policy

**Status:** Poppins removed from Owner runtime; outlined AERUNO-style wordmark now implemented only inside authenticated Owner Intelligence; actual OpenAI Sans font assets remain pending  
**Last updated:** 2026-11-20 IST  
**Canonical repository:** `ashini-x/parmar-ai`  
**Applies to:** BRɅIN brand identity and product UI, including Owner Gemini Intelligence and BRVIN Teachers

This is the source of truth for future logo, font, UI typography and asset decisions. Read it before changing typography or adding brand font files to GitHub, Cloudflare or another asset host.

## 1. Owner-approved direction

The typography system has two separate roles:

1. **BRɅIN wordmark/logo:** AERUNO is the requested display typeface direction. It is for the logo only, not paragraphs, controls, navigation or other UI text.
2. **All normal product text and interface typography:** target the OpenAI Sans appearance used by the ChatGPT/OpenAI desktop-web experience. Use it consistently for headings, body copy, navigation, buttons, labels, composer text and other ordinary UI copy, subject to obtaining an authorized font kit/use permission. It is not the BRɅIN logo font.

Do not mix the logo font into ordinary product copy. Do not apply the UI font to the wordmark as a substitute for the selected logo treatment.

## 2. Uploaded AERUNO archive — inspected, not approved for deployment

The Owner supplied `brvin_font.rar`. Its font file is a 13,044-byte OpenType font whose internal family/style names are `AERUNO` / `AERUNO Trial`, with PostScript name `AERUNO-Trial`. Its internal copyright metadata states: `AERUNO © Tendy Triyudi Zein. 2025. All Rights Reserved`.

The archive's `license.txt` contains only the text `MIT free license.` This short text conflicts with the font's internal trial/all-rights-reserved metadata and the distributor's published terms. The distributor listing identifies this AERUNO demo as **personal use only, with no commercial use**. The full commercial family is separately offered by Omzen Type through MyFonts.

Sources:
- [AERUNO trial listing and personal-use-only terms — 1001 Fonts](https://www.1001fonts.com/aeruno-font.html)
- [AERUNO commercial family and separate Desktop, Webfont and App licensing options — MyFonts](https://www.myfonts.com/collections/aeruno-font-omzen-type)

**Decision:** The Owner has clarified that the immediate workspace is private and Owner-only. However, the trial's published terms expressly classify logos and company apps as commercial use, and separately restrict publication/distribution of the font. A private login does not by itself grant a broader company-logo or redistribution right. Do not upload the trial binary to the public GitHub repository or shared Cloudflare asset pipeline. Revisit AERUNO once the Owner obtains the full family or written permission covering the intended internal/company wordmark use and the missing `Ʌ` glyph.

Before using AERUNO for the BRɅIN identity, obtain the full font and a written/purchased license whose terms cover the intended company logo/brand identity use. The MyFonts listing distinguishes Desktop logo/brand-identity use from Webfont and App embedding; choose the license based on the actual use and read the applicable EULA. Do not assume a Desktop license also permits hosting or embedding the font.

### Glyph coverage limitation

The supplied AERUNO Trial font does not contain Unicode U+0245 (`Ʌ`). It contains the ordinary Latin letters in `BRɅIN`, but not the special `Ʌ` character used in the BRɅIN brand spelling. A final vector wordmark therefore needs either a properly licensed font/version that includes the required glyph or a separately designed custom vector `Ʌ`. Do not silently replace `Ʌ` with an ordinary `A`.

### Correct asset strategy after licensing

For the logo-only use case, prefer a **static vector wordmark with text converted to outlines**, rather than shipping the underlying font file. The intended public asset location is:

- `public/brand/brain-wordmark.svg` — canonical outline wordmark
- Optional light/dark variants only if the final design genuinely requires separate artwork.

This allows the finished logo artwork to be reused across web/app surfaces without distributing the source font. Keep the licensed source font with the authorized design workstation/license holder. If a product later needs to render arbitrary live text in AERUNO, obtain the specific Webfont/App license before embedding it.

## 3. Normal UI typography — OpenAI Sans target

OpenAI's official brand guidelines identify **OpenAI Sans** as its typeface and direct users to its full design-guidelines portal for access. The current ChatGPT/OpenAI desktop-web visual direction should therefore be treated as the reference for BRɅIN's ordinary UI typography.

Sources:
- [Official OpenAI Design Guidelines — Typography](https://openai.com/brand/)
- [OpenAI full design-guidelines access portal](https://brand.openai.com/)

OpenAI Sans is a proprietary brand typeface, not an open-source font that BRɅIN may automatically copy from the ChatGPT app, browser cache or OpenAI CDN. Before bundling or self-hosting it, obtain it through the official access route and confirm the grant/terms explicitly permit BRɅIN's intended product use, distribution and hosting.

**Implementation gate:** do not download/extract/rehost OpenAI Sans from a live ChatGPT client, inspect or copy its private asset URLs, or commit unofficial font binaries. Once authorized files and terms are available, self-host only the permitted font files and weights in the approved product asset pipeline.

### Current runtime typography while authorized font files are unavailable

- The previous Poppins WOFF2 bundle, its OFL/readme files, the Owner page's font preloads and its `@font-face` rules are removed by the typography-removal change.
- The Owner page now uses the stack `"OpenAI Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. This is **OpenAI Sans-first**, but until the official font package is obtained and authorized, browsers use their platform system-font fallback. Do not describe the fallback as the actual OpenAI Sans file.
- This is consistent with OpenAI's published guidance for ChatGPT-integrated UI surfaces, which recommends platform-native system fonts rather than custom fonts. A self-hosted OpenAI Sans package must still come through the official access route with confirmed rights for the target product.
- The authenticated Owner Intelligence page now renders the BRɅIN wordmark and sidebar monogram as SVG outlines derived locally from the supplied AERUNO Trial. The font file itself is not shipped, bundled, served, stored in Cloudflare assets or committed. The trial has no U+0245 (`Ʌ`) glyph; for the private Owner-only wordmark, its angular crossbar-free uppercase A outline is intentionally mapped to the brand's `Ʌ`. This treatment is restricted to the protected `/admin/intelligence` page and its separately protected `/admin/intelligence.js` endpoint, both gated by `requireOwner`. Do not reuse this artwork in public marketing, public website logos or BRVIN Teachers without separately reviewing the applicable font-use terms.

## 4. Current font asset inventory

The Core Worker no longer has an `assets.directory` binding for the removed `public/owner-fonts` bundle. There are no Poppins font binaries or Poppins `@font-face` declarations in the Owner HTML after this change. Future font assets must be deliberately added only after the font-use and hosting permissions are verified.

The repository previously used a Poppins CSS alias called **BRɅIN universal font**. That legacy alias and its font files are removed; do not recreate them.

## 5. Future implementation rules

1. Logo rendering uses the approved static BRɅIN vector wordmark; do not render the logo as ordinary body text.
2. All normal UI text uses the approved ChatGPT-inspired UI family consistently, with documented script fallbacks.
3. Keep font files, licenses and attribution together. Never strip copyright metadata or rename the upstream internal font family to disguise provenance.
4. Do not put personal-use trial fonts or proprietary fonts without hosting/embedding rights in public assets, Cloudflare, GCS or application bundles.
5. A static logo SVG and a distributable web/app font are different asset classes and require different license checks.
6. Any font migration must check font loading, fallback behavior, weights, language coverage, visual layout, accessibility, performance and both light/dark themes.
7. Do not change student prompts, quotas, retrieval behavior, APIs, D1, Vertex or other backend contracts as part of a typography-only change.

## 6. Current completion status

### Production typography-removal release — 2026-11-20 IST

- PR [#374](https://github.com/ashini-x/parmar-ai/pull/374) merged to `main` as `45bdc5a8f48ad57f360e4340ff1d6216845a8b5a`.
- GitHub Actions Release Validation run [#44610099216](https://github.com/ashini-x/parmar-ai/actions/runs/44610099216) passed typecheck, full tests, Node tests, private BRVIN service dry-run, Parmar AI Worker dry-run and isolated website Worker dry-run.
- The production deploy job passed. Root and `/health` smoke checks passed; BRVIN service binding and Fatman retrieval acceptance passed.
- Production `parmar-ai`: version `7a1c632b-d9c5-4fa2-9535-e0afb0e21b8f`, deployment `10460485-b57a-4857-97b0-350bcd3e0522`, 100% traffic.
- Production `brvin-service`: version `56a88525-e1b5-45f7-abfb-b65faa8b0d57`, deployment `c3d67fc7-a659-4722-9163-8f5692ae1a17`, 100% traffic.
- Production acceptance artifact: `14571718100`.
- This validates deployment and service health. A screenshot/visual check in the authenticated Owner browser remains outstanding.


- [x] Uploaded archive inspected and internal font family identified as AERUNO Trial.
- [x] Licensing conflict recorded; public/commercial deployment blocked pending proper license.
- [x] Missing U+0245 (`Ʌ`) glyph recorded.
- [x] Owner's role split recorded: AERUNO-style logo; ChatGPT/OpenAI Sans-style ordinary UI typography.
- [ ] Obtain AERUNO full-family or written permission covering the intended private/company wordmark use, including a usable `Ʌ` glyph or permission for a custom glyph.
- [ ] Obtain official OpenAI Sans files from the signed-in design-guidelines portal and verify the applicable product-use/hosting terms.
- [x] Generate and apply outlined AERUNO-derived BRɅIN SVG wordmark/monogram in the authenticated Owner Intelligence panel only; the angular A glyph is intentionally mapped to `Ʌ` because the trial font lacks U+0245.
- [x] Remove Poppins WOFF2 assets, OFL/readme files, preloads and Owner-page `@font-face` rules from the repository/runtime source.
- [x] Change Owner UI typography to an OpenAI Sans-first, platform-native system stack. Actual OpenAI Sans is not bundled yet; the current browser rendering uses its system fallback.
- [x] Verify the change through CI and production deployment/release acceptance.
- [ ] Visually confirm the Owner welcome wordmark and interface typography in the authenticated Owner browser.

**No AERUNO or OpenAI Sans font binary was added or deployed.**
