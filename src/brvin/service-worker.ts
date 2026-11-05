import { WorkerEntrypoint } from "cloudflare:workers";
import type { BrvinServiceEnv } from "./service-core";
import {
  getBrvinProjectStatusForClient,
  retrieveBrvinForClient,
  listAuthorizedProjectsV2,
  getBrvinProjectStatusV2,
  retrieveBrvinForApplicationV2,
  proveBrvinConnectionV2,
} from "./service-core";

export interface BrvinServiceProps {
  /** Legacy v1 identity. Used only by the explicitly versioned v1 methods. */
  clientId?: string;
  /** Trusted same-account Worker deployment identity for v2 methods. */
  applicationEnvironmentId?: string;
}

export class BrvinRetrievalApi extends WorkerEntrypoint<BrvinServiceEnv, BrvinServiceProps> {
  async getProjectStatus() {
    return getBrvinProjectStatusForClient(this.env, this.ctx.props?.clientId ?? "");
  }

  async retrieveProjectContext(input: { queries?: unknown; pageNumbers?: unknown }) {
    return retrieveBrvinForClient(this.env, this.ctx.props?.clientId ?? "", input);
  }

  async listAuthorizedProjectsV2() {
    return listAuthorizedProjectsV2(this.env, this.ctx.props?.applicationEnvironmentId ?? "");
  }

  async getProjectStatusV2(input: unknown) {
    return getBrvinProjectStatusV2(
      this.env,
      this.ctx.props?.applicationEnvironmentId ?? "",
      input,
    );
  }

  async retrieveProjectContextV2(input: unknown) {
    return retrieveBrvinForApplicationV2(
      this.env,
      this.ctx.props?.applicationEnvironmentId ?? "",
      input,
    );
  }

  async proveConnectionV2(input: unknown) {
    return proveBrvinConnectionV2(
      this.env,
      this.ctx.props?.applicationEnvironmentId ?? "",
      input,
    );
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
