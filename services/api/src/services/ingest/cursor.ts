import { z } from 'zod';

const ingestCursorPayloadSchema = z.object({
  changedAt: z.string().datetime(),
  listingKey: z.string().min(1),
});

export type IngestCursorPayload = z.infer<typeof ingestCursorPayloadSchema>;

export function encodeOpaqueIngestCursor(payload: IngestCursorPayload): string {
  const normalized = ingestCursorPayloadSchema.parse(payload);
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
}

export function decodeOpaqueIngestCursor(cursor: string): IngestCursorPayload {
  let decoded: string;

  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new Error('Cursor is not valid base64url');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('Cursor is not valid JSON');
  }

  return ingestCursorPayloadSchema.parse(parsed);
}

export function compareIngestCursorPayloads(left: IngestCursorPayload, right: IngestCursorPayload): number {
  const leftChangedAt = new Date(left.changedAt).getTime();
  const rightChangedAt = new Date(right.changedAt).getTime();

  if (leftChangedAt !== rightChangedAt) {
    return leftChangedAt < rightChangedAt ? -1 : 1;
  }

  if (left.listingKey === right.listingKey) {
    return 0;
  }

  return left.listingKey < right.listingKey ? -1 : 1;
}

export function compareOpaqueIngestCursors(left: string, right: string): number {
  return compareIngestCursorPayloads(
    decodeOpaqueIngestCursor(left),
    decodeOpaqueIngestCursor(right),
  );
}

export function isOpaqueIngestCursorAtOrBefore(candidate: string, watermark: string): boolean {
  return compareOpaqueIngestCursors(candidate, watermark) <= 0;
}

export function isOpaqueIngestCursor(cursor: string): boolean {
  try {
    decodeOpaqueIngestCursor(cursor);
    return true;
  } catch {
    return false;
  }
}
