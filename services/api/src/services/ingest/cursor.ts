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

  const replayComparison = compareGeneratedFullMirrorReplayKeys(left.listingKey, right.listingKey);
  if (replayComparison !== null) {
    return replayComparison;
  }

  return left.listingKey < right.listingKey ? -1 : 1;
}

export function compareOpaqueIngestCursors(left: string, right: string): number {
  return compareIngestCursorPayloads(
    decodeOpaqueIngestCursor(left),
    decodeOpaqueIngestCursor(right),
  );
}

export function opaqueIngestCursorsEqual(left: string, right: string): boolean {
  if (left === right) return true;

  try {
    return compareOpaqueIngestCursors(left, right) === 0;
  } catch {
    return false;
  }
}

export function isOpaqueIngestCursorAtOrBefore(candidate: string, watermark: string): boolean {
  return compareOpaqueIngestCursors(candidate, watermark) <= 0;
}

export function isOpaqueIngestCursorRangeAtOrBefore(
  candidate: { cursorStart: string | null; cursorEnd: string },
  watermark: string,
): boolean {
  return (
    (candidate.cursorStart === null || isOpaqueIngestCursorAtOrBefore(candidate.cursorStart, watermark))
    && isOpaqueIngestCursorAtOrBefore(candidate.cursorEnd, watermark)
  );
}

export function isOpaqueIngestCursor(cursor: string): boolean {
  try {
    decodeOpaqueIngestCursor(cursor);
    return true;
  } catch {
    return false;
  }
}

const generatedFullMirrorReplayKeyPattern = /^([^:]+):full-mirror:(\d+):(\d+)$/;

function compareGeneratedFullMirrorReplayKeys(left: string, right: string): number | null {
  const leftMatch = generatedFullMirrorReplayKeyPattern.exec(left);
  const rightMatch = generatedFullMirrorReplayKeyPattern.exec(right);

  if (!leftMatch || !rightMatch || leftMatch[1] !== rightMatch[1]) {
    return null;
  }

  const leftSequence = BigInt(leftMatch[2] as string);
  const rightSequence = BigInt(rightMatch[2] as string);
  if (leftSequence !== rightSequence) {
    return leftSequence < rightSequence ? -1 : 1;
  }

  const leftOffset = BigInt(leftMatch[3] as string);
  const rightOffset = BigInt(rightMatch[3] as string);
  if (leftOffset !== rightOffset) {
    return leftOffset < rightOffset ? -1 : 1;
  }

  return 0;
}
