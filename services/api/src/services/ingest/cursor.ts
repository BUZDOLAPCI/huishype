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

export function isOpaqueIngestCursor(cursor: string): boolean {
  try {
    decodeOpaqueIngestCursor(cursor);
    return true;
  } catch {
    return false;
  }
}
