const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export function json<T>(
  body: T,
  status = 200,
  extraHeaders?: HeadersInit
): Response {
  const headers = new Headers(JSON_HEADERS);

  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(
    {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Method not allowed"
    },
    405,
    { allow: allowed.join(", ") }
  );
}

export function notFound(): Response {
  return json(
    {
      ok: false,
      error: "NOT_FOUND",
      message: "Route not found"
    },
    404
  );
}

export function internalServerError(): Response {
  return json(
    {
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong"
    },
    500
  );
}
