# Offline Founder Reports

The `reports/` utilities convert approved admin JSON exports into local founder/operations charts and summaries.

## Intended use
Authorized internal review only. This tooling is not part of the production request path.

## Data handling
Exports may contain student identifiers, question text, timestamps, AI usage, spend, and learning analytics. Treat them as confidential operational material. Do not publish, redistribute, upload to unrelated services, or use as training/evaluation data without written authorization.

## Usage
```bash
pip install -r reports/requirements.txt
python reports/generate_report.py exported-report.json --output-dir report-output
```

## Secrets
Reports must never contain Telegram tokens, webhook secrets, Google private keys, Cloudflare credentials, or admin passwords.

## License
The reporting source is subject to [LICENSE](../LICENSE), except for third-party components governed by their own licenses.