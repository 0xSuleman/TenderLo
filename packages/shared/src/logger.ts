export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const payload = {
    level,
    message,
    ...context,
    timestamp: new Date().toISOString()
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (process.env.LOG_LEVEL === "debug") write("debug", message, context);
  },
  info(message: string, context?: LogContext): void {
    write("info", message, context);
  },
  warn(message: string, context?: LogContext): void {
    write("warn", message, context);
  },
  error(message: string, context?: LogContext): void {
    write("error", message, context);
  }
};
