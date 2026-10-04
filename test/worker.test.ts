import { describe, expect, it } from "vitest";
import worker from "../src";

const request = (url: string, init?: RequestInit) =>
  new Request(url, init);

describe("SawalNewton Worker", () => {
  it("returns a healthy JSON response", async () => {
    const response = await worker.fetch(
      request("http://example.com/health"),
      {} as never,
      {} as never
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = (await response.json()) as {
      ok: boolean;
      service: string;
    };

    expect(body.ok).toBe(true);
    expect(body.service).toBe("sawalnewton");
  });

  it("serves the Mini App", async () => {
    const response = await worker.fetch(
      request("http://example.com/app"),
      {} as never,
      {} as never
    );

    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain("SawalNewton");
    expect(body).toContain("Start Test");
  });

  it("returns 404 for an unknown route", async () => {
    const response = await worker.fetch(
      request("http://example.com/not-a-route"),
      {} as never,
      {} as never
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
