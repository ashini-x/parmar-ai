const NON_STUDY_TOPIC_LABELS = new Set([
  "general ssc doubt",
  "greeting",
  "greetings",
  "hello",
  "hi",
  "welcome",
  "thanks",
  "thank you",
  "small talk",
  "casual conversation",
  "general conversation",
]);

/**
 * Keep conversational labels out of the academic study profile.
 * These requests may still be answered by the bot, but they are not study topics.
 */
export function isStudyProfileTopic(topic: string): boolean {
  const normalized = topic.trim().replace(/\s+/gu, " ").replace(/[.!?]+$/gu, "").toLocaleLowerCase("en-US");
  return normalized.length > 0 && !NON_STUDY_TOPIC_LABELS.has(normalized);
}
