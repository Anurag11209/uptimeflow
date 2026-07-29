-- Widen monitor_daily_stats.uptimePct so a perfect day fits.
--
-- DECIMAL(6,4) holds 6 significant digits with 4 after the point, i.e. a
-- maximum of 99.9999 — so 100.0000 raises a numeric-overflow error. The column
-- is NOT NULL with no default, so every rollup insert must supply a value, and
-- a monitor that was up all day is the common case rather than the edge case.
-- DECIMAL(7,4) keeps the same 4-decimal resolution and admits 100.0000.
--
-- Safe to run in place: nothing has ever written to this table (the rollup
-- writer is introduced in the same change as this migration), and widening a
-- numeric's precision is a metadata-only operation that never rewrites rows.

ALTER TABLE "monitor_daily_stats" ALTER COLUMN "uptimePct" TYPE DECIMAL(7,4);
