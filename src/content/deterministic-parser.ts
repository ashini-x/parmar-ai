import type {
  AnswerOption,
  ContentBatchInput,
  ContentSubject,
  AiQuestionCandidate
} from "./types";

export interface ParsedQuestionCandidate extends AiQuestionCandidate {}

const OPTION_PATTERN = /^\s*[({]?\s*([ABCD])\s*[)}.:\-]\s*(.*?)\s*$/i;
const ANSWER_PATTERN = /^\s*(?:answer|ans|correct\s*answer|answer\s*key|correct)\s*[:\-]?\s*([ABCD])\b/i;
const SOURCE_NUMBER_PATTERN = /^\s*(?:question\s*)?q?\s*([0-9]+)\s*[).:\-]\s*(.*)$/i;
const QUESTION_PATTERN = /^\s*question\s*([0-9]+)\s*[).:\-]\s*(.*)$/i;
const VERIFIED_ANSWER_PATTERN = /^\s*verified\s*answer\s*[:\-]?\s*([ABCD])\b/i;
const TOPIC_PATTERN = /^\s*topic\s*[:\-]\s*(.+)$/i;
const DIFFICULTY_PATTERN = /^\s*difficulty\s*[:\-]\s*(easy|medium|hard)\s*$/i;
const ENGLISH_PATTERN = /^\s*english\s*[:\-]\s*(.*)$/i;
const HINDI_PATTERN = /^\s*hindi\s*[:\-]\s*(.*)$/i;
const H_EXPLANATION_PATTERN = /^\s*(?:hindi\s+)?explanation\s*[:\-]\s*(.*)$/i;
const EXPLANATION_PATTERN = /^\s*explanation\s*[:\-]\s*(.*)$/i;
const H_OPTION_PATTERN = /^\s*h\s*([ABCD])\s*[:).\-]\s*(.*?)\s*$/i;
const CONFIDENCE_PATTERN = /^\s*confidence\s*[:\-]\s*([0-9.]+)\s*$/i;
const VERIFICATION_PATTERN = /^\s*answer\s*verification\s*[:\-]\s*(match|conflict|source_missing|source_only|ambiguous)\s*$/i;

const TOPIC_KEYWORDS: Record<ContentSubject, Array<[string, string[]]>> = {
  Maths: [
    ["Percentage", ["percent", "%", "प्रतिशत"]],
    ["Ratio", ["ratio", "अनुपात"]],
    ["Average", ["average", "औसत"]],
    ["Profit and Loss", ["profit", "loss", "लाभ", "हानि"]],
    ["Simple Interest", ["simple interest", "साधारण ब्याज"]],
    ["Compound Interest", ["compound interest", "चक्रवृद्धि ब्याज"]],
    ["Time and Work", ["time and work", "समय और कार्य"]],
    ["Time and Distance", ["time and distance", "समय और दूरी", "speed", "गति"]],
    ["Boat and Stream", ["boat", "stream", "नाव", "धारा"]],
    ["Algebra", ["algebra", "बीजगणित"]],
    ["Geometry", ["triangle", "circle", "angle", "geometry", "त्रिभुज", "वृत्त", "कोण"]],
    ["Mensuration", ["area", "volume", "perimeter", "mensuration", "क्षेत्रफल", "आयतन"]],
    ["Number System", ["number system", "integer", "remainder", "संख्या पद्धति"]],
    ["Data Interpretation", ["data interpretation", "table", "graph", "chart", "आंकड़ा"]]
  ],
  Reasoning: [
    ["Series", ["series", "श्रृंखला"]],
    ["Coding-Decoding", ["coding", "decoding", "कूट"]],
    ["Analogy", ["analogy", "सादृश्य"]],
    ["Classification", ["classification", "वर्गीकरण"]],
    ["Blood Relation", ["blood relation", "रक्त संबंध"]],
    ["Direction Sense", ["direction", "दिशा"]],
    ["Syllogism", ["syllogism", "न्यायवाक्य"]],
    ["Calendar", ["calendar", "कैलेंडर"]],
    ["Clock", ["clock", "घड़ी"]]
  ],
  English: [
    ["Vocabulary", ["vocabulary"]],
    ["Synonyms-Antonyms", ["synonym", "antonym"]],
    ["One Word Substitution", ["one word"]],
    ["Idioms and Phrases", ["idiom", "phrase"]],
    ["Grammar", ["grammar"]],
    ["Error Detection", ["error", "spot the error"]],
    ["Sentence Improvement", ["sentence improvement"]],
    ["Cloze Test", ["cloze"]],
    ["Reading Comprehension", ["passage", "comprehension"]]
  ],
  GK: [
    ["History", ["history", "इतिहास"]],
    ["Geography", ["geography", "भूगोल"]],
    ["Polity", ["polity", "संविधान", "government"]],
    ["Economy", ["economy", "अर्थव्यवस्था"]],
    ["Physics", ["physics", "भौतिक"]],
    ["Chemistry", ["chemistry", "रसायन"]],
    ["Biology", ["biology", "जीवविज्ञान"]],
    ["Environment", ["environment", "पर्यावरण"]],
    ["Current Affairs", ["current affairs", "समसामयिकी"]]
  ]
};

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toAnswerOption(value: unknown): AnswerOption | "" {
  const normalized = clean(value).toUpperCase();
  return ["A", "B", "C", "D"].includes(normalized)
    ? (normalized as AnswerOption)
    : "";
}

function inferTopic(subject: ContentSubject, text: string): string {
  const lower = text.toLowerCase();
  for (const [topic, keywords] of TOPIC_KEYWORDS[subject]) {
    if (keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      return topic;
    }
  }
  return "Other";
}

function inferDifficulty(text: string): "Easy" | "Medium" | "Hard" {
  const lower = text.toLowerCase();
  if (/(advanced|complex|hard|difficult|multi[- ]step|कठिन)/i.test(lower)) return "Hard";
  if (/(easy|simple|basic|सरल|आसान)/i.test(lower)) return "Easy";
  return "Medium";
}

function baseCandidate(input: ContentBatchInput, sequence: number): ParsedQuestionCandidate {
  return {
    source_question_number: String(sequence),
    english: {
      question_text: "",
      option_a: "",
      option_b: "",
      option_c: "",
      option_d: "",
      explanation: ""
    },
    hindi: {
      question_text: "",
      option_a: "",
      option_b: "",
      option_c: "",
      option_d: "",
      explanation: ""
    },
    topic: "Other",
    difficulty: "Medium",
    source_correct_option: "",
    verified_correct_option: "",
    answer_verification: "ambiguous",
    confidence: 0,
    ambiguity_note: "",
    exam: input.exam,
    tier: input.tier,
    year: input.year,
    shift: input.shift,
    subject: input.subject
  } as ParsedQuestionCandidate;
}

function finalizeCandidate(
  candidate: ParsedQuestionCandidate,
  input: ContentBatchInput
): ParsedQuestionCandidate {
  const combined = [
    candidate.english.question_text,
    candidate.english.option_a,
    candidate.english.option_b,
    candidate.english.option_c,
    candidate.english.option_d,
    candidate.hindi.question_text,
    candidate.hindi.option_a,
    candidate.hindi.option_b,
    candidate.hindi.option_c,
    candidate.hindi.option_d
  ].join(" ");

  if (!candidate.topic || candidate.topic === "Other") {
    candidate.topic = inferTopic(input.subject, combined);
  }

  if (!candidate.difficulty) {
    candidate.difficulty = inferDifficulty(combined);
  }

  if (candidate.source_correct_option && candidate.verified_correct_option) {
    candidate.answer_verification =
      candidate.source_correct_option === candidate.verified_correct_option
        ? "match"
        : "conflict";
    if (candidate.confidence <= 0) candidate.confidence = 1;
  } else if (candidate.source_correct_option) {
    candidate.answer_verification = "source_only";
    if (candidate.confidence <= 0) candidate.confidence = 0.75;
  } else {
    candidate.answer_verification = "source_missing";
    candidate.confidence = Math.max(candidate.confidence, 0.3);
  }

  return candidate;
}

function parseBlocks(text: string): string[][] {
  const rawLines = text.replace(/\r/g, "").split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.some((line) => line.trim())) {
      blocks.push(current);
    }
    current = [];
  };

  for (const line of rawLines) {
    if (/^\s*END\s*$/i.test(line)) {
      flush();
      continue;
    }

    const startsQuestion = QUESTION_PATTERN.test(line) || SOURCE_NUMBER_PATTERN.test(line);
    if (startsQuestion && current.length > 0) {
      flush();
    }

    if (!line.trim() && current.length > 0) {
      current.push("");
      continue;
    }

    current.push(line);
  }

  flush();

  return blocks.filter((block) =>
    block.some((line) => OPTION_PATTERN.test(line))
  );
}

function parseTextBlock(
  lines: string[],
  input: ContentBatchInput,
  sequence: number
): ParsedQuestionCandidate {
  const candidate = baseCandidate(input, sequence);
  let mode: "english" | "hindi" | "explanation" | "hindi_explanation" = "english";
  let questionNumber = String(sequence);
  let questionLines: string[] = [];
  let hindiQuestionLines: string[] = [];
  let explanationLines: string[] = [];
  let hindiExplanationLines: string[] = [];

  const addQuestionLine = (value: string) => {
    if (mode === "hindi") hindiQuestionLines.push(value);
    else if (mode === "explanation") explanationLines.push(value);
    else if (mode === "hindi_explanation") hindiExplanationLines.push(value);
    else questionLines.push(value);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const qMatch = line.match(QUESTION_PATTERN) || line.match(SOURCE_NUMBER_PATTERN);
    if (qMatch) {
      questionNumber = qMatch[1];
      if (qMatch[2]) questionLines.push(clean(qMatch[2]));
      mode = "english";
      continue;
    }

    const englishMatch = line.match(ENGLISH_PATTERN);
    if (englishMatch) {
      mode = "english";
      if (englishMatch[1]) questionLines.push(clean(englishMatch[1]));
      continue;
    }

    const hindiMatch = line.match(HINDI_PATTERN);
    if (hindiMatch) {
      mode = "hindi";
      if (hindiMatch[1]) hindiQuestionLines.push(clean(hindiMatch[1]));
      continue;
    }

    const topicMatch = line.match(TOPIC_PATTERN);
    if (topicMatch) {
      candidate.topic = clean(topicMatch[1]);
      continue;
    }

    const difficultyMatch = line.match(DIFFICULTY_PATTERN);
    if (difficultyMatch) {
      candidate.difficulty = difficultyMatch[1].charAt(0).toUpperCase() + difficultyMatch[1].slice(1).toLowerCase();
      continue;
    }

    const answerMatch = line.match(ANSWER_PATTERN);
    if (answerMatch) {
      candidate.source_correct_option = toAnswerOption(answerMatch[1]);
      continue;
    }

    const verifiedMatch = line.match(VERIFIED_ANSWER_PATTERN);
    if (verifiedMatch) {
      candidate.verified_correct_option = toAnswerOption(verifiedMatch[1]);
      continue;
    }

    const confidenceMatch = line.match(CONFIDENCE_PATTERN);
    if (confidenceMatch) {
      const value = Number(confidenceMatch[1]);
      candidate.confidence = value > 1 ? Math.min(1, value / 100) : Math.max(0, Math.min(1, value));
      continue;
    }

    const verificationMatch = line.match(VERIFICATION_PATTERN);
    if (verificationMatch) {
      candidate.answer_verification = verificationMatch[1] as AiQuestionCandidate["answer_verification"];
      continue;
    }

    const hOptionMatch = line.match(H_OPTION_PATTERN);
    if (hOptionMatch) {
      const key = hOptionMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
      candidate.hindi[`option_${key.toLowerCase()}` as keyof typeof candidate.hindi] = clean(hOptionMatch[2]) as never;
      mode = "hindi";
      continue;
    }

    const optionMatch = line.match(OPTION_PATTERN);
    if (optionMatch) {
      const key = optionMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
      const field = `option_${key.toLowerCase()}` as keyof typeof candidate.english;
      if (mode === "hindi") {
        candidate.hindi[field] = clean(optionMatch[2]) as never;
      } else {
        candidate.english[field] = clean(optionMatch[2]) as never;
      }
      continue;
    }

    if (EXPLANATION_PATTERN.test(line)) {
      mode = "explanation";
      explanationLines.push(clean(line.replace(EXPLANATION_PATTERN, "$1")));
      continue;
    }

    if (H_EXPLANATION_PATTERN.test(line) && /hindi/i.test(line)) {
      mode = "hindi_explanation";
      hindiExplanationLines.push(clean(line.replace(H_EXPLANATION_PATTERN, "$1")));
      continue;
    }

    addQuestionLine(line);
  }

  candidate.source_question_number = questionNumber;
  candidate.english.question_text = clean(questionLines.join(" "));
  candidate.hindi.question_text = clean(hindiQuestionLines.join(" "));
  candidate.english.explanation = clean(explanationLines.join(" "));
  candidate.hindi.explanation = clean(hindiExplanationLines.join(" "));

  return finalizeCandidate(candidate, input);
}

export function parseStructuredTxt(
  text: string,
  input: ContentBatchInput
): ParsedQuestionCandidate[] {
  return parseBlocks(text)
    .map((block, index) => parseTextBlock(block, input, index + 1))
    .filter((candidate) => candidate.english.question_text.length > 0)
    .slice(0, input.maxQuestions);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char !== "\r") cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function valueByAliases(
  row: Record<string, string>,
  aliases: string[]
): string {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value !== undefined && value.trim() !== "") return clean(value);
  }
  return "";
}

function objectToCandidate(
  raw: Record<string, unknown>,
  input: ContentBatchInput,
  sequence: number
): ParsedQuestionCandidate {
  const candidate = baseCandidate(input, sequence);
  const english = (raw.english && typeof raw.english === "object") ? raw.english as Record<string, unknown> : {};
  const hindi = (raw.hindi && typeof raw.hindi === "object") ? raw.hindi as Record<string, unknown> : {};

  candidate.source_question_number = clean(raw.source_question_number ?? raw.question_number ?? raw.number ?? sequence);

  candidate.english.question_text = clean(raw.question_text ?? raw.english_question ?? english.question_text);
  candidate.english.option_a = clean(raw.option_a ?? raw.english_option_a ?? english.option_a);
  candidate.english.option_b = clean(raw.option_b ?? raw.english_option_b ?? english.option_b);
  candidate.english.option_c = clean(raw.option_c ?? raw.english_option_c ?? english.option_c);
  candidate.english.option_d = clean(raw.option_d ?? raw.english_option_d ?? english.option_d);
  candidate.english.explanation = clean(raw.explanation ?? raw.english_explanation ?? english.explanation);

  candidate.hindi.question_text = clean(raw.hindi_question ?? hindi.question_text);
  candidate.hindi.option_a = clean(raw.hindi_option_a ?? hindi.option_a);
  candidate.hindi.option_b = clean(raw.hindi_option_b ?? hindi.option_b);
  candidate.hindi.option_c = clean(raw.hindi_option_c ?? hindi.option_c);
  candidate.hindi.option_d = clean(raw.hindi_option_d ?? hindi.option_d);
  candidate.hindi.explanation = clean(raw.hindi_explanation ?? hindi.explanation);

  candidate.source_correct_option = toAnswerOption(raw.source_correct_option ?? raw.answer ?? raw.correct_option);
  candidate.verified_correct_option = toAnswerOption(raw.verified_correct_option ?? raw.verified_answer);
  candidate.answer_verification = clean(raw.answer_verification) as AiQuestionCandidate["answer_verification"] || "ambiguous";
  candidate.topic = clean(raw.topic) || "Other";
  candidate.difficulty = clean(raw.difficulty) || "Medium";

  const rawConfidence = Number(raw.confidence);
  if (Number.isFinite(rawConfidence)) {
    candidate.confidence = rawConfidence > 1 ? Math.min(1, rawConfidence / 100) : Math.max(0, Math.min(1, rawConfidence));
  }

  candidate.ambiguity_note = clean(raw.ambiguity_note ?? raw.notes);

  return finalizeCandidate(candidate, input);
}

export function parseStructuredCsv(
  text: string,
  input: ContentBatchInput
): ParsedQuestionCandidate[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1)
    .map((values, index) => {
      const row: Record<string, string> = {};
      headers.forEach((header, headerIndex) => {
        row[header] = clean(values[headerIndex]);
      });

      return objectToCandidate(
        {
          source_question_number: valueByAliases(row, ["source_question_number", "question_number", "number"]) || String(index + 1),
          question_text: valueByAliases(row, ["question_text", "question", "english_question"]),
          option_a: valueByAliases(row, ["option_a", "a", "english_option_a"]),
          option_b: valueByAliases(row, ["option_b", "b", "english_option_b"]),
          option_c: valueByAliases(row, ["option_c", "c", "english_option_c"]),
          option_d: valueByAliases(row, ["option_d", "d", "english_option_d"]),
          answer: valueByAliases(row, ["answer", "correct_option", "source_correct_option"]),
          verified_answer: valueByAliases(row, ["verified_answer", "verified_correct_option"]),
          topic: valueByAliases(row, ["topic"]),
          difficulty: valueByAliases(row, ["difficulty"]),
          explanation: valueByAliases(row, ["explanation", "english_explanation"]),
          hindi_question: valueByAliases(row, ["hindi_question"]),
          hindi_option_a: valueByAliases(row, ["hindi_option_a", "ha"]),
          hindi_option_b: valueByAliases(row, ["hindi_option_b", "hb"]),
          hindi_option_c: valueByAliases(row, ["hindi_option_c", "hc"]),
          hindi_option_d: valueByAliases(row, ["hindi_option_d", "hd"]),
          hindi_explanation: valueByAliases(row, ["hindi_explanation"]),
          answer_verification: valueByAliases(row, ["answer_verification"]),
          confidence: valueByAliases(row, ["confidence"]),
          ambiguity_note: valueByAliases(row, ["ambiguity_note", "notes"])
        },
        input,
        index + 1
      );
    })
    .filter((candidate) => candidate.english.question_text.length > 0)
    .slice(0, input.maxQuestions);
}

export function parseStructuredJson(
  text: string,
  input: ContentBatchInput
): ParsedQuestionCandidate[] {
  const parsed = JSON.parse(text) as unknown;
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];

  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item, index) => objectToCandidate(item, input, index + 1))
    .filter((candidate) => candidate.english.question_text.length > 0)
    .slice(0, input.maxQuestions);
}

export function parseStructuredSource(
  text: string,
  mimeType: string,
  input: ContentBatchInput
): ParsedQuestionCandidate[] {
  if (mimeType === "text/csv" || /\.csv$/i.test(input.sourceName)) {
    return parseStructuredCsv(text, input);
  }

  if (mimeType === "application/json" || /\.json$/i.test(input.sourceName)) {
    return parseStructuredJson(text, input);
  }

  return parseStructuredTxt(text, input);
}
