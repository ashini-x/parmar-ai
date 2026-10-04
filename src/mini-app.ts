export function getMiniAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>SawalNewton</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6fa;
      --card: #ffffff;
      --text: #15171c;
      --muted: #737985;
      --border: #e4e7ec;
      --accent: #111827;
      --accent-soft: #eef2ff;
      --success: #0f7a45;
      --danger: #b42318;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    button { font: inherit; }

    .page {
      width: 100%;
      max-width: 560px;
      margin: 0 auto;
      min-height: 100vh;
      padding: 24px 16px 28px;
    }

    .brand {
      font-size: 29px;
      font-weight: 850;
      letter-spacing: -0.8px;
    }

    .tagline {
      margin-top: 6px;
      color: var(--muted);
      font-size: 14px;
    }

    .card {
      margin-top: 22px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 8px 28px rgba(15, 23, 42, 0.05);
    }

    .hidden { display: none !important; }

    .eyebrow {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--muted);
    }

    h1, h2, p { margin-left: 0; margin-right: 0; }
    h1 { margin-top: 7px; margin-bottom: 0; font-size: 26px; letter-spacing: -0.45px; }
    h2 { margin-top: 8px; margin-bottom: 0; font-size: 22px; }

    .details {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 15px;
    }

    .pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 12px;
      color: var(--muted);
      background: #fafafa;
    }

    .button {
      width: 100%;
      margin-top: 20px;
      padding: 14px 16px;
      border: 0;
      border-radius: 14px;
      background: var(--accent);
      color: #fff;
      font-weight: 800;
      cursor: pointer;
    }

    .button.secondary {
      margin-top: 10px;
      background: #eef0f4;
      color: var(--text);
    }

    .button:disabled { opacity: 0.6; cursor: default; }

    .note {
      margin-top: 14px;
      text-align: center;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .test-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }

    .progress {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .timer {
      border-radius: 999px;
      padding: 7px 10px;
      background: #f0f1f4;
      font-size: 13px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }

    .timer.danger {
      color: var(--danger);
      background: #fff1f0;
    }

    .question {
      font-size: 20px;
      line-height: 1.45;
      font-weight: 700;
      white-space: pre-wrap;
    }

    .options {
      display: grid;
      gap: 10px;
      margin-top: 20px;
    }

    .option {
      width: 100%;
      text-align: left;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #fff;
      padding: 14px;
      color: var(--text);
      cursor: pointer;
    }

    .option.selected {
      border-color: #6366f1;
      background: var(--accent-soft);
    }

    .option-key {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      margin-right: 9px;
      border-radius: 50%;
      background: #f0f1f4;
      font-size: 12px;
      font-weight: 850;
      vertical-align: middle;
    }

    .option.selected .option-key {
      background: #4f46e5;
      color: #fff;
    }

    .test-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 20px;
    }

    .result-score {
      font-size: 58px;
      font-weight: 900;
      letter-spacing: -2px;
      margin-top: 8px;
    }

    .result-label {
      color: var(--muted);
      margin-top: -2px;
    }

    .result-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 18px;
    }

    .result-box {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px 8px;
      text-align: center;
    }

    .result-box strong { display: block; font-size: 18px; }
    .result-box span { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; }

    .message {
      margin-top: 14px;
      border-radius: 14px;
      padding: 12px 14px;
      background: #f2f4f7;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .error {
      background: #fff1f0;
      color: var(--danger);
    }

    @media (max-width: 380px) {
      .question { font-size: 18px; }
      .result-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="brand">SawalNewton</div>
    <div class="tagline">Sawal karo. Solve karo. Dekho kitna dum hai.</div>

    <section id="home-screen" class="card">
      <div class="eyebrow">First Test</div>
      <h1>SSC Maths</h1>
      <div class="details">
        <div class="pill">10 Questions</div>
        <div class="pill">Random</div>
        <div class="pill">5 Minutes</div>
      </div>
      <button id="start-button" class="button">Start Test</button>
      <div class="note">A fresh set is selected from the active SawalNewton question bank.</div>
      <div id="home-message" class="message hidden"></div>
    </section>

    <section id="test-screen" class="card hidden">
      <div class="test-top">
        <div id="progress" class="progress">Question 1 / 10</div>
        <div id="timer" class="timer">05:00</div>
      </div>

      <div id="question-text" class="question"></div>
      <div id="options" class="options"></div>

      <div class="test-actions">
        <button id="prev-button" class="button secondary">Previous</button>
        <button id="next-button" class="button">Next</button>
      </div>

      <button id="submit-button" class="button hidden">Submit Test</button>
    </section>

    <section id="result-screen" class="card hidden">
      <div class="eyebrow">Your Result</div>
      <div id="score" class="result-score">0/10</div>
      <div id="result-label" class="result-label">Newton is checking...</div>

      <div class="result-grid">
        <div class="result-box"><strong id="correct">0</strong><span>Correct</span></div>
        <div class="result-box"><strong id="wrong">0</strong><span>Wrong</span></div>
        <div class="result-box"><strong id="unanswered">0</strong><span>Unanswered</span></div>
      </div>

      <div id="result-message" class="message"></div>
      <button id="share-button" class="button">Share Result</button>
      <button id="again-button" class="button secondary">Take Another Test</button>
    </section>
  </main>

  <script>
    const telegram = window.Telegram?.WebApp;

    if (telegram) {
      telegram.ready();
      telegram.expand();
      if (telegram.disableVerticalSwipes) {
        telegram.disableVerticalSwipes();
      }
    }

    const homeScreen = document.getElementById('home-screen');
    const testScreen = document.getElementById('test-screen');
    const resultScreen = document.getElementById('result-screen');
    const startButton = document.getElementById('start-button');
    const prevButton = document.getElementById('prev-button');
    const nextButton = document.getElementById('next-button');
    const submitButton = document.getElementById('submit-button');
    const progress = document.getElementById('progress');
    const timer = document.getElementById('timer');
    const questionText = document.getElementById('question-text');
    const optionsElement = document.getElementById('options');
    const homeMessage = document.getElementById('home-message');

    const state = {
      attemptId: null,
      startedAt: null,
      durationSeconds: 300,
      questions: [],
      answers: new Map(),
      currentIndex: 0,
      timerHandle: null,
      submitting: false,
      result: null
    };

    function show(section) {
      homeScreen.classList.add('hidden');
      testScreen.classList.add('hidden');
      resultScreen.classList.add('hidden');
      section.classList.remove('hidden');
    }

    function formatTime(totalSeconds) {
      const seconds = Math.max(0, totalSeconds);
      const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
      const remaining = (seconds % 60).toString().padStart(2, '0');
      return minutes + ':' + remaining;
    }

    function setHomeMessage(message, error = false) {
      homeMessage.textContent = message;
      homeMessage.classList.remove('hidden');
      homeMessage.classList.toggle('error', error);
    }

    function clearHomeMessage() {
      homeMessage.textContent = '';
      homeMessage.classList.add('hidden');
      homeMessage.classList.remove('error');
    }

    function renderQuestion() {
      const question = state.questions[state.currentIndex];
      if (!question) return;

      progress.textContent = 'Question ' + (state.currentIndex + 1) + ' / ' + state.questions.length;
      questionText.textContent = question.question_text;
      optionsElement.replaceChildren();

      const optionEntries = [
        ['A', question.option_a],
        ['B', question.option_b],
        ['C', question.option_c],
        ['D', question.option_d]
      ];

      const selected = state.answers.get(question.id) ?? null;

      for (const [key, text] of optionEntries) {
        const button = document.createElement('button');
        button.className = 'option' + (selected === key ? ' selected' : '');
        button.type = 'button';

        const keySpan = document.createElement('span');
        keySpan.className = 'option-key';
        keySpan.textContent = key;

        const textSpan = document.createElement('span');
        textSpan.textContent = text;

        button.append(keySpan, textSpan);
        button.addEventListener('click', () => {
          state.answers.set(question.id, key);
          renderQuestion();
        });

        optionsElement.appendChild(button);
      }

      prevButton.disabled = state.currentIndex === 0;
      nextButton.classList.toggle('hidden', state.currentIndex === state.questions.length - 1);
      submitButton.classList.toggle('hidden', state.currentIndex !== state.questions.length - 1);
    }

    function stopTimer() {
      if (state.timerHandle) {
        clearInterval(state.timerHandle);
        state.timerHandle = null;
      }
    }

    function updateTimer() {
      if (!state.startedAt) return;

      const elapsed = Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000);
      const remaining = state.durationSeconds - elapsed;

      timer.textContent = formatTime(remaining);
      timer.classList.toggle('danger', remaining <= 30);

      if (remaining <= 0 && !state.submitting) {
        submitTest(true);
      }
    }

    function startTimer() {
      stopTimer();
      updateTimer();
      state.timerHandle = setInterval(updateTimer, 1000);
    }

    async function startTest() {
      if (!telegram) {
        setHomeMessage('Please open SawalNewton from Telegram.', true);
        return;
      }

      clearHomeMessage();
      startButton.disabled = true;
      startButton.textContent = 'Loading...';

      try {
        const response = await fetch('/api/test/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ initData: telegram.initData })
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data?.error || 'Unable to start the test.');
        }

        state.attemptId = data.attemptId;
        state.startedAt = data.startedAt;
        state.durationSeconds = data.durationSeconds || 300;
        state.questions = data.questions || [];
        state.answers = new Map();
        state.currentIndex = 0;
        state.submitting = false;
        state.result = null;

        if (state.questions.length === 0) {
          throw new Error('No questions were returned.');
        }

        show(testScreen);
        renderQuestion();
        startTimer();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to start the test.';
        if (message.startsWith('not_enough_questions:')) {
          setHomeMessage('SawalNewton needs at least 10 active Maths questions before a test can start.', true);
        } else {
          setHomeMessage(message, true);
        }
      } finally {
        startButton.disabled = false;
        startButton.textContent = 'Start Test';
      }
    }

    function goPrevious() {
      if (state.currentIndex > 0) {
        state.currentIndex -= 1;
        renderQuestion();
      }
    }

    function goNext() {
      if (state.currentIndex < state.questions.length - 1) {
        state.currentIndex += 1;
        renderQuestion();
      }
    }

    function answerPayload() {
      return state.questions.map((question) => ({
        questionId: question.id,
        selectedOption: state.answers.get(question.id) ?? null
      }));
    }

    async function submitTest(auto = false) {
      if (state.submitting || !state.attemptId || !telegram) return;

      state.submitting = true;
      stopTimer();
      submitButton.disabled = true;
      nextButton.disabled = true;
      prevButton.disabled = true;
      submitButton.textContent = auto ? 'Time Up...' : 'Submitting...';

      try {
        const response = await fetch('/api/test/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            initData: telegram.initData,
            attemptId: state.attemptId,
            answers: answerPayload()
          })
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data?.error || 'Unable to submit the test.');
        }

        state.result = data;
        renderResult(data);
        show(resultScreen);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to submit the test.';
        alert(message);
        state.submitting = false;
        submitButton.disabled = false;
        nextButton.disabled = false;
        prevButton.disabled = false;
        submitButton.textContent = 'Submit Test';
        startTimer();
      }
    }

    function renderResult(data) {
      document.getElementById('score').textContent = data.score + '/' + data.totalQuestions;
      document.getElementById('correct').textContent = data.correct;
      document.getElementById('wrong').textContent = data.wrong;
      document.getElementById('unanswered').textContent = data.unanswered;

      const percentage = Math.round((data.correct / data.totalQuestions) * 100);
      const resultLabel = document.getElementById('result-label');
      const resultMessage = document.getElementById('result-message');

      if (percentage >= 90) resultLabel.textContent = 'Newton is impressed. 🔥';
      else if (percentage >= 70) resultLabel.textContent = 'Good going. Keep pushing. 💪';
      else if (percentage >= 50) resultLabel.textContent = 'Not bad. There is room to grow. 🧠';
      else resultLabel.textContent = 'Newton says: practice more. 😈';

      const mins = Math.floor(data.timeTakenSeconds / 60);
      const secs = data.timeTakenSeconds % 60;
      resultMessage.textContent =
        (data.timedOut ? 'Time ran out. ' : '') +
        'Accuracy: ' + percentage + '%. Time: ' + mins + 'm ' + secs + 's.';
    }

    async function shareResult() {
      if (!state.result) return;

      const scoreText =
        'I scored ' + state.result.score + '/' + state.result.totalQuestions + ' on SawalNewton. Can you beat me?';
      const shareUrl = window.location.origin + '/app';
      const telegramShareUrl =
        'https://t.me/share/url?url=' + encodeURIComponent(shareUrl) +
        '&text=' + encodeURIComponent(scoreText);

      if (telegram?.openTelegramLink) {
        telegram.openTelegramLink(telegramShareUrl);
        return;
      }

      if (navigator.share) {
        await navigator.share({ title: 'SawalNewton', text: scoreText, url: shareUrl });
        return;
      }

      window.open(telegramShareUrl, '_blank', 'noopener,noreferrer');
    }

    function resetToHome() {
      stopTimer();
      state.attemptId = null;
      state.startedAt = null;
      state.questions = [];
      state.answers = new Map();
      state.currentIndex = 0;
      state.submitting = false;
      state.result = null;
      submitButton.disabled = false;
      nextButton.disabled = false;
      prevButton.disabled = false;
      submitButton.textContent = 'Submit Test';
      show(homeScreen);
      clearHomeMessage();
    }

    startButton.addEventListener('click', startTest);
    prevButton.addEventListener('click', goPrevious);
    nextButton.addEventListener('click', goNext);
    submitButton.addEventListener('click', () => submitTest(false));
    document.getElementById('again-button').addEventListener('click', resetToHome);
    document.getElementById('share-button').addEventListener('click', shareResult);
  </script>
</body>
</html>`;
}
