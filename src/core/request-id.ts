const REQUEST_ID_HEADER = "x-request-id";

export function getOrCreateRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (incoming && incoming.length <= 128) {
    return incoming;
  }

  return crypto.randomUUID();
}

export function addRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
