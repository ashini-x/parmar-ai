import { WorkerEntrypoint } from "cloudflare:workers";
import type { BrvinServiceEnv } from "./service-core";
import {
  getBrvinProjectStatusForClient,
  retrieveBrvinForClient,
} from "./service-core";

export interface BrvinServiceProps {
  clientId: string;
}

export class BrvinRetrievalApi extends WorkerEntrypoint<BrvinServiceEnv, BrvinServiceProps> {
  async getProjectStatus() {
    return getBrvinProjectStatusForClient(this.env, this.ctx.props?.clientId ?? "");
  }

  async retrieveProjectContext(input: { queries?: unknown; pageNumbers?: unknown }) {
    return retrieveBrvinForClient(this.env, this.ctx.props?.clientId ?? "", input);
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
