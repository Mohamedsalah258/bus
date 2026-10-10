import { LoggerService, LogLevel } from "@nestjs/common";

type Level = Exclude<LogLevel, "fatal"> | "fatal";

/**
 * Newline-delimited JSON to stdout, ready for any log shipper.
 * Objects passed as the message are merged into the line.
 */
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string) {
    this.write("info", message, context);
  }
  error(message: unknown, _trace?: string, context?: string) {
    // Stack traces are intentionally dropped: they can embed SQL or values.
    this.write("error", message, context);
  }
  warn(message: unknown, context?: string) {
    this.write("warn", message, context);
  }
  debug(message: unknown, context?: string) {
    this.write("debug", message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write("verbose", message, context);
  }
  fatal(message: unknown, context?: string) {
    this.write("fatal", message, context);
  }

  private write(level: Level | "info", message: unknown, context?: string) {
    const body =
      message && typeof message === "object"
        ? (message as Record<string, unknown>)
        : { msg: String(message) };
    process.stdout.write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        context,
        ...body,
      }) + "\n",
    );
  }
}
