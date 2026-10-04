import type {
  ExecutionContext,
  ExportedHandler
} from "@cloudflare/workers-types";

import type { Env } from "./config/env";
import { getConfig } from "./config/env";
import { logger } from "./core/logger";
import {
  addRequestId,
  getOrCreateRequestId
} from "./core/request-id";
import {
  internalServerError,
  json,
  methodNotAllowed,
  notFound
} from "./http/response";
import { getMiniAppHtml } from "./mini-app";
import {
  authenticateWebAppUser,
  isLanguage,
  setUserLanguage
} from "./users/user-service";
import {
  startMathsTest,
  submitMathsTest,
  type SubmittedAnswer
} from "./tests/test-service";
import { getContentAdminHtml } from "./admin/content-page";
import { getContentAdminScript } from "./admin/content-script";
import {
  approveCandidates,
  backfillQuestionFingerprints,
  enhanceCandidatesWithGemini,
  listBatches,
  listCandidates,
  processContentUpload
} from "./content/content-service";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_REQUEST_TIMEOUT_MS = 8_000;

interface TelegramMessage {
  chat?: {
    id?: number;
  };
  text?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

function withRequestId(
  response: Response,
  requestId: string
): Response {
  return addRequestId(response, requestId);
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) return false;

  let result = 0;

  for (let index = 0; index < aBytes.length; index += 1) {
    result |= aBytes[index] ^ bBytes[index];
  }

  return result === 0;
}

function jsonResponse(
  body: unknown,
  status = 200,
  requestId?: string
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=UTF-8",
    "cache-control": "no-store"
  };

  if (requestId) headers["x-request-id"] = requestId;

  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

function isAdminAuthorized(
  request: Request,
  env: Env
): boolean {
  const configured =
    env.ADMIN_SECRET?.trim();

  if (!configured) return false;

  const received =
    request.headers.get("X-Admin-Secret") ??
    "";

  return safeEqual(
    received,
    configured
  );
}

async function telegramApi<T = unknown>(
  env: Env,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    throw new Error("Telegram bot token is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TELEGRAM_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );

    const raw = await response.text();

    let data: TelegramApiResponse<T>;

    try {
      data = JSON.parse(raw) as TelegramApiResponse<T>;
    } catch {
      throw new Error(
        `Telegram returned invalid JSON (HTTP ${response.status}).`
      );
    }

    if (!response.ok || !data.ok) {
      throw new Error(
        data.description ??
          `Telegram API request failed (HTTP ${response.status}).`
      );
    }

    return data.result as T;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `Telegram API timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms.`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  const chunks = splitMessage(text, TELEGRAM_MAX_MESSAGE_LENGTH);

  for (const chunk of chunks) {
    await telegramApi(env, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });
  }
}

function splitMessage(
  text: string,
  maxLength: number
): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);

    if (splitAt < 500) {
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }

    if (splitAt < 500) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }

    if (splitAt < 1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);

  return chunks;
}

async function setupTelegramWebhook(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return jsonResponse(
      { ok: false, error: "telegram_bot_token_missing" },
      500,
      requestId
    );
  }

  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return jsonResponse(
      { ok: false, error: "telegram_webhook_secret_missing" },
      500,
      requestId
    );
  }

  const setupUrl = new URL(request.url);
  const providedSecret = setupUrl.searchParams.get("key");

  if (
    !providedSecret ||
    !env.TELEGRAM_SETUP_SECRET ||
    !safeEqual(providedSecret, env.TELEGRAM_SETUP_SECRET)
  ) {
    return jsonResponse(
      { ok: false, error: "unauthorized" },
      401,
      requestId
    );
  }

  const webhookUrl = `${setupUrl.origin}/telegram/webhook`;

  const telegramData = await telegramApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false
  });

  logger.info("telegram_webhook_setup", {
    requestId,
    webhookUrl
  });

  return jsonResponse(
    {
      ok: true,
      telegram: {
        ok: true,
        result: telegramData
      },
      webhook: webhookUrl
    },
    200,
    requestId
  );
}

async function handleTelegramWebhook(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response(
      "Telegram configuration is incomplete.",
      { status: 500 }
    );
  }

  const receivedSecret = request.headers.get(
    "X-Telegram-Bot-Api-Secret-Token"
  );

  if (
    !receivedSecret ||
    !safeEqual(receivedSecret, env.TELEGRAM_WEBHOOK_SECRET)
  ) {
    logger.error("telegram_webhook_unauthorized", {
      requestId
    });

    return new Response("Unauthorized.", { status: 401 });
  }

  let update: TelegramUpdate;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("Invalid webhook payload.", {
      status: 400
    });
  }

  const message = update.message;

  if (!message?.chat?.id) {
    return new Response("OK", { status: 200 });
  }

  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";

  logger.info("telegram_message_received", {
    requestId,
    chatId: String(chatId),
    updateId: update.update_id,
    textLength: text.length
  });

  if (!text) {
    await sendTelegramMessage(
      env,
      chatId,
      "🧠 SawalNewton abhi test mode mein hai. /start bhejo."
    );

    return new Response("OK", { status: 200 });
  }

  if (text === "/start" || text.startsWith("/start ")) {
    const miniAppUrl = `${new URL(request.url).origin}/app`;

    await sendTelegramMessage(
      env,
      chatId,
      "🧠 SawalNewton\n\n" +
        "SSC questions. Random tests. Let's see kitna dum hai.\n\n" +
        "Ready?",
      {
        inline_keyboard: [
          [
            {
              text: "🧠 Start Test",
              web_app: { url: miniAppUrl }
            }
          ]
        ]
      }
    );

    return new Response("OK", { status: 200 });
  }

  await sendTelegramMessage(
    env,
    chatId,
    "🧠 SawalNewton abhi test mode mein hai. /start bhejo aur test shuru karo."
  );

  return new Response("OK", { status: 200 });
}

function normalizeSubmittedAnswers(
  value: unknown
): SubmittedAnswer[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid_answers");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("invalid_answer_item");
    }

    const record = item as Record<string, unknown>;
    const questionId = Number(record.questionId);

    if (!Number.isInteger(questionId)) {
      throw new Error("invalid_question_id");
    }

    const selectedOption =
      record.selectedOption === null ||
      record.selectedOption === undefined
        ? null
        : String(record.selectedOption);

    return {
      questionId,
      selectedOption
    };
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const url = new URL(request.url);
    const route = url.pathname;

    try {
      if (request.method === "GET" && route === "/health") {
        const config = getConfig(env);

        return withRequestId(
          json({
            ok: true,
            service: "sawalnewton",
            version: config.version,
            environment: config.environment,
            timestamp: new Date().toISOString(),
            telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
            database: Boolean(env.DB)
          }),
          requestId
        );
      }

      if (request.method === "GET" && route === "/") {
        return withRequestId(
          json({
            ok: true,
            service: "sawalnewton",
            status: "test_mvp"
          }),
          requestId
        );
      }

      if (request.method === "GET" && route === "/app") {
        return withRequestId(
          new Response(getMiniAppHtml(), {
            status: 200,
            headers: {
              "content-type": "text/html; charset=UTF-8",
              "cache-control": "no-store"
            }
          }),
          requestId
        );
      }

      if (
        request.method === "GET" &&
        route === "/api/user/preferences"
      ) {
        const initData = request.headers.get("x-telegram-init-data") ?? "";

        try {
          const { user } = await authenticateWebAppUser(env, initData);

          return withRequestId(
            jsonResponse(
              {
                ok: true,
                language: user.language
              },
              200,
              requestId
            ),
            requestId
          );
        } catch (error) {
          return withRequestId(
            jsonResponse(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "user_preferences_failed"
              },
              400,
              requestId
            ),
            requestId
          );
        }
      }

      if (
        request.method === "POST" &&
        route === "/api/user/preferences"
      ) {
        let body: {
          initData?: string;
          language?: unknown;
        };

        try {
          body = (await request.json()) as {
            initData?: string;
            language?: unknown;
          };
        } catch {
          return withRequestId(
            jsonResponse(
              { ok: false, error: "invalid_json" },
              400,
              requestId
            ),
            requestId
          );
        }

        if (!isLanguage(body.language)) {
          return withRequestId(
            jsonResponse(
              {
                ok: false,
                error: "unsupported_language"
              },
              400,
              requestId
            ),
            requestId
          );
        }

        try {
          const { user } = await authenticateWebAppUser(
            env,
            body.initData ?? ""
          );

          await setUserLanguage(
            env,
            user.id,
            body.language
          );

          return withRequestId(
            jsonResponse(
              {
                ok: true,
                language: body.language
              },
              200,
              requestId
            ),
            requestId
          );
        } catch (error) {
          return withRequestId(
            jsonResponse(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "user_language_update_failed"
              },
              400,
              requestId
            ),
            requestId
          );
        }
      }


      if (
        request.method === "GET" &&
        route === "/admin/content.js"
      ) {
        return withRequestId(
          new Response(getContentAdminScript(), {
            status: 200,
            headers: {
              "content-type": "application/javascript; charset=UTF-8",
              "cache-control": "no-store"
            }
          }),
          requestId
        );
      }

      if (
        request.method === "GET" &&
        route === "/admin/content"
      ) {
        return withRequestId(
          new Response(
            getContentAdminHtml(),
            {
              status: 200,
              headers: {
                "content-type":
                  "text/html; charset=UTF-8",
                "cache-control":
                  "no-store"
              }
            }
          ),
          requestId
        );
      }

      if (
        route.startsWith("/api/admin/content/")
      ) {
        if (!isAdminAuthorized(request, env)) {
          return withRequestId(
            jsonResponse(
              {
                ok: false,
                error: "admin_unauthorized"
              },
              401,
              requestId
            ),
            requestId
          );
        }

        if (
          request.method === "GET" &&
          route === "/api/admin/content/candidates"
        ) {
          const status =
            new URL(request.url)
              .searchParams
              .get("status");

          const limit =
            new URL(request.url)
              .searchParams
              .get("limit");

          const result =
            await listCandidates(
              env,
              status,
              Number(limit || 100)
            );

          return withRequestId(
            jsonResponse(
              {
                ok: true,
                candidates:
                  result.results
              },
              200,
              requestId
            ),
            requestId
          );
        }

        if (
          request.method === "GET" &&
          route === "/api/admin/content/batches"
        ) {
          const limit =
            new URL(request.url)
              .searchParams
              .get("limit");

          const result =
            await listBatches(
              env,
              Number(limit || 50)
            );

          return withRequestId(
            jsonResponse(
              {
                ok: true,
                batches:
                  result.results
              },
              200,
              requestId
            ),
            requestId
          );
        }

        if (
          request.method === "POST" &&
          route === "/api/admin/content/ingest"
        ) {
          let form: FormData;

          try {
            form =
              await request.formData();
          } catch {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error: "invalid_multipart_form"
                },
                400,
                requestId
              ),
              requestId
            );
          }

          const file =
            form.get("file");

          if (!(file instanceof File)) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error: "file_missing"
                },
                400,
                requestId
              ),
              requestId
            );
          }

          try {
            const result =
              await processContentUpload(
                env,
                {
                  sourceName: String(
                    form.get("source_name") ??
                      ""
                  ),
                  exam: String(
                    form.get("exam") ??
                      ""
                  ),
                  tier: String(
                    form.get("tier") ??
                      ""
                  ),
                  year: Number(
                    form.get("year")
                  ),
                  shift: String(
                    form.get("shift") ??
                      ""
                  ),
                  subject: String(
                    form.get("subject") ??
                      ""
                  ),
                  maxQuestions: Number(
                    form.get(
                      "max_questions"
                    )
                  ),
                  file,
                  mode:
                    String(
                      form.get("mode") ??
                        "deterministic"
                    ) === "ai"
                      ? "ai"
                      : "deterministic"
                }
              );

            return withRequestId(
              jsonResponse(
                {
                  ok: true,
                  summary: result
                },
                200,
                requestId
              ),
              requestId
            );
          } catch (error) {
            logger.error(
              "content_ingest_failed",
              {
                requestId,
                error:
                  error instanceof Error
                    ? error.message
                    : String(error)
              }
            );

            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "content_ingest_failed"
                },
                400,
                requestId
              ),
              requestId
            );
          }
        }


        if (
          request.method === "POST" &&
          route === "/api/admin/content/enhance"
        ) {
          let body: {
            candidateIds?: unknown;
          };

          try {
            body =
              (await request.json()) as {
                candidateIds?: unknown;
              };
          } catch {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error: "invalid_json"
                },
                400,
                requestId
              ),
              requestId
            );
          }

          if (!Array.isArray(body.candidateIds)) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error: "candidate_ids_required"
                },
                400,
                requestId
              ),
              requestId
            );
          }

          const ids = body.candidateIds
            .map(Number)
            .filter(
              (id) => Number.isInteger(id) && id > 0
            )
            .slice(0, 25);

          if (!ids.length) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error: "no_candidate_ids"
                },
                400,
                requestId
              ),
              requestId
            );
          }

          try {
            const result =
              await enhanceCandidatesWithGemini(
                env,
                ids
              );

            return withRequestId(
              jsonResponse(
                {
                  ok: true,
                  result
                },
                200,
                requestId
              ),
              requestId
            );
          } catch (error) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "content_enhancement_failed"
                },
                400,
                requestId
              ),
              requestId
            );
          }
        }

        if (
          request.method === "POST" &&
          route === "/api/admin/content/backfill"
        ) {
          try {
            const result =
              await backfillQuestionFingerprints(
                env
              );

            return withRequestId(
              jsonResponse(
                {
                  ok: true,
                  result
                },
                200,
                requestId
              ),
              requestId
            );
          } catch (error) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "fingerprint_backfill_failed"
                },
                400,
                requestId
              ),
              requestId
            );
          }
        }

        if (
          request.method === "POST" &&
          route === "/api/admin/content/publish-ready"
        ) {
          try {
            const candidates =
              await listCandidates(
                env,
                "auto_ready",
                100
              );

            const ids = candidates.results
              .map((candidate) =>
                Number(
                  (candidate as { id: number }).id
                )
              )
              .filter(
                (id) =>
                  Number.isInteger(id) &&
                  id > 0
              );

            if (ids.length === 0) {
              return withRequestId(
                jsonResponse(
                  {
                    ok: true,
                    result: {
                      approved: 0,
                      duplicates: 0,
                      failed: 0
                    }
                  },
                  200,
                  requestId
                ),
                requestId
              );
            }

            const result =
              await approveCandidates(
                env,
                ids
              );

            return withRequestId(
              jsonResponse(
                {
                  ok: true,
                  result,
                  attempted: ids.length
                },
                200,
                requestId
              ),
              requestId
            );
          } catch (error) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "publish_ready_failed"
                },
                400,
                requestId
              ),
              requestId
            );
          }
        }

        if (
          request.method === "POST" &&
          route === "/api/admin/content/approve"
        ) {
          let body: {
            candidateIds?: unknown;
          };

          try {
            body =
              (await request.json()) as {
                candidateIds?: unknown;
              };
          } catch {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error: "invalid_json"
                },
                400,
                requestId
              ),
              requestId
            );
          }

          if (
            !Array.isArray(
              body.candidateIds
            )
          ) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error:
                    "candidate_ids_required"
                },
                400,
                requestId
              ),
              requestId
            );
          }

          const ids = body.candidateIds
            .map(Number)
            .filter(
              (id) =>
                Number.isInteger(id) &&
                id > 0
            );

          try {
            const result =
              await approveCandidates(
                env,
                ids
              );

            return withRequestId(
              jsonResponse(
                {
                  ok: true,
                  result
                },
                200,
                requestId
              ),
              requestId
            );
          } catch (error) {
            return withRequestId(
              jsonResponse(
                {
                  ok: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "content_approval_failed"
                },
                400,
                requestId
              ),
              requestId
            );
          }
        }

        return withRequestId(
          notFound(),
          requestId
        );
      }

      if (request.method === "GET" && route === "/db-test") {
        if (!env.DB) {
          return withRequestId(
            jsonResponse(
              { ok: false, error: "d1_binding_missing" },
              500,
              requestId
            ),
            requestId
          );
        }

        const result = await env.DB
          .prepare(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table'
             ORDER BY name`
          )
          .all<{ name: string }>();

        return withRequestId(
          jsonResponse(
            { ok: true, tables: result.results },
            200,
            requestId
          ),
          requestId
        );
      }

      if (
        request.method === "POST" &&
        route === "/api/test/start"
      ) {
        let body: { initData?: string };

        try {
          body = (await request.json()) as {
            initData?: string;
          };
        } catch {
          return withRequestId(
            jsonResponse(
              { ok: false, error: "invalid_json" },
              400
            ),
            requestId
          );
        }

        try {
          const result = await startMathsTest(
            env,
            body.initData ?? ""
          );

          return withRequestId(
            jsonResponse({
              ok: true,
              attemptId: result.attemptId,
              startedAt: result.startedAt,
              durationSeconds: result.durationSeconds,
              totalQuestions: result.totalQuestions,
              questions: result.questions
            }),
            requestId
          );
        } catch (error) {
          logger.error("test_start_failed", {
            requestId,
            error:
              error instanceof Error
                ? error.message
                : String(error)
          });

          const status =
            error instanceof Error &&
            error.message.startsWith("not_enough_questions:")
              ? 409
              : error instanceof Error &&
                  error.message === "language_not_set"
                ? 409
                : 400;

          return withRequestId(
            jsonResponse(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "test_start_failed"
              },
              status
            ),
            requestId
          );
        }
      }

      if (
        request.method === "POST" &&
        route === "/api/test/submit"
      ) {
        let body: {
          initData?: string;
          attemptId?: number;
          answers?: unknown;
        };

        try {
          body = (await request.json()) as {
            initData?: string;
            attemptId?: number;
            answers?: unknown;
          };
        } catch {
          return withRequestId(
            jsonResponse(
              { ok: false, error: "invalid_json" },
              400
            ),
            requestId
          );
        }

        try {
          const attemptId = Number(body.attemptId);

          if (!Number.isInteger(attemptId) || attemptId <= 0) {
            throw new Error("invalid_attempt_id");
          }

          const answers = normalizeSubmittedAnswers(
            body.answers
          );

          const result = await submitMathsTest(
            env,
            body.initData ?? "",
            attemptId,
            answers
          );

          return withRequestId(
            jsonResponse({
              ok: true,
              ...result
            }),
            requestId
          );
        } catch (error) {
          logger.error("test_submit_failed", {
            requestId,
            error:
              error instanceof Error
                ? error.message
                : String(error)
          });

          const message =
            error instanceof Error
              ? error.message
              : "test_submit_failed";

          const status =
            message === "attempt_not_found"
              ? 404
              : message === "attempt_already_finished"
                ? 409
                : 400;

          return withRequestId(
            jsonResponse(
              {
                ok: false,
                error: message
              },
              status
            ),
            requestId
          );
        }
      }

      if (
        request.method === "GET" &&
        route === "/telegram/setup" ||
        route === "/admin/content" ||
        route.startsWith("/api/admin/content/")
      ) {
        return setupTelegramWebhook(
          request,
          env,
          requestId
        );
      }

      if (route === "/telegram/webhook") {
        if (request.method !== "POST") {
          return withRequestId(
            methodNotAllowed(["POST"]),
            requestId
          );
        }

        return handleTelegramWebhook(
          request,
          env,
          requestId
        );
      }

      if (
        route === "/health" ||
        route === "/" ||
        route === "/app" ||
        route.startsWith("/api/test/") ||
        route.startsWith("/api/user/") ||
        route === "/telegram/setup"
      ) {
        return withRequestId(
          methodNotAllowed(["GET", "POST"]),
          requestId
        );
      }

      return withRequestId(notFound(), requestId);
    } catch (error) {
      logger.error("unhandled_request_error", {
        requestId,
        route,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      });

      return withRequestId(
        internalServerError(),
        requestId
      );
    }
  }
} satisfies ExportedHandler<Env>;
