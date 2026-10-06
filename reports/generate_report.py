#!/usr/bin/env python3
"""Generate offline Parmar AI founder analytics from an Admin JSON export.

This script intentionally runs outside the Cloudflare Worker. It produces local
PNG charts, a PDF pack, a CSV summary, and a Markdown executive summary.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

try:
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
except ImportError as exc:
    raise SystemExit("Matplotlib is required: pip install matplotlib") from exc


def money(value: float) -> str:
    return f"${value:,.6f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("json_file")
    parser.add_argument("--output-dir", default="report-output")
    args = parser.parse_args()

    source = Path(args.json_file)
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    data = json.loads(source.read_text(encoding="utf-8"))

    daily = data.get("daily", [])
    days = [row.get("day", "") for row in daily]
    spend = [float(row.get("spendUsd", 0)) for row in daily]
    tokens = [int(row.get("totalTokens", 0)) for row in daily]

    overview = data.get("overview", {}) if isinstance(data.get("overview", {}), dict) else {}
    metrics = overview.get("metrics", {}) if isinstance(overview.get("metrics", {}), dict) else {}
    usage = overview.get("usage", {}) if isinstance(overview.get("usage", {}), dict) else {}

    # CSV summary is deliberately simple so it can be opened in Excel/Sheets.
    with (out / "daily_ai_summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["india_date", "total_tokens", "estimated_spend_usd"])
        for row in daily:
            writer.writerow([row.get("day", ""), row.get("totalTokens", 0), row.get("spendUsd", 0)])

    generated_charts: list[Path] = []
    if daily:
        fig = plt.figure(figsize=(10, 5))
        plt.plot(days, spend, marker="o")
        plt.title("Parmar AI — Estimated AI spend")
        plt.xlabel("India date")
        plt.ylabel("USD")
        plt.xticks(rotation=45, ha="right")
        plt.tight_layout()
        path = out / "ai_spend.png"
        fig.savefig(path, dpi=150)
        generated_charts.append(path)
        plt.close(fig)

        fig = plt.figure(figsize=(10, 5))
        plt.plot(days, tokens, marker="o")
        plt.title("Parmar AI — Total AI tokens")
        plt.xlabel("India date")
        plt.ylabel("Tokens")
        plt.xticks(rotation=45, ha="right")
        plt.tight_layout()
        path = out / "ai_tokens.png"
        fig.savefig(path, dpi=150)
        generated_charts.append(path)
        plt.close(fig)

    # Create a simple PDF pack from the generated PNG charts plus an executive page.
    with PdfPages(out / "parmar-ai-founder-report.pdf") as pdf:
        fig = plt.figure(figsize=(11, 8.5))
        fig.text(0.08, 0.90, "Parmar AI — Founder Analytics Report", fontsize=20, weight="bold")
        fig.text(0.08, 0.84, f"Report window: {data.get('days', 'unknown')} days", fontsize=12)
        fig.text(0.08, 0.78, f"Students: {metrics.get('totalStudents', 0):,}", fontsize=12)
        fig.text(0.08, 0.73, f"Questions today: {metrics.get('questionsToday', 0):,}", fontsize=12)
        fig.text(0.08, 0.68, f"Active today: {metrics.get('activeStudentsToday', 0):,}", fontsize=12)
        fig.text(0.08, 0.63, f"Tokens today: {usage.get('totalTokens', 0):,}", fontsize=12)
        fig.text(0.08, 0.58, f"Estimated AI spend today: {money(float(usage.get('spendUsd', 0)))}", fontsize=12)
        fig.text(0.08, 0.50, "Note: AI spend is an estimate derived from model usage metadata and configured pricing rates.", fontsize=10)
        fig.text(0.08, 0.43, "Google Cloud billing remains the authoritative financial source.", fontsize=10)
        pdf.savefig(fig)
        plt.close(fig)

        for chart in generated_charts:
            image = plt.imread(chart)
            fig = plt.figure(figsize=(11, 8.5))
            plt.imshow(image)
            plt.axis("off")
            pdf.savefig(fig)
            plt.close(fig)

    summary = [
        "# Parmar AI founder report",
        "",
        f"Report window: {data.get('days', 'unknown')} days",
        f"Total students: {metrics.get('totalStudents', 0)}",
        f"Questions today at export: {metrics.get('questionsToday', 0)}",
        f"Active students today: {metrics.get('activeStudentsToday', 0)}",
        f"Total tokens today: {usage.get('totalTokens', 0)}",
        f"Estimated AI spend today: {money(float(usage.get('spendUsd', 0)))}",
        f"Average cost per model attempt: {money(float(usage.get('averageCostUsd', 0)))}",
        "",
        "Generated files:",
        "- parmar-ai-founder-report.pdf",
        "- daily_ai_summary.csv",
        "- ai_spend.png (when daily data exists)",
        "- ai_tokens.png (when daily data exists)",
    ]
    (out / "SUMMARY.md").write_text("\n".join(summary), encoding="utf-8")


if __name__ == "__main__":
    main()
