export function brvinLandingPage(): Response {
  const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7f7f5">
  <meta name="description" content="BRɅIN is a private, source-aware knowledge platform for turning documents into usable knowledge across trusted applications.">
  <title>BRɅIN — Knowledge, with its sources intact</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f7f7f5;
      --surface: #ffffff;
      --ink: #111111;
      --muted: #686a6d;
      --soft: #ececea;
      --line: #dededb;
      --dark: #121313;
      --dark-soft: #1b1d1d;
      --signal: #b9f36a;
      --green: #236d43;
      --radius: 23px;
      --content: 1240px;
      font-family: Inter, "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; scroll-padding-top: 92px; }
    body { margin: 0; background: var(--paper); color: var(--ink); }
    a { color: inherit; text-decoration: none; }
    button, a { -webkit-tap-highlight-color: transparent; }
    a:focus-visible, summary:focus-visible { outline: 3px solid #6aa84f; outline-offset: 4px; }
    .shell { width: min(var(--content), calc(100% - 64px)); margin-inline: auto; }
    .announcement { min-height: 36px; display: flex; align-items: center; justify-content: center; padding: 7px 16px; background: #171818; color: #f5f5f1; text-align: center; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
    .announcement span { color: var(--signal); margin-right: 9px; }
    .header { position: sticky; top: 0; z-index: 20; background: rgba(247,247,245,.91); border-bottom: 1px solid rgba(20,20,20,.08); backdrop-filter: blur(18px); }
    .header-inner { min-height: 78px; display: flex; align-items: center; justify-content: space-between; gap: 26px; }
    .brand { display: inline-flex; align-items: center; gap: 10px; font-size: 21px; font-weight: 760; letter-spacing: -.075em; white-space: nowrap; }
    .brand-mark { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 8px; background: var(--ink); color: white; font-size: 16px; letter-spacing: -.08em; }
    .brand-word { letter-spacing: -.075em; }
    .nav { display: flex; align-items: center; justify-content: center; gap: clamp(17px, 2.5vw, 34px); color: #383a3a; font-size: 13px; }
    .nav a, .footer-links a { transition: opacity .18s ease; }
    .nav a:hover, .footer-links a:hover { opacity: .58; }
    .header-actions { display: flex; align-items: center; gap: 18px; font-size: 13px; }
    .login-link { color: #4e5050; }
    .button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 0 19px; border: 1px solid var(--ink); border-radius: 999px; background: var(--ink); color: white; font-size: 13px; font-weight: 650; transition: transform .18s ease, background .18s ease, color .18s ease; }
    .button:hover { transform: translateY(-2px); background: #303232; }
    .button.light { background: white; color: var(--ink); border-color: #d2d2ce; }
    .button.light:hover { background: #f1f1ee; }
    .button .arrow { font-size: 16px; line-height: 1; }
    .mobile-menu { display: none; position: relative; }
    .mobile-menu summary { list-style: none; cursor: pointer; display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--line); border-radius: 50%; }
    .mobile-menu summary::-webkit-details-marker { display: none; }
    .mobile-menu .menu-panel { position: absolute; top: 52px; right: 0; width: 220px; padding: 12px; border: 1px solid var(--line); border-radius: 16px; background: white; box-shadow: 0 15px 40px rgba(0,0,0,.10); }
    .mobile-menu .menu-panel a { display: block; padding: 12px; font-size: 14px; border-radius: 9px; }
    .mobile-menu .menu-panel a:hover { background: var(--paper); }
    .hero { padding: 93px 0 72px; overflow: hidden; }
    .hero-grid { display: grid; grid-template-columns: minmax(0,.9fr) minmax(430px,1.1fr); gap: 55px; align-items: center; }
    .trust-badge { display: inline-flex; align-items: center; gap: 9px; min-height: 34px; padding: 5px 12px 5px 7px; border: 1px solid #cfd7c8; border-radius: 999px; background: #f0f4eb; color: #2d513a; font-size: 10px; font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
    .trust-icon { width: 23px; height: 23px; display: grid; place-items: center; border-radius: 50%; background: #d9edca; color: #28633f; }
    .trust-badge svg { width: 13px; height: 13px; }
    h1 { max-width: 670px; margin: 26px 0 21px; font-size: clamp(50px, 6.1vw, 82px); font-weight: 560; line-height: .99; letter-spacing: -.075em; }
    .hero-copy { max-width: 535px; color: #5e6061; font-size: 17px; line-height: 1.62; letter-spacing: -.018em; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 11px; margin-top: 30px; }
    .hero-note { margin-top: 23px; color: #838583; font-size: 11px; letter-spacing: .02em; }
    .hero-visual { position: relative; min-width: 0; }
    .glow { position: absolute; z-index: 0; inset: 4% -9% -5% 10%; border-radius: 42%; background: radial-gradient(ellipse, rgba(192,218,166,.55), rgba(219,224,211,.18) 46%, transparent 72%); filter: blur(24px); }
    .workspace { position: relative; z-index: 1; overflow: hidden; border: 1px solid #3b3d3c; border-radius: 21px; background: var(--dark); color: #f5f5ef; box-shadow: 0 34px 80px rgba(25,26,23,.18); transform: perspective(1200px) rotateY(-3deg) rotateX(1deg); }
    .workspace-top { height: 53px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid #303332; }
    .window-dots { display: flex; gap: 6px; }
    .window-dots i { width: 7px; height: 7px; display: block; border-radius: 50%; background: #555957; }
    .workspace-title { color: #c8cbc4; font-size: 11px; letter-spacing: .02em; }
    .workspace-status { color: #b9f36a; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
    .workspace-body { display: grid; grid-template-columns: 145px 1fr; min-height: 362px; }
    .workspace-side { padding: 18px 12px; border-right: 1px solid #303332; background: #171919; }
    .side-label { margin: 0 0 12px 8px; color: #757b75; font-size: 9px; letter-spacing: .13em; text-transform: uppercase; }
    .side-item { display: flex; align-items: center; gap: 8px; padding: 10px 9px; margin: 3px 0; border-radius: 8px; color: #b7bcb5; font-size: 10px; }
    .side-item.active { background: #2a2e2a; color: #f4f5ef; }
    .side-symbol { width: 14px; text-align: center; color: #a4b88e; }
    .side-divider { height: 1px; margin: 16px 4px; background: #303332; }
    .workspace-main { padding: 22px 21px 18px; }
    .workspace-kicker { color: #999f96; font-size: 9px; letter-spacing: .13em; text-transform: uppercase; }
    .workspace-heading { margin: 9px 0 17px; font-size: 20px; font-weight: 540; letter-spacing: -.04em; }
    .search-field { min-height: 43px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 1px solid #454a45; border-radius: 9px; background: #1d201e; color: #aeb4ab; font-size: 10px; }
    .search-field .key { margin-left: auto; padding: 3px 6px; border: 1px solid #454a45; border-radius: 5px; color: #7f867e; }
    .answer-card { margin-top: 15px; padding: 15px; border: 1px solid #3b4338; border-radius: 12px; background: linear-gradient(140deg,#202820,#1b201d 75%); }
    .answer-label { display: flex; justify-content: space-between; align-items: center; color: #b8d7a0; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
    .answer-card h3 { margin: 14px 0 7px; font-size: 14px; font-weight: 600; letter-spacing: -.02em; }
    .answer-card p { max-width: 440px; margin: 0; color: #c3c8bf; font-size: 10px; line-height: 1.65; }
    .source-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
    .source-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid #455141; border-radius: 6px; color: #d8e8cc; font-size: 9px; }
    .source-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--signal); }
    .workspace-bottom { display: flex; justify-content: space-between; gap: 15px; margin-top: 16px; color: #81877e; font-size: 9px; }
    .mini-metric { position: absolute; right: -22px; bottom: -24px; display: flex; align-items: center; gap: 11px; padding: 12px 15px; border: 1px solid #e2e2dc; border-radius: 13px; background: white; box-shadow: 0 14px 38px rgba(0,0,0,.10); color: #1a1b19; }
    .mini-check { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; background: #eaf4e1; color: #316a3f; font-size: 14px; }
    .mini-metric strong { display: block; font-size: 11px; }
    .mini-metric span { display: block; margin-top: 3px; color: #767a74; font-size: 9px; }
    .audience { padding: 28px 0 34px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .audience-inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 18px; }
    .audience-label { color: #777a75; font-size: 10px; font-weight: 760; letter-spacing: .14em; text-transform: uppercase; }
    .audience-list { display: flex; flex-wrap: wrap; gap: 12px; color: #41433f; font-size: 14px; }
    .audience-list span { padding: 8px 13px; border: 1px solid #d9d9d4; border-radius: 999px; background: rgba(255,255,255,.45); }
    .section { padding: 112px 0; }
    .section-head { max-width: 720px; margin-bottom: 44px; }
    .eyebrow { margin-bottom: 16px; color: #737770; font-size: 10px; font-weight: 750; letter-spacing: .15em; text-transform: uppercase; }
    h2 { margin: 0; font-size: clamp(37px, 4.4vw, 58px); font-weight: 550; line-height: 1.04; letter-spacing: -.065em; }
    .section-intro { max-width: 650px; margin: 18px 0 0; color: var(--muted); font-size: 16px; line-height: 1.65; }
    .platform-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 13px; }
    .platform-card { min-height: 288px; padding: 25px; border: 1px solid #deded9; border-radius: var(--radius); background: #fff; }
    .platform-icon { width: 39px; height: 39px; display: grid; place-items: center; margin-bottom: 52px; border-radius: 12px; background: #f0f1ed; color: #20221f; }
    .platform-icon svg { width: 18px; height: 18px; }
    .platform-card h3 { margin: 0 0 10px; font-size: 21px; font-weight: 570; letter-spacing: -.045em; }
    .platform-card p { margin: 0; color: #6e706c; font-size: 13px; line-height: 1.7; }
    .split { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 76px; }
    .split.reverse .split-copy { order: 2; }
    .split.reverse .split-visual { order: 1; }
    .split-copy h2 { max-width: 530px; }
    .split-copy p { max-width: 500px; margin: 19px 0 0; color: var(--muted); font-size: 15px; line-height: 1.7; }
    .feature-list { display: grid; gap: 14px; margin-top: 27px; }
    .feature-line { display: flex; align-items: flex-start; gap: 12px; color: #3e413d; font-size: 13px; line-height: 1.5; }
    .feature-line b { font-weight: 650; }
    .feature-tick { flex: 0 0 19px; width: 19px; height: 19px; display: grid; place-items: center; border-radius: 50%; background: #e8f0e1; color: #32683e; font-size: 11px; }
    .visual-card { overflow: hidden; min-height: 375px; padding: 25px; border: 1px solid #e1e1dc; border-radius: 22px; background: #efefeb; }
    .visual-card.dark { border-color: #303330; background: #151716; color: white; }
    .visual-top { display: flex; justify-content: space-between; align-items: center; color: #7b7f77; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
    .visual-card.dark .visual-top { color: #92988f; }
    .visual-stack { display: grid; gap: 10px; margin-top: 28px; }
    .doc-row { display: grid; grid-template-columns: 35px minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 13px; border: 1px solid #deded8; border-radius: 12px; background: white; }
    .doc-icon { width: 34px; height: 38px; display: grid; place-items: center; border: 1px solid #e6e6e1; border-radius: 8px; background: #f8f8f6; color: #555952; font-size: 9px; font-weight: 800; }
    .doc-name { font-size: 11px; font-weight: 680; }
    .doc-meta { margin-top: 4px; color: #858981; font-size: 9px; }
    .doc-state { color: #397348; font-size: 9px; font-weight: 760; }
    .stage-track { display: grid; grid-template-columns: repeat(5,1fr); gap: 6px; margin-top: 20px; }
    .stage { min-height: 53px; padding: 10px 8px; border-radius: 8px; background: #e3e5df; color: #686d63; font-size: 8px; line-height: 1.4; }
    .stage.done { background: #dcebd3; color: #2b6339; }
    .stage strong { display: block; margin-bottom: 4px; font-size: 9px; }
    .retrieval-card { padding: 21px; border: 1px solid #353a35; border-radius: 14px; background: #1c201c; }
    .retrieval-query { padding: 13px 14px; border: 1px solid #3a4239; border-radius: 9px; background: #141714; color: #d6d9d1; font-size: 11px; }
    .retrieval-results { display: grid; gap: 8px; margin-top: 13px; }
    .result { padding: 12px; border: 1px solid #353d34; border-radius: 9px; background: #232923; }
    .result small { display: block; color: #b9e09d; font-size: 8px; letter-spacing: .12em; text-transform: uppercase; }
    .result strong { display: block; margin-top: 6px; color: #f1f2ec; font-size: 11px; font-weight: 600; }
    .result p { margin: 5px 0 0; color: #aeb5aa; font-size: 9px; line-height: 1.5; }
    .app-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; margin-top: 18px; }
    .app-card { padding: 17px; border: 1px solid #e0e0da; border-radius: 13px; background: #fff; }
    .app-card span { color: #777c73; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; }
    .app-card strong { display: block; margin-top: 7px; font-size: 15px; font-weight: 620; }
    .trust-section { padding: 100px 0; background: var(--dark); color: #f3f4ee; }
    .trust-grid { display: grid; grid-template-columns: .92fr 1.08fr; gap: 80px; align-items: start; }
    .trust-section .eyebrow { color: #a6b69a; }
    .trust-section h2 { max-width: 500px; }
    .trust-section .section-intro { color: #a6aaa2; }
    .trust-mark { display: inline-flex; align-items: center; gap: 10px; margin-top: 27px; padding: 9px 14px 9px 9px; border: 1px solid #465543; border-radius: 999px; background: #1e281f; color: #d4e9c8; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .trust-mark-icon { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 50%; background: var(--signal); color: #20311d; }
    .trust-mark-icon svg { width: 15px; height: 15px; }
    .trust-points { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; overflow: hidden; border: 1px solid #373b36; border-radius: 18px; background: #373b36; }
    .trust-point { min-height: 178px; padding: 23px; background: #171a18; }
    .trust-point svg { width: 21px; height: 21px; color: #c5e6a9; }
    .trust-point h3 { margin: 24px 0 8px; font-size: 16px; font-weight: 590; letter-spacing: -.03em; }
    .trust-point p { margin: 0; color: #a3aaa0; font-size: 11px; line-height: 1.6; }
    .trust-disclaimer { max-width: 600px; margin-top: 18px; color: #777e74; font-size: 9px; line-height: 1.5; }
    .developer { display: grid; grid-template-columns: .9fr 1.1fr; align-items: center; gap: 70px; }
    .code-panel { overflow: hidden; border: 1px solid #303431; border-radius: 18px; background: #151817; color: #e8ece4; box-shadow: 0 24px 60px rgba(0,0,0,.10); }
    .code-top { display: flex; justify-content: space-between; padding: 15px 19px; border-bottom: 1px solid #303431; color: #929990; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; }
    .code-panel pre { overflow-x: auto; margin: 0; padding: 24px; color: #d4e2cb; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.9; }
    .code-panel .comment { color: #818b7a; }
    .code-panel .key { color: #c2e6a9; }
    .code-note { margin: 0; padding: 0 24px 20px; color: #8d958a; font-size: 9px; line-height: 1.5; }
    .developer-notes { display: grid; gap: 12px; margin-top: 26px; }
    .developer-note { display: flex; gap: 11px; align-items: flex-start; color: #4d504b; font-size: 12px; line-height: 1.55; }
    .developer-note .feature-tick { margin-top: 1px; }
    .closing { padding: 95px 0 105px; text-align: center; }
    .closing h2 { max-width: 780px; margin: 0 auto; }
    .closing p { max-width: 540px; margin: 19px auto 27px; color: var(--muted); font-size: 15px; line-height: 1.7; }
    .footer { padding: 42px 0 28px; border-top: 1px solid var(--line); }
    .footer-top { display: flex; justify-content: space-between; gap: 40px; padding-bottom: 45px; }
    .footer-brand p { max-width: 300px; color: #737770; font-size: 12px; line-height: 1.6; }
    .footer-columns { display: flex; flex-wrap: wrap; gap: clamp(38px,7vw,95px); }
    .footer-column strong { display: block; margin-bottom: 15px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
    .footer-links { display: grid; gap: 11px; color: #737770; font-size: 11px; }
    .footer-bottom { display: flex; justify-content: space-between; gap: 18px; padding-top: 20px; border-top: 1px solid var(--line); color: #858880; font-size: 10px; }
    @media (max-width: 1050px) {
      .hero-grid { grid-template-columns: 1fr; gap: 55px; }
      .hero-copy { max-width: 680px; }
      .hero-visual { width: min(750px,100%); margin: 0 auto; }
      .split, .developer, .trust-grid { gap: 42px; }
      .workspace { transform: none; }
    }
    @media (max-width: 760px) {
      .shell { width: min(var(--content), calc(100% - 38px)); }
      .header-inner { min-height: 68px; }
      .nav, .header-actions .login-link { display: none; }
      .mobile-menu { display: block; }
      .header-actions { gap: 10px; }
      .header-actions .button { min-height: 39px; padding: 0 14px; font-size: 11px; }
      .hero { padding: 65px 0 54px; }
      h1 { font-size: clamp(47px, 12vw, 68px); }
      .hero-copy { font-size: 15px; }
      .workspace-body { grid-template-columns: 1fr; }
      .workspace-side { display: none; }
      .workspace-main { padding: 19px 16px 17px; }
      .workspace-heading { font-size: 17px; }
      .mini-metric { right: 9px; bottom: -25px; }
      .audience-inner { align-items: flex-start; flex-direction: column; }
      .section { padding: 78px 0; }
      .platform-grid { grid-template-columns: 1fr; }
      .platform-card { min-height: 220px; }
      .platform-icon { margin-bottom: 31px; }
      .split, .developer, .trust-grid { grid-template-columns: 1fr; gap: 32px; }
      .split.reverse .split-copy, .split.reverse .split-visual { order: initial; }
      .visual-card { min-height: 320px; padding: 18px; }
      .stage-track { grid-template-columns: repeat(3,1fr); }
      .trust-section { padding: 77px 0; }
      .trust-points { grid-template-columns: 1fr; }
      .trust-point { min-height: 145px; }
      .closing { padding: 75px 0 80px; }
      .footer-top { flex-direction: column; }
      .footer-columns { gap: 35px; }
      .footer-bottom { flex-direction: column; }
    }
    @media (max-width: 420px) {
      .brand { font-size: 19px; }
      .announcement { font-size: 9px; }
      .hero-actions { align-items: stretch; flex-direction: column; }
      .hero-actions .button { width: 100%; }
      .workspace-top { padding-inline: 13px; }
      .workspace-title { font-size: 9px; }
      .workspace-bottom { flex-direction: column; gap: 6px; }
      .app-grid { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <div class="announcement"><span>●</span> A private knowledge layer for applications that need evidence</div>
  <header class="header">
    <div class="shell header-inner">
      <a class="brand" href="/brvin" aria-label="BRɅIN home"><span class="brand-mark">Ʌ</span><span class="brand-word">BRɅIN</span></a>
      <nav class="nav" aria-label="Main navigation">
        <a href="#platform">Platform</a>
        <a href="#capabilities">Capabilities</a>
        <a href="#trust">Trust</a>
        <a href="#developers">Developers</a>
      </nav>
      <div class="header-actions">
        <a class="login-link" href="/admin/login">Sign in</a>
        <a class="button" href="/admin/brvin">Open console <span class="arrow">↗</span></a>
        <details class="mobile-menu">
          <summary aria-label="Open navigation menu"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h14M3 10h14M3 14h14"/></svg></summary>
          <div class="menu-panel">
            <a href="#platform">Platform</a><a href="#capabilities">Capabilities</a><a href="#trust">Trust</a><a href="#developers">Developers</a><a href="/admin/login">Sign in</a>
          </div>
        </details>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="shell hero-grid">
        <div>
          <div class="trust-badge"><span class="trust-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 2.3 16 4.6v4.8c0 4-2.5 6.8-6 8.3-3.5-1.5-6-4.3-6-8.3V4.6l6-2.3Z"/><path d="m7 9.8 2 2 4-4.2"/></svg></span> Trust-centred knowledge infrastructure</div>
          <h1>Knowledge, with its sources intact.</h1>
          <p class="hero-copy">Turn documents into a private knowledge layer your applications can use, with clear source provenance and access controls built into the retrieval path.</p>
          <div class="hero-actions">
            <a class="button" href="#platform">Explore the platform <span class="arrow">↗</span></a>
            <a class="button light" href="/admin/brvin">Open BRɅIN console</a>
          </div>
          <div class="hero-note">For educators, institutions and teams building knowledge-powered applications.</div>
        </div>

        <div class="hero-visual" aria-label="Illustrative BRɅIN knowledge workspace preview">
          <div class="glow"></div>
          <div class="workspace">
            <div class="workspace-top">
              <div class="window-dots"><i></i><i></i><i></i></div>
              <div class="workspace-title">BRɅIN / Knowledge workspace</div>
              <div class="workspace-status">● Connected</div>
            </div>
            <div class="workspace-body">
              <aside class="workspace-side">
                <div class="side-label">Workspace</div>
                <div class="side-item active"><span class="side-symbol">⌂</span> Overview</div>
                <div class="side-item"><span class="side-symbol">▤</span> Projects</div>
                <div class="side-item"><span class="side-symbol">▦</span> Collections</div>
                <div class="side-item"><span class="side-symbol">▧</span> Sources</div>
                <div class="side-divider"></div>
                <div class="side-label">Manage</div>
                <div class="side-item"><span class="side-symbol">◇</span> Connections</div>
                <div class="side-item"><span class="side-symbol">⌘</span> Activity</div>
              </aside>
              <div class="workspace-main">
                <div class="workspace-kicker">Knowledge retrieval · Demo preview</div>
                <div class="workspace-heading">Ask your knowledge base</div>
                <div class="search-field"><span>⌕</span> What does Newton’s second law describe? <span class="key">↵</span></div>
                <div class="answer-card">
                  <div class="answer-label"><span>Grounded response preview</span><span>Source-linked</span></div>
                  <h3>Force, mass and acceleration</h3>
                  <p>Newton’s second law states that the net force acting on an object is equal to its mass multiplied by its acceleration. The relationship connects the change in motion to the force applied.</p>
                  <div class="source-row"><span class="source-chip"><i class="source-dot"></i> Physics notes · Page 42</span><span class="source-chip">Open source ↗</span></div>
                </div>
                <div class="workspace-bottom"><span>Illustrative interface · Sample content</span><span>Page provenance preserved</span></div>
              </div>
            </div>
          </div>
          <div class="mini-metric"><div class="mini-check">✓</div><div><strong>Source traceability</strong><span>Evidence stays connected to its page</span></div></div>
        </div>
      </div>
    </section>

    <section class="audience">
      <div class="shell audience-inner">
        <div class="audience-label">Built for knowledge-rich work</div>
        <div class="audience-list"><span>Education</span><span>Research</span><span>Institutions</span><span>AI applications</span></div>
      </div>
    </section>

    <section id="platform" class="section">
      <div class="shell">
        <div class="section-head">
          <div class="eyebrow">One connected knowledge platform</div>
          <h2>From source material to useful knowledge.</h2>
          <p class="section-intro">BRɅIN brings the knowledge lifecycle together: organise your sources, make them searchable, and connect only the applications that are allowed to use them.</p>
        </div>
        <div class="platform-grid">
          <article class="platform-card">
            <div class="platform-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4.5h9l5 5v10H5z"/><path d="M14 4.5v5h5M8 14h8M8 17h6"/></svg></div>
            <h3>Knowledge workspace</h3>
            <p>Structure knowledge by teacher, project, collection and source. Keep the original document connected to its searchable content.</p>
          </article>
          <article class="platform-card">
            <div class="platform-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4M8 10.5h5M10.5 8v5"/></svg></div>
            <h3>Private retrieval</h3>
            <p>Let connected applications discover and retrieve only the knowledge their active project grants allow them to access.</p>
          </article>
          <article class="platform-card">
            <div class="platform-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 19 6v5.5c0 4.3-2.8 7.6-7 9.5-4.2-1.9-7-5.2-7-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg></div>
            <h3>Trust & governance</h3>
            <p>Control application identity, environment status, project grants, quotas and administrative activity from one place.</p>
          </article>
        </div>
      </div>
    </section>

    <section id="capabilities" class="section" style="padding-top:20px">
      <div class="shell split">
        <div class="split-copy">
          <div class="eyebrow">Knowledge ingestion</div>
          <h2>Bring your documents into focus.</h2>
          <p>Start with the material your people already rely on. BRɅIN coordinates upload, OCR, page-aware indexing and readiness checks so source material can become a managed knowledge resource.</p>
          <div class="feature-list">
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Keep the source intact.</b> Original PDFs remain the durable reference.</span></div>
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Know where content came from.</b> Page-level provenance follows indexed content.</span></div>
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>See when it is ready.</b> Sources are gated on indexing readiness before retrieval.</span></div>
          </div>
        </div>
        <div class="split-visual">
          <div class="visual-card">
            <div class="visual-top"><span>Source processing</span><span>Page-aware workflow</span></div>
            <div class="visual-stack">
              <div class="doc-row"><div class="doc-icon">PDF</div><div><div class="doc-name">Physics reference.pdf</div><div class="doc-meta">Original source · 538 pages</div></div><div class="doc-state">SOURCE</div></div>
              <div class="doc-row"><div class="doc-icon">OCR</div><div><div class="doc-name">Text recognition</div><div class="doc-meta">Page text and layout inventory</div></div><div class="doc-state">DONE</div></div>
              <div class="doc-row"><div class="doc-icon">IDX</div><div><div class="doc-name">Search indexing</div><div class="doc-meta">Chunked with source-page links</div></div><div class="doc-state">DONE</div></div>
            </div>
            <div class="stage-track">
              <div class="stage done"><strong>01</strong>Upload</div><div class="stage done"><strong>02</strong>OCR</div><div class="stage done"><strong>03</strong>Structure</div><div class="stage done"><strong>04</strong>Index</div><div class="stage done"><strong>05</strong>Verify</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="shell split reverse">
        <div class="split-copy">
          <div class="eyebrow">Evidence-aware retrieval</div>
          <h2>Every result has a way back to its source.</h2>
          <p>Answers are only as useful as the evidence behind them. BRɅIN preserves physical PDF-page provenance in its retrieval results so your application can show where supporting material came from.</p>
          <div class="feature-list">
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Relevant context.</b> Retrieve from the knowledge sources available to the selected project.</span></div>
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Page references.</b> Keep document and page context available to the consumer app.</span></div>
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Consumer-owned answers.</b> Your application controls its model, prompts and final user experience.</span></div>
          </div>
        </div>
        <div class="split-visual">
          <div class="visual-card dark">
            <div class="visual-top"><span>Retrieval result preview</span><span>Illustrative data</span></div>
            <div class="visual-stack">
              <div class="retrieval-card">
                <div class="retrieval-query">Explain the relationship between force and acceleration.</div>
                <div class="retrieval-results">
                  <div class="result"><small>Matched passage · Physics reference</small><strong>Newton’s second law</strong><p>Net force is proportional to the rate of change of momentum and, for constant mass, equals mass multiplied by acceleration.</p></div>
                  <div class="result"><small>Provenance</small><strong>Physical PDF page 42 · Source ready</strong><p>Source identity and page reference remain attached to the retrieved passage.</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:12px">
      <div class="shell split">
        <div class="split-copy">
          <div class="eyebrow">Applications & access</div>
          <h2>One knowledge foundation. Separate application boundaries.</h2>
          <p>Connect independent applications to shared knowledge without giving them blanket access. BRɅIN verifies trusted deployment identity and checks active project grants on the retrieval path.</p>
          <div class="feature-list">
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Trusted environments.</b> Bind an application to its registered deployment identity.</span></div>
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Explicit project grants.</b> Share knowledge intentionally and revoke access when needed.</span></div>
            <div class="feature-line"><span class="feature-tick">✓</span><span><b>Independent experiences.</b> Each application keeps its own users, prompts and interface.</span></div>
          </div>
        </div>
        <div class="split-visual">
          <div class="visual-card">
            <div class="visual-top"><span>Application access map</span><span>Project-scoped</span></div>
            <div class="app-grid">
              <div class="app-card"><span>Application</span><strong>BRɅIN Teachers</strong></div>
              <div class="app-card"><span>Environment</span><strong>Production</strong></div>
              <div class="app-card"><span>Granted project</span><strong>Physics knowledge</strong></div>
              <div class="app-card"><span>Permission state</span><strong style="color:#397348">Active grant ✓</strong></div>
            </div>
            <div class="feature-line" style="margin-top:18px"><span class="feature-tick">✓</span><span>Only explicitly authorised, ready sources can be searched.</span></div>
          </div>
        </div>
      </div>
    </section>

    <section id="trust" class="trust-section">
      <div class="shell trust-grid">
        <div>
          <div class="eyebrow">Trust is part of the architecture</div>
          <h2>Access should be earned. Evidence should be visible.</h2>
          <p class="section-intro">BRɅIN is designed so permissions and source readiness are enforced by the knowledge service—not left to the interface or a search provider alone.</p>
          <div class="trust-mark"><span class="trust-mark-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 2.3 16 4.6v4.8c0 4-2.5 6.8-6 8.3-3.5-1.5-6-4.3-6-8.3V4.6l6-2.3Z"/><path d="m7 9.8 2 2 4-4.2"/></svg></span> BRɅIN trust-focused design</div>
          <p class="trust-disclaimer">This is a BRɅIN product-design badge, not a third-party security certification or compliance seal.</p>
        </div>
        <div class="trust-points">
          <article class="trust-point">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 19 6v5.5c0 4.3-2.8 7.6-7 9.5-4.2-1.9-7-5.2-7-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>
            <h3>Permission checks first</h3>
            <p>Application identity and active project grants are verified before knowledge is retrieved.</p>
          </article>
          <article class="trust-point">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>
            <h3>Source readiness</h3>
            <p>Only sources that have completed the required indexing lifecycle are available to retrieval.</p>
          </article>
          <article class="trust-point">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>
            <h3>Traceable activity</h3>
            <p>Administrative actions and knowledge operations have an activity trail for operators.</p>
          </article>
          <article class="trust-point">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            <h3>Revocable access</h3>
            <p>Project access can be withdrawn; a consumer without an active grant is denied.</p>
          </article>
        </div>
      </div>
    </section>

    <section id="developers" class="section">
      <div class="shell developer">
        <div>
          <div class="eyebrow">For builders</div>
          <h2>Bring your own experience. Connect to a shared knowledge layer.</h2>
          <p class="section-intro">BRɅIN provides a private retrieval boundary for applications. Keep identity, model generation, conversation state and the final experience in your own product.</p>
          <div class="developer-notes">
            <div class="developer-note"><span class="feature-tick">✓</span><span>Private Worker-to-Worker connection for registered consumers.</span></div>
            <div class="developer-note"><span class="feature-tick">✓</span><span>Versioned retrieval contract designed for stable consumer integrations.</span></div>
            <div class="developer-note"><span class="feature-tick">✓</span><span>Project and source permissions stay in BRɅIN Core.</span></div>
          </div>
          <div class="hero-actions"><a class="button" href="/admin/brvin">Connect an application <span class="arrow">↗</span></a></div>
        </div>
        <div class="code-panel">
          <div class="code-top"><span>Conceptual integration flow</span><span>Private service boundary</span></div>
          <pre><span class="comment">// Pseudocode: your application owns the user experience</span>
const result = await knowledge.retrieve({
  <span class="key">projectId</span>: "authorised-project",
  <span class="key">query</span>: "Explain the key concept",
  <span class="key">limit</span>: 5
});

<span class="comment">// BRɅIN verifies the trusted app identity,</span>
<span class="comment">// checks its active grant and source readiness,</span>
<span class="comment">// then returns source-aware retrieval results.</span>

renderAnswer({
  evidence: result.data,
  sourcePages: result.data.map(item => item.page)
});</pre>
          <p class="code-note">Conceptual flow only. Production consumers connect through the private Worker Service Binding; BRɅIN does not expose a public retrieval endpoint or ship a generic client SDK.</p>
        </div>
      </div>
    </section>

    <section class="closing">
      <div class="shell">
        <div class="eyebrow">Build on knowledge you can verify</div>
        <h2>Give every application a better foundation.</h2>
        <p>Organise your knowledge once. Connect the right applications. Keep evidence and access boundaries in view.</p>
        <a class="button" href="/admin/brvin">Explore BRɅIN <span class="arrow">↗</span></a>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="shell">
      <div class="footer-top">
        <div class="footer-brand">
          <a class="brand" href="/brvin"><span class="brand-mark">Ʌ</span><span class="brand-word">BRɅIN</span></a>
          <p>A private, source-aware knowledge platform for applications that need dependable context.</p>
        </div>
        <div class="footer-columns">
          <div class="footer-column"><strong>Platform</strong><div class="footer-links"><a href="#platform">Knowledge workspace</a><a href="#capabilities">Retrieval</a><a href="#trust">Trust & governance</a></div></div>
          <div class="footer-column"><strong>Resources</strong><div class="footer-links"><a href="#developers">Developers</a><a href="/admin/brvin">Admin console</a><a href="/contact">Contact</a></div></div>
          <div class="footer-column"><strong>Company</strong><div class="footer-links"><a href="#trust">Trust approach</a><a href="/contact">Contact</a></div></div>
        </div>
      </div>
      <div class="footer-bottom"><span>© 2026 BRɅIN. All rights reserved.</span><span>Knowledge, with its sources intact.</span></div>
    </div>
  </footer>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=900, stale-while-revalidate=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}
