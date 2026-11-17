import type { StudentProfile } from "../config/env";
import { isStudyProfileTopic } from "../core/profile-topics";

export interface StudentProfileUsage {
  dayCount: number;
  dailyLimit: number;
  unlimited: boolean;
}

function formatTargetExam(targetExam: string): string {
  const value = targetExam.trim();
  if (!value || /not specified|not selected/iu.test(value)) return "SSC · exam not selected";
  return value;
}

export function buildProfileText(profile: StudentProfile, usage: StudentProfileUsage): string {
  const recent = profile.recentTopics.filter(isStudyProfileTopic);
  const attention = profile.attentionTopics.filter(isStudyProfileTopic).slice(0, 3);
  const revision = profile.revisionQueue.filter(isStudyProfileTopic).slice(0, 3);
  const signals = profile.learningSignals
    .filter((item) => isStudyProfileTopic(item.topic) && item.confusionCount + item.weakCount > 0)
    .sort((a, b) => (b.confusionCount + b.weakCount) - (a.confusionCount + a.weakCount))
    .slice(0, 3);

  const recentVisible = recent.slice(0, 3);
  const remainingTopics = Math.max(0, recent.length - recentVisible.length);
  const today = usage.unlimited ? "Unlimited" : `${usage.dayCount}/${usage.dailyLimit}`;

  return [
    "**YOUR STUDY PROFILE**",
    `Target exam: **${formatTargetExam(profile.targetExam)}**`,
    "",
    "**PROGRESS**",
    `Questions tracked: **${profile.questionCount}**`,
    `Today: **${today}** ${usage.unlimited ? "AI access" : "questions"}`,
    "",
    "**RECENT STUDY TOPICS**",
    ...(recentVisible.length
      ? recentVisible.map((topic) => `• ${topic}`)
      : ["Your study topics will appear here as you practise."]),
    ...(remainingTopics > 0 ? [`+ ${remainingTopics} more topic${remainingTopics === 1 ? "" : "s"}`] : []),
    "",
    "**REVISION QUEUE**",
    revision.length ? revision.join(" · ") : "Your revision list is building from practice.",
    "",
    "**ATTENTION AREAS**",
    attention.length ? attention.join(" · ") : "No clear weak areas yet.",
    "",
    "**LEARNING INSIGHTS**",
    signals.length
      ? signals.map((item) => item.topic).join(" · ")
      : "More practice will help identify learning patterns.",
    "",
    "_Based on your study questions to परमार्थAI._",
  ].join("\n");
}
