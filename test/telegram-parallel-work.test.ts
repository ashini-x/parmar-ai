import { describe, expect, it } from "vitest";
import {
  loadQuestionContextInParallel,
  runSuspensionAndModeLookup,
} from "../src/telegram/parallel-work";

describe("parallel Telegram question work", () => {
  it("starts the Fatman-mode lookup while suspension is being checked", async () => {
    const started: string[] = [];
    let resolveSuspension!: (value: boolean) => void;
    let resolveMode!: (value: { active: boolean }) => void;
    const suspension = new Promise<boolean>((resolve) => { resolveSuspension = resolve; });
    const mode = new Promise<{ active: boolean }>((resolve) => { resolveMode = resolve; });

    const resultPromise = runSuspensionAndModeLookup(
      () => {
        started.push("suspension");
        return suspension;
      },
      () => {
        started.push("mode");
        return mode;
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["suspension", "mode"]);

    resolveSuspension(false);
    resolveMode({ active: true });
    await expect(resultPromise).resolves.toEqual({
      suspension: { status: "fulfilled", value: false },
      mode: { status: "fulfilled", value: { active: true } },
    });
  });

  it("does not make suspended users wait for the unnecessary mode lookup", async () => {
    let resolveSuspension!: (value: boolean) => void;
    let resolveMode!: (value: { active: boolean }) => void;
    const suspension = new Promise<boolean>((resolve) => { resolveSuspension = resolve; });
    const mode = new Promise<{ active: boolean }>((resolve) => { resolveMode = resolve; });

    const resultPromise = runSuspensionAndModeLookup(
      () => suspension,
      () => mode,
    );

    await Promise.resolve();
    await Promise.resolve();
    resolveSuspension(true);

    await expect(resultPromise).resolves.toEqual({
      suspension: { status: "fulfilled", value: true },
      mode: { status: "skipped" },
    });

    // The background lookup is still observed and cannot produce an
    // unhandled rejection if it settles after the early return.
    resolveMode({ active: false });
    await Promise.resolve();
  });

  it("preserves a Fatman-mode lookup failure as a distinct admission failure", async () => {
    const error = new Error("mode store unavailable");
    const result = await runSuspensionAndModeLookup(
      async () => false,
      async () => { throw error; },
    );

    expect(result.suspension).toEqual({ status: "fulfilled", value: false });
    expect(result.mode).toEqual({ status: "rejected", reason: error });
  });

  it("loads profile and conversation concurrently and keeps independent fallbacks", async () => {
    const started: string[] = [];
    let rejectProfile!: (reason: Error) => void;
    let resolveConversation!: (value: string[]) => void;
    const profileRead = new Promise<{ name: string }>((_resolve, reject) => { rejectProfile = reject; });
    const conversationRead = new Promise<string[]>((resolve) => { resolveConversation = resolve; });
    const fallbackErrors: string[] = [];

    const contextPromise = loadQuestionContextInParallel(
      () => {
        started.push("profile");
        return profileRead;
      },
      () => {
        started.push("conversation");
        return conversationRead;
      },
      (error) => {
        fallbackErrors.push("profile");
        expect(error).toBeInstanceOf(Error);
        return { name: "fallback" };
      },
      (error) => {
        fallbackErrors.push("conversation");
        expect(error).toBeInstanceOf(Error);
        return [];
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["profile", "conversation"]);

    rejectProfile(new Error("profile read failed"));
    resolveConversation(["recent turn"]);
    await expect(contextPromise).resolves.toEqual({
      profile: { name: "fallback" },
      recentConversation: ["recent turn"],
    });
    expect(fallbackErrors).toEqual(["profile"]);
  });
});
