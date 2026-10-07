# Offline Founder & Operations Reports

**Classification: Proprietary internal tooling**

The reports/ directory contains the optional offline reporting utility used to transform an exported admin analytics JSON snapshot into founder and operations reporting artifacts.

The tool is intentionally outside the production Cloudflare request path.

## Input

The Admin Control Center can export an analytics snapshot as JSON.

That exported file may contain operational and student-level information. Treat it as confidential.

## Local usage

From the repository root:

~~~text
pip install -r reports/requirements.txt
python reports/generate_report.py exported-report.json --output-dir report-output
~~~

Generated output may include:

- executive PDF output
- CSV summaries
- PNG charts
- Markdown summary output

## Handling rules

Do not commit exported production reports unless they have been fully sanitized and the project owner has expressly approved publication.

Never publish:

- real student names
- Telegram IDs
- private questions
- raw usage exports
- production logs
- private cost or accounting data

## Intellectual property

The reporting logic, templates, presentation structure, and project-specific analysis are proprietary Parmar AI materials.

See ../LICENSE and ../TRADEMARKS.md.
