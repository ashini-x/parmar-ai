export type AdmissionLookupResult<T> = PromiseSettledResult<T> | { status: "skipped" };

/**
 * Starts the independent Fatman-mode lookup while the authoritative suspension
 * check runs. Suspended/failed users keep the existing early-exit path and do
 * not wait for a mode lookup they do not need.
 */
export async function runSuspensionAndModeLookup<T>(
  checkSuspension: () => Promise<boolean>,
  loadMode: () => Promise<T>,
): Promise<{
  suspension: PromiseSettledResult<boolean>;
  mode: AdmissionLookupResult<T>;
}> {
  const modePromise: Promise<PromiseSettledResult<T>> = Promise.resolve()
    .then(loadMode)
    .then(
      (value): PromiseFulfilledResult<T> => ({ status: "fulfilled", value }),
      (reason): PromiseRejectedResult => ({ status: "rejected", reason }),
    );

  let suspension: PromiseSettledResult<boolean>;
  try {
    suspension = { status: "fulfilled", value: await checkSuspension() };
  } catch (reason) {
    suspension = { status: "rejected", reason };
  }

  if (suspension.status === "rejected" || suspension.value) {
    return { suspension, mode: { status: "skipped" } };
  }

  return { suspension, mode: await modePromise };
}

/**
 * Loads independent per-question context concurrently while retaining the
 * separate fallback behaviour of the profile and conversation reads.
 */
export async function loadQuestionContextInParallel<TProfile, TConversation>(
  loadProfile: () => Promise<TProfile>,
  loadRecentConversation: () => Promise<TConversation>,
  onProfileError: (error: unknown) => TProfile,
  onConversationError: (error: unknown) => TConversation,
): Promise<{ profile: TProfile; recentConversation: TConversation }> {
  const [profile, recentConversation] = await Promise.all([
    Promise.resolve().then(loadProfile).catch(onProfileError),
    Promise.resolve().then(loadRecentConversation).catch(onConversationError),
  ]);

  return { profile, recentConversation };
}
