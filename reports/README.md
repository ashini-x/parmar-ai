# Offline Founder Reports

The production Worker exports a JSON analytics snapshot with students, AI usage, costs, learning and system context from `/admin/api/export`. The optional local report tool turns that snapshot into founder-friendly charts and a PDF/CSV/Markdown pack.

## Usage

```bash
pip install -r reports/requirements.txt
python reports/generate_report.py exported-report.json --output-dir report-output
```

The generated directory contains a PDF executive report, CSV daily AI summary, PNG token/spend charts, and a Markdown summary.

This tooling never runs inside Cloudflare Workers and has no access to production secrets unless an administrator explicitly provides an exported report file.
