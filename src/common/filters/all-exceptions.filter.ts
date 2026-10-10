import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { PostgresErrorCode } from "../../database/postgres-error-codes.js";

const BAD_INPUT_CODES = new Set<string>([
  PostgresErrorCode.ForeignKeyViolation,
  PostgresErrorCode.CheckViolation,
  PostgresErrorCode.InvalidDatetimeFormat,
  PostgresErrorCode.DatetimeFieldOverflow,
]);

/**
 * Single error contract: `{ statusCode, message, requestId }`.
 * Raw SQL errors, stack traces and credentials never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse();
    const request = http.getRequest<Request>();
    const requestId = request.id ?? randomUUID();
    const { status, message } = this.translate(exception);
    if (status === HttpStatus.INTERNAL_SERVER_ERROR)
      this.logger.error({
        msg: "unhandled error",
        requestId,
        method: request.method,
        type:
          exception instanceof Error
            ? exception.constructor.name
            : "UnknownError",
        // SQLSTATE only: never the message, which can contain values.
        code: (exception as { code?: string } | null)?.code,
      });
    response.status(status).json({ statusCode: status, message, requestId });
  }

  private translate(exception: unknown): { status: number; message: unknown } {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      return {
        status: exception.getStatus(),
        message:
          typeof body === "string"
            ? body
            : (body as { message?: unknown }).message,
      };
    }
    const code = (exception as { code?: string } | null)?.code;
    if (code === PostgresErrorCode.UniqueViolation)
      return {
        status: HttpStatus.CONFLICT,
        message: "A matching record already exists",
      };
    if (code && BAD_INPUT_CODES.has(code))
      return {
        status: HttpStatus.BAD_REQUEST,
        message: "Invalid record reference or values",
      };
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    };
  }
}
