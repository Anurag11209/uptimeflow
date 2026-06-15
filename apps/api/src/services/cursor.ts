import { AppError, decodeCursor, type Cursor } from "@backend-uptime/shared";

/** Decode a client-supplied cursor or 400 on garbage. */
export function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const cursor = decodeCursor(raw);
  if (!cursor) throw new AppError("bad_request", "Invalid pagination cursor.");
  return cursor;
}

/** Keyset condition for (createdAt, id) ascending order. */
export function afterCursorAsc(cursor: Cursor): {
  OR: [{ createdAt: { gt: Date } }, { createdAt: Date; id: { gt: string } }];
} {
  const createdAt = new Date(cursor.createdAt);
  return { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: cursor.id } }] };
}

/** Keyset condition for (createdAt, id) descending order. */
export function afterCursorDesc(cursor: Cursor): {
  OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
} {
  const createdAt = new Date(cursor.createdAt);
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }] };
}
