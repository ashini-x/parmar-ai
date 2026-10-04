export function getMiniAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
  />
  <title>SawalNewton</title>

  <script src="https://telegram.org/js/telegram-web-app.js"></script>

  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --card: #ffffff;
      --text: #16181d;
      --muted: #737984;
      --border: #e5e7eb;
      --accent: #111827;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    .page {
      max-width: 520px;
      margin: 0 auto;
      min-height: 100vh;
      padding: 28px 20px 24px;
      display: flex;
      flex-direction: column;
    }

    .brand {
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -0.8px;
      margin-top: 18px;
    }

    .tagline {
      margin-top: 8px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }

    .card {
      margin-top: 28px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 22px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.05);
    }

    .eyebrow {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    h1 {
      margin: 8px 0 0;
      font-size: 27px;
      letter-spacing: -0.5px;
    }

    .details {
      margin-top: 16px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 11px;
      font-size: 13px;
      color: var(--muted);
      background: #fafafa;
    }

    .button {
      width: 100%;
      margin-top: 24px;
      border: 0;
      border-radius: 14px;
      padding: 15px 18px;
      font-size: 16px;
      font-weight: 750;
      cursor: pointer;
      background: var(--accent);
      color: white;
    }

    .button:active {
      transform: scale(0.99);
    }

    .note {
      margin-top: 18px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
  </style>
</head>

<body>
  <main class="page">
    <div class="brand">SawalNewton</div>
    <div class="tagline">
      Sawal karo. Solve karo. Dekho kitna dum hai.
    </div>

    <section class="card">
      <div class="eyebrow">First Test</div>
      <h1>SSC Maths</h1>

      <div class="details">
        <div class="pill">10 Questions</div>
        <div class="pill">Random</div>
        <div class="pill">5 Minutes</div>
      </div>

      <button class="button" id="start-button">
        Start Test
      </button>

      <div class="note">
        Questions will be selected randomly from the SawalNewton question bank.
      </div>
    </section>
  </main>

  <script>
    const telegram = window.Telegram?.WebApp;

    if (telegram) {
      telegram.ready();
      telegram.expand();
    }

    const startButton =
      document.getElementById(
        "start-button",
      );
    
    startButton?.addEventListener(
      "click",
      async () => {
        if (!telegram) {
          alert(
            "Please open SawalNewton inside Telegram.",
          );
          return;
        }
    
        const originalText =
          startButton.textContent ??
          "Start Test";
    
        startButton.textContent =
          "Loading...";
        startButton.disabled = true;
    
        try {
          const response =
            await fetch(
              "/api/test/start",
              {
                method: "POST",
                headers: {
                  "content-type":
                    "application/json",
                },
                body: JSON.stringify({
                  initData:
                    telegram.initData,
                }),
              },
            );
    
          const data =
            await response.json();
    
          if (!response.ok || !data.ok) {
            throw new Error(
              data?.error ??
                "Unable to start test.",
            );
          }
    
          console.log(
            "SawalNewton test started:",
            data,
          );
    
          alert(
            `Test started! ${data.totalQuestions} random questions loaded.`,
          );
        } catch (error) {
          console.error(
            "Failed to start test:",
            error,
          );
    
          alert(
            error instanceof Error
              ? error.message
              : "Unable to start test.",
          );
    
          startButton.textContent =
            originalText;
          startButton.disabled =
            false;
        }
      },
    );
  </script>
</body>
</html>`;
}
