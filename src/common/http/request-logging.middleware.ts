import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const logger = new Logger("HTTP");

/**
 * One structured line per request. Logs the route pattern, never the query
 * string, headers or body, so tokens and personal data stay out of logs.
 */
export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : "(unmatched)";
    logger.log({
      msg: "request",
      requestId: req.id,
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      userId: req.user?.id,
    });
  });
  next();
}
