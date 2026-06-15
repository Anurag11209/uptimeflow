import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@backend-uptime/db";
import { AppError, type ApiErrorBody } from "@backend-uptime/shared";
import type { Logger } from "../telemetry.js";

export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(AppError.notFound(`Route ${req.method} ${req.path} does not exist.`));
  };
}

/**
 * Single edge for error → HTTP translation. Every response is the stable
 * ApiErrorBody envelope; 5xx details are masked and logged with requestId.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const appError = toAppError(err);
    if (appError.status >= 500) {
      logger.error({ err, requestId: req.requestId, path: req.path }, "request failed");
    }

    const body: ApiErrorBody = {
      error: {
        code: appError.code,
        message: appError.expose ? appError.message : "Internal server error.",
        requestId: req.requestId,
        ...(appError.expose && appError.details !== undefined ? { details: appError.details } : {}),
      },
    };
    res.status(appError.status).json(body);
  };
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError("validation_failed", "Request validation failed.", {
      details: err.flatten(),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return AppError.conflict("A resource with these unique values already exists.");
    }
    if (err.code === "P2025") return AppError.notFound();
    return new AppError("internal_error", "Database error.", { cause: err });
  }

  // express.json() body parse failures carry a status.
  if (isHttpError(err) && err.status >= 400 && err.status < 500) {
    return new AppError("bad_request", err.message || "Malformed request body.", {
      status: err.status,
    });
  }

  return new AppError("internal_error", "Internal server error.", { cause: err });
}

function isHttpError(err: unknown): err is Error & { status: number } {
  return (
    err instanceof Error && typeof (err as Error & { status?: unknown }).status === "number"
  );
}
