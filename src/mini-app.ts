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

    .language-intro {
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.5;
      font-size: 14px;
    }

    .language-options {
      display: grid;
      gap: 10px;
      margin-top: 20px;
    }

    .language-option {
      width: 100%;
      text-align: left;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: #fff;
      padding: 15px 16px;
      cursor: pointer;
    }

    .language-option.selected {
      border-color: #4f46e5;
      background: var(--accent-soft);
    }

    .language-option strong {
      display: block;
      font-size: 18px;
    }

    .language-option span {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }

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

    .link-button {
      width: 100%;
      margin-top: 12px;
      border: 0;
      background: transparent;
      color: #4f46e5;
      font-weight: 750;
      cursor: pointer;
      padding: 7px 8px;
    }

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
    <div id="tagline" class="tagline">Sawal karo. Solve karo. Dekho kitna dum hai.</div>

    <section id="loading-screen" class="card">
      <div class="eyebrow" id="loading-eyebrow">SawalNewton</div>
      <h1 id="loading-title">Loading...</h1>
      <div id="loading-message" class="note">Setting things up.</div>
    </section>

    <section id="language-screen" class="card hidden">
      <div class="eyebrow" id="language-eyebrow">First step</div>
      <h1 id="language-title">Choose your language</h1>
      <p id="language-intro" class="language-intro">Questions, answers and results will follow this choice.</p>

      <div class="language-options">
        <button id="language-hi" class="language-option" type="button">
          <strong>हिंदी</strong>
          <span>हिंदी में सवाल हल करें</span>
        </button>
        <button id="language-en" class="language-option" type="button">
          <strong>English</strong>
          <span>Solve questions in English</span>
        </button>
      </div>

      <button id="language-continue" class="button" type="button" disabled>Continue</button>
      <div id="language-message" class="message hidden"></div>
    </section>

    <section id="home-screen" class="card hidden">
      <div class="eyebrow" id="home-eyebrow">First Test</div>
      <h1 id="home-title">SSC Maths</h1>
      <div class="details">
        <div id="questions-pill" class="pill">10 Questions</div>
        <div id="random-pill" class="pill">Random</div>
        <div id="time-pill" class="pill">5 Minutes</div>
        <div id="language-pill" class="pill">English</div>
      </div>
      <button id="start-button" class="button" type="button">Start Test</button>
      <button id="change-language-button" class="link-button" type="button">Change language</button>
      <div id="home-note" class="note">A fresh set is selected from the active SawalNewton question bank.</div>
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
        <button id="prev-button" class="button secondary" type="button">Previous</button>
        <button id="next-button" class="button" type="button">Next</button>
      </div>

      <button id="submit-button" class="button hidden" type="button">Submit Test</button>
    </section>

    <section id="result-screen" class="card hidden">
      <div class="eyebrow" id="result-eyebrow">Your Result</div>
      <div id="score" class="result-score">0/10</div>
      <div id="result-label" class="result-label">Newton is checking...</div>

      <div class="result-grid">
        <div class="result-box"><strong id="correct">0</strong><span id="correct-label">Correct</span></div>
        <div class="result-box"><strong id="wrong">0</strong><span id="wrong-label">Wrong</span></div>
        <div class="result-box"><strong id="unanswered">0</strong><span id="unanswered-label">Unanswered</span></div>
      </div>

      <div id="result-message" class="message"></div>
      <button id="share-button" class="button" type="button">Share Result</button>
      <button id="again-button" class="button secondary" type="button">Take Another Test</button>
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

    const COPY = {
      en: {
        tagline: 'Questions. Tests. Competition.',
        loadingEyebrow: 'SawalNewton',
        loadingTitle: 'Loading...',
        loadingMessage: 'Setting things up.',
        languageEyebrow: 'First step',
        languageTitle: 'Choose your language',
        languageIntro: 'Your questions, options and results will follow this choice.',
        hindiSub: 'Solve questions in Hindi',
        englishSub: 'Solve questions in English',
        continue: 'Continue',
        homeEyebrow: 'First Test',
        homeTitle: 'SSC Maths',
        questionsPill: '10 Questions',
        randomPill: 'Random',
        timePill: '5 Minutes',
        languagePill: 'English',
        start: 'Start Test',
        changeLanguage: 'Change language',
        homeNote: 'A fresh set is selected from the active SawalNewton question bank.',
        previous: 'Previous',
        next: 'Next',
        submit: 'Submit Test',
        submitting: 'Submitting...',
        timeUp: 'Time Up...',
        resultEyebrow: 'Your Result',
        correct: 'Correct',
        wrong: 'Wrong',
        unanswered: 'Unanswered',
        share: 'Share Result',
        again: 'Take Another Test',
        loadingTest: 'Loading test...',
        pleaseTelegram: 'Please open SawalNewton from Telegram.',
        noQuestions: 'No questions were returned.',
        needsQuestions: 'SawalNewton needs at least 10 matching questions before a test can start.',
        languageNeeded: 'Please choose a language first.',
        languageSaved: 'Language saved.',
        languageSaveFailed: 'Unable to save your language. Please try again.',
        preferencesFailed: 'Unable to load your preferences. Please try again.',
        testStartFailed: 'Unable to start the test.',
        submitFailed: 'Unable to submit the test.',
        timeRanOut: 'Time ran out. ',
        accuracy: 'Accuracy: ',
        time: ' Time: ',
        minutes: 'm',
        seconds: 's',
        result90: 'Newton is impressed. 🔥',
        result70: 'Good going. Keep pushing. 💪',
        result50: 'Not bad. There is room to grow. 🧠',
        resultLow: 'Newton says: practice more. 😈',
        shareTextPrefix: 'I scored ',
        shareTextMiddle: '/10 on SawalNewton. Can you beat me?'
      },
      hi: {
        tagline: 'सवाल। टेस्ट। मुकाबला।',
        loadingEyebrow: 'SawalNewton',
        loadingTitle: 'लोड हो रहा है...',
        loadingMessage: 'तैयार किया जा रहा है।',
        languageEyebrow: 'पहला कदम',
        languageTitle: 'अपनी भाषा चुनें',
        languageIntro: 'सवाल, विकल्प और रिज़ल्ट इसी भाषा में दिखेंगे।',
        hindiSub: 'हिंदी में सवाल हल करें',
        englishSub: 'English में सवाल हल करें',
        continue: 'आगे बढ़ें',
        homeEyebrow: 'पहला टेस्ट',
        homeTitle: 'SSC Maths',
        questionsPill: '10 सवाल',
        randomPill: 'रैंडम',
        timePill: '5 मिनट',
        languagePill: 'हिंदी',
        start: 'टेस्ट शुरू करें',
        changeLanguage: 'भाषा बदलें',
        homeNote: 'हर बार SawalNewton question bank से नए सवाल चुने जाएंगे।',
        previous: 'पिछला',
        next: 'अगला',
        submit: 'टेस्ट जमा करें',
        submitting: 'जमा हो रहा है...',
        timeUp: 'समय समाप्त...',
        resultEyebrow: 'आपका रिज़ल्ट',
        correct: 'सही',
        wrong: 'गलत',
        unanswered: 'छोड़े',
        share: 'रिज़ल्ट शेयर करें',
        again: 'एक और टेस्ट',
        loadingTest: 'टेस्ट लोड हो रहा है...',
        pleaseTelegram: 'SawalNewton को Telegram के अंदर खोलें।',
        noQuestions: 'कोई सवाल नहीं मिला।',
        needsQuestions: 'टेस्ट शुरू करने के लिए कम से कम 10 मिलते-जुलते सवाल चाहिए।',
        languageNeeded: 'पहले अपनी भाषा चुनें।',
        languageSaved: 'भाषा सेव हो गई।',
        languageSaveFailed: 'भाषा सेव नहीं हो सकी। फिर से कोशिश करें।',
        preferencesFailed: 'आपकी सेटिंग लोड नहीं हो सकी। फिर से कोशिश करें।',
        testStartFailed: 'टेस्ट शुरू नहीं हो सका।',
        submitFailed: 'टेस्ट जमा नहीं हो सका।',
        timeRanOut: 'समय समाप्त। ',
        accuracy: 'सटीकता: ',
        time: ' समय: ',
        minutes: 'मि',
        seconds: 'से',
        result90: 'Newton खुश है। 🔥',
        result70: 'अच्छी शुरुआत। लगे रहो। 💪',
        result50: 'बुरा नहीं। अभी और बेहतर कर सकते हो। 🧠',
        resultLow: 'Newton कहता है: थोड़ा और अभ्यास करो। 😈',
        shareTextPrefix: 'मैंने SawalNewton पर ',
        shareTextMiddle: '/10 स्कोर किया। क्या तुम मुझे हरा सकते हो?'
      }
    };

    const state = {
      language: null,
      languageScreenMode: 'first',
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

    const loadingScreen = document.getElementById('loading-screen');
    const languageScreen = document.getElementById('language-screen');
    const homeScreen = document.getElementById('home-screen');
    const testScreen = document.getElementById('test-screen');
    const resultScreen = document.getElementById('result-screen');

    const loadingEyebrow = document.getElementById('loading-eyebrow');
    const loadingTitle = document.getElementById('loading-title');
    const loadingMessage = document.getElementById('loading-message');
    const tagline = document.getElementById('tagline');

    const languageEyebrow = document.getElementById('language-eyebrow');
    const languageTitle = document.getElementById('language-title');
    const languageIntro = document.getElementById('language-intro');
    const languageHi = document.getElementById('language-hi');
    const languageEn = document.getElementById('language-en');
    const languageContinue = document.getElementById('language-continue');
    const languageMessage = document.getElementById('language-message');

    const homeEyebrow = document.getElementById('home-eyebrow');
    const homeTitle = document.getElementById('home-title');
    const questionsPill = document.getElementById('questions-pill');
    const randomPill = document.getElementById('random-pill');
    const timePill = document.getElementById('time-pill');
    const languagePill = document.getElementById('language-pill');
    const startButton = document.getElementById('start-button');
    const changeLanguageButton = document.getElementById('change-language-button');
    const homeNote = document.getElementById('home-note');
    const homeMessage = document.getElementById('home-message');

    const progress = document.getElementById('progress');
    const timer = document.getElementById('timer');
    const questionText = document.getElementById('question-text');
    const optionsElement = document.getElementById('options');
    const prevButton = document.getElementById('prev-button');
    const nextButton = document.getElementById('next-button');
    const submitButton = document.getElementById('submit-button');

    const resultEyebrow = document.getElementById('result-eyebrow');
    const correctLabel = document.getElementById('correct-label');
    const wrongLabel = document.getElementById('wrong-label');
    const unansweredLabel = document.getElementById('unanswered-label');
    const shareButton = document.getElementById('share-button');
    const againButton = document.getElementById('again-button');
    const resultLabel = document.getElementById('result-label');
    const resultMessage = document.getElementById('result-message');

    function copy() {
      return COPY[state.language || 'en'];
    }

    function currentLanguageName() {
      return state.language === 'hi' ? 'हिंदी' : 'English';
    }

    function show(section) {
      loadingScreen.classList.add('hidden');
      languageScreen.classList.add('hidden');
      homeScreen.classList.add('hidden');
      testScreen.classList.add('hidden');
      resultScreen.classList.add('hidden');
      section.classList.remove('hidden');
    }

    function setMessage(element, message, error) {
      element.textContent = message;
      element.classList.remove('hidden');
      element.classList.toggle('error', Boolean(error));
    }

    function clearMessage(element) {
      element.textContent = '';
      element.classList.add('hidden');
      element.classList.remove('error');
    }

    function applyCopy() {
      const c = copy();
      tagline.textContent = c.tagline;
      loadingEyebrow.textContent = c.loadingEyebrow;
      loadingTitle.textContent = c.loadingTitle;
      loadingMessage.textContent = c.loadingMessage;
      languageEyebrow.textContent = c.languageEyebrow;
      languageTitle.textContent = c.languageTitle;
      languageIntro.textContent = c.languageIntro;
      languageHi.querySelector('span').textContent = c.hindiSub;
      languageEn.querySelector('span').textContent = c.englishSub;
      languageContinue.textContent = c.continue;
      homeEyebrow.textContent = c.homeEyebrow;
      homeTitle.textContent = c.homeTitle;
      questionsPill.textContent = c.questionsPill;
      randomPill.textContent = c.randomPill;
      timePill.textContent = c.timePill;
      languagePill.textContent = c.languagePill;
      startButton.textContent = c.start;
      changeLanguageButton.textContent = c.changeLanguage;
      homeNote.textContent = c.homeNote;
      prevButton.textContent = c.previous;
      nextButton.textContent = c.next;
      submitButton.textContent = c.submit;
      resultEyebrow.textContent = c.resultEyebrow;
      correctLabel.textContent = c.correct;
      wrongLabel.textContent = c.wrong;
      unansweredLabel.textContent = c.unanswered;
      shareButton.textContent = c.share;
      againButton.textContent = c.again;
    }

    function selectLanguage(language) {
      state.language = language;
      languageHi.classList.toggle('selected', language === 'hi');
      languageEn.classList.toggle('selected', language === 'en');
      languageContinue.disabled = false;
      applyCopy();
      clearMessage(languageMessage);
    }

    async function getPreferences() {
      if (!telegram) {
        throw new Error('Please open SawalNewton from Telegram.');
      }

      const response = await fetch('/api/user/preferences', {
        method: 'GET',
        headers: {
          'x-telegram-init-data': telegram.initData
        }
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data?.error || 'preferences_failed');
      }

      return data;
    }

    async function saveLanguage(language) {
      if (!telegram) {
        setMessage(languageMessage, copy().pleaseTelegram, true);
        return false;
      }

      languageContinue.disabled = true;

      try {
        const response = await fetch('/api/user/preferences', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            initData: telegram.initData,
            language
          })
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data?.error || 'language_save_failed');
        }

        state.language = data.language;
        applyCopy();
        clearMessage(languageMessage);
        renderHome();
        return true;
      } catch (error) {
        setMessage(
          languageMessage,
          error instanceof Error ? error.message : copy().languageSaveFailed,
          true
        );
        languageContinue.disabled = false;
        return false;
      }
    }

    function renderHome() {
      applyCopy();
      languagePill.textContent = currentLanguageName();
      startButton.disabled = false;
      show(homeScreen);
    }

    function openLanguageSelector(mode) {
      state.languageScreenMode = mode;
      if (state.language) {
        selectLanguage(state.language);
      } else {
        languageHi.classList.remove('selected');
        languageEn.classList.remove('selected');
        languageContinue.disabled = true;
      }
      applyCopy();
      clearMessage(languageMessage);
      show(languageScreen);
    }

    async function continueLanguage() {
      if (!state.language) return;

      const originalText = languageContinue.textContent;
      languageContinue.textContent = copy().loadingTest;

      try {
        const saved = await saveLanguage(state.language);
        if (saved) {
          languageContinue.textContent = originalText;
          return;
        }
      } finally {
        if (!languageScreen.classList.contains('hidden')) {
          languageContinue.textContent = originalText;
        }
      }
    }

    function formatTime(totalSeconds) {
      const seconds = Math.max(0, totalSeconds);
      const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
      const remaining = (seconds % 60).toString().padStart(2, '0');
      return minutes + ':' + remaining;
    }

    function renderQuestion() {
      const question = state.questions[state.currentIndex];
      if (!question) return;

      progress.textContent =
        (state.language === 'hi' ? 'सवाल ' : 'Question ') +
        (state.currentIndex + 1) +
        ' / ' +
        state.questions.length;

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
      nextButton.classList.toggle(
        'hidden',
        state.currentIndex === state.questions.length - 1
      );
      submitButton.classList.toggle(
        'hidden',
        state.currentIndex !== state.questions.length - 1
      );
    }

    function stopTimer() {
      if (state.timerHandle) {
        clearInterval(state.timerHandle);
        state.timerHandle = null;
      }
    }

    function updateTimer() {
      if (!state.startedAt) return;

      const elapsed = Math.floor(
        (Date.now() - new Date(state.startedAt).getTime()) / 1000
      );
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
        setMessage(homeMessage, copy().pleaseTelegram, true);
        return;
      }

      if (!state.language) {
        openLanguageSelector('first');
        return;
      }

      clearMessage(homeMessage);
      startButton.disabled = true;
      startButton.textContent = copy().loadingTest;

      try {
        const response = await fetch('/api/test/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ initData: telegram.initData })
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          const message = data?.error || copy().testStartFailed;
          throw new Error(message);
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
          throw new Error(copy().noQuestions);
        }

        show(testScreen);
        renderQuestion();
        startTimer();
      } catch (error) {
        const raw = error instanceof Error ? error.message : copy().testStartFailed;
        const message = raw.startsWith('not_enough_questions:')
          ? copy().needsQuestions
          : raw === 'language_not_set'
            ? copy().languageNeeded
            : raw;
        setMessage(homeMessage, message, true);
      } finally {
        startButton.disabled = false;
        startButton.textContent = copy().start;
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
      submitButton.textContent = auto ? copy().timeUp : copy().submitting;

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
          throw new Error(data?.error || copy().submitFailed);
        }

        state.result = data;
        renderResult(data);
        show(resultScreen);
      } catch (error) {
        const message = error instanceof Error ? error.message : copy().submitFailed;
        alert(message);
        state.submitting = false;
        submitButton.disabled = false;
        nextButton.disabled = false;
        prevButton.disabled = false;
        submitButton.textContent = copy().submit;
        startTimer();
      }
    }

    function renderResult(data) {
      document.getElementById('score').textContent =
        data.score + '/' + data.totalQuestions;
      document.getElementById('correct').textContent = data.correct;
      document.getElementById('wrong').textContent = data.wrong;
      document.getElementById('unanswered').textContent = data.unanswered;

      const percentage = data.totalQuestions > 0
        ? Math.round((data.correct / data.totalQuestions) * 100)
        : 0;

      const c = copy();

      if (percentage >= 90) resultLabel.textContent = c.result90;
      else if (percentage >= 70) resultLabel.textContent = c.result70;
      else if (percentage >= 50) resultLabel.textContent = c.result50;
      else resultLabel.textContent = c.resultLow;

      const mins = Math.floor(data.timeTakenSeconds / 60);
      const secs = data.timeTakenSeconds % 60;

      resultMessage.textContent =
        (data.timedOut ? c.timeRanOut : '') +
        c.accuracy + percentage + '%. ' +
        c.time + mins + c.minutes + ' ' + secs + c.seconds + '.';
    }

    async function shareResult() {
      if (!state.result) return;

      const c = copy();
      const scoreText =
        c.shareTextPrefix +
        state.result.score +
        c.shareTextMiddle;
      const shareUrl = window.location.origin + '/app';
      const telegramShareUrl =
        'https://t.me/share/url?url=' + encodeURIComponent(shareUrl) +
        '&text=' + encodeURIComponent(scoreText);

      if (telegram?.openTelegramLink) {
        telegram.openTelegramLink(telegramShareUrl);
        return;
      }

      if (navigator.share) {
        await navigator.share({
          title: 'SawalNewton',
          text: scoreText,
          url: shareUrl
        });
        return;
      }

      window.open(
        telegramShareUrl,
        '_blank',
        'noopener,noreferrer'
      );
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
      submitButton.textContent = copy().submit;
      renderHome();
      clearMessage(homeMessage);
    }

    async function boot() {
      if (!telegram) {
        applyCopy();
        show(languageScreen);
        setMessage(languageMessage, copy().pleaseTelegram, true);
        return;
      }

      try {
        const preferences = await getPreferences();

        if (preferences.language === 'en' || preferences.language === 'hi') {
          state.language = preferences.language;
          renderHome();
        } else {
          state.language = null;
          applyCopy();
          show(languageScreen);
        }
      } catch (error) {
        applyCopy();
        show(languageScreen);
        setMessage(
          languageMessage,
          copy().preferencesFailed,
          true
        );
      }
    }

    languageHi.addEventListener('click', () => selectLanguage('hi'));
    languageEn.addEventListener('click', () => selectLanguage('en'));
    languageContinue.addEventListener('click', continueLanguage);
    startButton.addEventListener('click', startTest);
    changeLanguageButton.addEventListener('click', () => openLanguageSelector('change'));
    prevButton.addEventListener('click', goPrevious);
    nextButton.addEventListener('click', goNext);
    submitButton.addEventListener('click', () => submitTest(false));
    againButton.addEventListener('click', resetToHome);
    shareButton.addEventListener('click', shareResult);

    applyCopy();
    boot();
  </script>
</body>
</html>`;
}
