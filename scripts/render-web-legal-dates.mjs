import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "long",
  year: "numeric"
});

for (const file of ["web/privacy.html", "web/terms.html"]) {
  const committedAt = execFileSync(
    "git",
    ["log", "-1", "--format=%cI", "--", file],
    { encoding: "utf8" }
  ).trim();

  if (!committedAt) {
    throw new Error(`Could not find the last change date for ${file}.`);
  }

  const date = `${formatter.format(new Date(committedAt))} (IST)`;
  const html = readFileSync(file, "utf8");
  const matches = html.match(/Effective date: [^<]+/g) ?? [];

  if (matches.length !== 1) {
    throw new Error(`Expected one effective-date label in ${file}; found ${matches.length}.`);
  }

  const updated = html.replace(/Effective date: [^<]+/, `Effective date: ${date}.`);
  writeFileSync(file, updated);
  process.stdout.write(`${file}: ${date}\n`);
}
