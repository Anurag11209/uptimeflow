import type { Request, RequestHandler } from "express";
import type { ZodTypeAny } from "zod";
import { AppError } from "@backend-uptime/shared";
import type { ValidatedInput } from "../context.js";

export interface ValidationSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

/**
 * Parses params/query/body with zod and stores the *transformed* values on
 * req.validated (Express 5 exposes req.query as a getter, so it cannot be
 * reassigned in place). ZodErrors flow to the error handler as 400s.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      const validated: ValidatedInput = {};
      if (schemas.params) validated.params = schemas.params.parse(req.params);
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.body) validated.body = schemas.body.parse(req.body);
      req.validated = validated;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Typed accessor for values produced by validate(). */
export function getValidated<T>(req: Request, part: keyof ValidatedInput): T {
  const value = req.validated?.[part];
  if (value === undefined) {
    throw new AppError("internal_error", `validate() did not run for request ${part}.`);
  }
  return value as T;
}
