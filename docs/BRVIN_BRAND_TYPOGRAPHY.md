# BRɅIN Brand Typography and Asset Policy

**Status:** Owner-selected direction recorded; production font assets are not yet cleared for distribution  
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

**Decision:** Do not commit, publish, serve, bundle or deploy the supplied AERUNO Trial OTF/ZIP/RAR or converted font files to the public GitHub repository, Cloudflare Pages/Workers assets, R2, GCS, a CDN or an application. Do not treat the archive's one-line MIT text as a sufficient license grant. The product and logo are commercial brand use, so the personal-use trial is not appropriate.

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

### Fallback while authorization is pending

- Preserve the currently deployed Poppins WOFF2 files under `public/owner-fonts/admin/intelligence-fonts/`; they are distributed under the SIL Open Font License 1.1 and may still be referenced by the existing Owner UI.
- Treat the current CSS alias `BRɅIN universal font` (Poppins) as the **legacy/current deployed UI font**, not the new long-term typography decision.
- Do not delete, rename or replace the Poppins files until the UI font migration is implemented, tested and released.
- For new UI work before OpenAI Sans is authorized, use an approved open-license sans-serif fallback such as Inter, with system sans-serif fallbacks. This is a temporary visual substitute, not a claim that Inter is the exact ChatGPT font.
- Preserve script coverage. Where OpenAI Sans or the selected Latin fallback does not contain a user's writing system, provide a deliberate compatible script font fallback instead of relying on accidental browser fallback.

A suggested future CSS stack, only after licensed OpenAI Sans files are installed, is:

```css
font-family: "OpenAI Sans", Inter, ui-sans-serif, system-ui, -apple-system,
  BlinkMacSystemFont, "Segoe UI", sans-serif;
```

The CSS declaration alone does not provide the font. The authorized font files must be present and loaded; verify the browser's rendered font rather than assuming the first family won.

## 4. Existing font asset inventory

The repository currently contains:

- `public/owner-fonts/admin/intelligence-fonts/brain-universal-*.woff2`
- Latin, Latin Extended and Devanagari subsets
- Weights 300, 400, 500, 600 and 700
- `public/owner-fonts/OFL.txt` — SIL Open Font License 1.1
- `public/owner-fonts/README.md` — existing Poppins attribution and CSS alias record

Those Poppins assets were previously named **BRɅIN universal font** as a product CSS-family alias. Preserve their upstream Poppins attribution and OFL text. The new role split in this document supersedes any interpretation that the logo and every future interface surface must use the same typeface.

## 5. Future implementation rules

1. Logo rendering uses the approved static BRɅIN vector wordmark; do not render the logo as ordinary body text.
2. All normal UI text uses the approved ChatGPT-inspired UI family consistently, with documented script fallbacks.
3. Keep font files, licenses and attribution together. Never strip copyright metadata or rename the upstream internal font family to disguise provenance.
4. Do not put personal-use trial fonts or proprietary fonts without hosting/embedding rights in public assets, Cloudflare, GCS or application bundles.
5. A static logo SVG and a distributable web/app font are different asset classes and require different license checks.
6. Any font migration must check font loading, fallback behavior, weights, language coverage, visual layout, accessibility, performance and both light/dark themes.
7. Do not change student prompts, quotas, retrieval behavior, APIs, D1, Vertex or other backend contracts as part of a typography-only change.

## 6. Current completion status

- [x] Uploaded archive inspected and internal font family identified as AERUNO Trial.
- [x] Licensing conflict recorded; public/commercial deployment blocked pending proper license.
- [x] Missing U+0245 (`Ʌ`) glyph recorded.
- [x] Owner's role split recorded: AERUNO-style logo; ChatGPT/OpenAI Sans-style ordinary UI typography.
- [ ] Obtain an AERUNO license covering BRɅIN logo/brand identity use.
- [ ] Obtain official OpenAI Sans files and verify BRɅIN is authorized to use/self-host them, or select an explicitly approved alternative.
- [ ] Produce and visually approve the outlined BRɅIN SVG wordmark.
- [ ] Migrate product UI typography from legacy Poppins only after the authorized font files and implementation are ready.
- [ ] Verify all product surfaces and deployed assets.

**No production font binary was uploaded or deployed as part of this documentation update.**
