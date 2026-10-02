import type { ExecutionContext } from "@cloudflare/workers-types";

import { getConfig, type Env } from "./config/env";
import { logger } from "./core/logger";
import { addRequestId, getOrCreateRequestId } from "./core/request-id";
import { internalServerError, json, methodNotAllowed, notFound } from "./http/response";

function withRequestId(response: Response, requestId: string): Response {
  return addRequestId(response, requestId);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const url = new URL(request.url);
    const route = url.pathname;

    try {
      if (request.method === "GET" && route === "/health") {
        const config = getConfig(env);
        const response = json({
          ok: true,
          service: "parmar-ai",
          environment: config.environment,
          version: config.version,
          timestamp: new Date().toISOString()
        });

        logger.info("health_check", { requestId, route });
        return withRequestId(response, requestId);
      }

      if (request.method === "GET" && route === "/") {
        const response = json({
          ok: true,
          service: "parmar-ai",
          phase: "A",
          status: "foundation_ready"
        });

        return withRequestId(response, requestId);
      }

      if (route === "/health" || route === "/") {
        const response = methodNotAllowed(["GET"]);
        return withRequestId(response, requestId);
      }

      const response = notFound();
      return withRequestId(response, requestId);
    } catch (error) {
      logger.error("unhandled_request_error", {
        requestId,
        route,
        error: error instanceof Error ? error.message : String(error)
      });

      return withRequestId(internalServerError(), requestId);
    }
  }
} satisfies ExportedHandler<Env>;
