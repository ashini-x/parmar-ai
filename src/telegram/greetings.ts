const SIMPLE_GREETING_PATTERN = /^(?:hi+|hello+|he+y+|namaste|namaskar|good (?:morning|afternoon|evening))(?:\\s+there)?[.!?\\s🙏👋🙂😊]*$/iu;

/**
 * Match only a standalone greeting. Messages that contain an actual question
 * or study request must continue through the complete SSC pipeline.
 */
export function isSimpleGreeting(value: string): boolean {
  return SIMPLE_GREETING_PATTERN.test(value.trim());
}

export function buildSimpleGreetingReply(value: string): string {
  const normalized = value.trim().toLowerCase();
  const englishGreeting = /^(?:hi+|hello+|he+y+|good (?:morning|afternoon|evening))/u.test(normalized);
  return englishGreeting
    ? "Hey! 😊 Send me your SSC GA/GS doubt. I’ll get straight to the point."
    : "Namaste! 😊 SSC GA/GS ka doubt bhejo, seedha point pe aate hain!";
}
