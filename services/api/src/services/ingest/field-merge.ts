import type { IngestEvidenceV2, IngestFactsV2 } from './v2-contracts.js';

export interface FieldEvidence {
  observedAt: string;
  evidenceStrength: 'inventory' | 'detail';
  collector: 'direct' | 'realtyapi';
  eventId: string;
}
export type FieldEvidenceMap = Record<string, FieldEvidence>;

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function evidenceCanReplace(current: FieldEvidence | undefined, incoming: FieldEvidence): boolean {
  if (!current) return true;
  const order = new Date(incoming.observedAt).getTime() - new Date(current.observedAt).getTime();
  if (order !== 0) return order > 0;
  if (incoming.evidenceStrength !== current.evidenceStrength) return incoming.evidenceStrength === 'detail';
  return incoming.eventId > current.eventId;
}

/** Each address component is evidence of its own. Omission never clears knowledge. */
export function mergeListingFacts(
  previous: Record<string, unknown>,
  previousEvidence: Record<string, unknown>,
  patch: IngestFactsV2,
  record: Pick<IngestEvidenceV2, 'eventId' | 'observedAt' | 'collector' | 'evidenceStrength'>,
): { facts: Record<string, unknown>; fieldEvidence: FieldEvidenceMap; changedFields: string[] } {
  const facts = structuredClone(previous);
  const fieldEvidence = structuredClone(previousEvidence) as FieldEvidenceMap;
  const changedFields: string[] = [];
  const stamp: FieldEvidence = {
    eventId: record.eventId,
    observedAt: new Date(record.observedAt).toISOString(),
    collector: record.collector,
    evidenceStrength: record.evidenceStrength,
  };
  function apply(path: string, value: unknown, parent: Record<string, unknown>, key: string): void {
    let canReplace = evidenceCanReplace(fieldEvidence[path], stamp);
    if (path === 'lifecycleStatus' && fieldEvidence[path]
      && new Date(fieldEvidence[path].observedAt).getTime() === new Date(stamp.observedAt).getTime()) {
      const terminal = (status: unknown) => ['sold', 'rented', 'withdrawn', 'unavailable'].includes(String(status));
      if (terminal(value) !== terminal(parent[key])) canReplace = terminal(value);
    }
    if (!canReplace) return;
    if (stableValue(parent[key]) !== stableValue(value)) changedFields.push(path);
    parent[key] = value;
    fieldEvidence[path] = stamp;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key !== 'address') {
      apply(key, value, facts, key);
      continue;
    }
    const address = facts.address && typeof facts.address === 'object'
      ? { ...facts.address as Record<string, unknown> } : {};
    const addressPatch = value === null
      ? Object.fromEntries(['countryCode', 'street', 'postalCode', 'houseNumber', 'houseNumberAddition', 'city', 'latitude', 'longitude'].map(part => [part, null]))
      : value as Record<string, unknown>;
    for (const [part, item] of Object.entries(addressPatch)) {
      if (item !== undefined) apply(`address.${part}`, item, address, part);
    }
    facts.address = address;
  }
  return { facts, fieldEvidence, changedFields };
}
