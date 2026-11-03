import type { Env, ProfileContext } from "../config/env";
import { recordFatmanReleaseQaRun } from "../analytics/db";
import { generateGeminiAnswer } from "../ai/gemini";
import { retrieveFatmanQaContext } from "./retrieval";
import { runFatmanReleaseQa } from "./release-qa";

const QA_PROFILE: ProfileContext = {
  profile: {
    version: 2,
    targetExam: "SSC (release QA)",
    recentTopics: [],
    recentSubjects: [],
    attentionTopics: [],
    revisionQueue: [],
    learningSignals: [],
    questionCount: 0,
    lastUpdatedAt: 0,
  },
  recentTopicHint: "",
  attentionTopicHint: "",
  revisionHint: "",
  recentConversation: [],
};

export async function runFatmanReleaseQaForEnv(
  env: Env,
  runId: string,
): Promise<Awaited<ReturnType<typeof runFatmanReleaseQa>>> {
  const documentVersion = env.FATMAN_DOCUMENT_VERSION?.trim();
  if (!documentVersion) throw new Error("Fatman document version is not configured for release QA.");

  const report = await runFatmanReleaseQa({
    retrieve: (query) => retrieveFatmanQaContext(env, query),
    answer: async (question, context, repairHint) => {
      const generation = await generateGeminiAnswer(
        env,
        question,
        QA_PROFILE,
        [],
        undefined,
        repairHint ? { ...context, qaRepairHint: repairHint } : context,
      );
      return {
        answer: generation.packet.answer,
        estimatedCostMicrousd: generation.usage.reduce(
          (total, usage) => total + usage.estimatedCostMicrousd,
          0,
        ),
      };
    },
  }, { runId, documentVersion });

  await recordFatmanReleaseQaRun(env, report);
  return report;
}
