$ErrorActionPreference = "Stop"

Write-Host "Parmar AI - Phase A setup" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed. Install Node.js 22+ first."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is not installed. Install Git first."
}

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "Generating Cloudflare Worker types..." -ForegroundColor Yellow
npm run types

Write-Host "Type-checking..." -ForegroundColor Yellow
npm run check

Write-Host "Running tests..." -ForegroundColor Yellow
npm test

Write-Host "Phase A local setup completed successfully." -ForegroundColor Green
