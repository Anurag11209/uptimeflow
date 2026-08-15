-- Add the `verified` column Better Auth's two-factor plugin expects on
-- TwoFactor rows.
--
-- The installed better-auth version (currently resolving to 1.6.18 per the
-- lockfile, ahead of the ^1.2.4 declared in package.json) writes and reads a
-- `verified` boolean on every TwoFactor record — see
-- node_modules/better-auth/dist/plugins/two-factor/index.mjs, which sets it
-- on setup and later checks `userTotpSecret.verified !== false` before
-- listing "totp" as an available method. This schema never had that column,
-- so `prisma.twoFactor.create()` fails with a validation error the moment
-- anyone tries to enable 2FA (PrismaClientValidationError: Unknown argument
-- `verified`), even though the request otherwise succeeds (correct password,
-- valid session).
--
-- Defaulting to false matches Better Auth's own fallback
-- (`existingTwoFactor?.verified !== false`) for any row inserted before this
-- migration — there shouldn't be any, since enable() has never succeeded
-- without this column, but the default keeps the migration safe regardless.

ALTER TABLE "two_factors" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
