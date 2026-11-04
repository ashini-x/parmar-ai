import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../config/env";
import {
  getBrvinProjectStatusForClient,
  retrieveBrvinForClient,
} from "./service-core";

export type BrvinServiceEnv = Pick<
  Env,
  | "DB"
  | "FATMAN_SEARCH"
  | "FATMAN_INSTANCE_NAME"
  | "FATMAN_MIN_SCORE"
  | "FATMAN_MONTHLY_QUERY_LIMIT"
  | "BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT"
>;

export interface BrvinServiceProps {
  clientId: string;
}

export class BrvinRetrievalApi extends WorkerEntrypoint<BrvinServiceEnv, BrvinServiceProps> {
  async getProjectStatus() {
    return getBrvinProjectStatusForClient(this.env as Env, this.ctx.props?.clientId ?? "");
  }

  async retrieveProjectContext(input: { queries?: unknown }) {
    return retrieveBrvinForClient(this.env as Env, this.ctx.props?.clientId ?? "", input);
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
