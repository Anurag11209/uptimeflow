import { z } from "zod";

/** Opaque, URL-safe cursor: base64url(JSON({ id, createdAt })). */
export interface Cursor {
  id: string;
  createdAt: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const result = z.object({ id: z.string().min(1), createdAt: z.string().min(1) }).safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Build a page from `limit + 1` fetched rows: trims the sentinel row and
 * derives the next cursor from the last visible item.
 */
export function buildPage<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() }) : null,
  };
}
