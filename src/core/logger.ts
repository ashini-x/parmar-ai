export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  requestId?: string;
  route?: string;
  [key: string]: unknown;
}

function write(
  level: LogLevel,
  message: string,
  context: LogContext = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: "sawalnewton",
    message,
    ...context
  };

  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) =>
    write("debug", message, context),
  info: (message: string, context?: LogContext) =>
    write("info", message, context),
  warn: (message: string, context?: LogContext) =>
    write("warn", message, context),
  error: (message: string, context?: LogContext) =>
    write("error", message, context)
};
