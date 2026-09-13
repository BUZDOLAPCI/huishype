import { z } from 'zod';

const timestamp = z.string().datetime({ offset: true });
const id = z.string().trim().min(1).max(255);
const aliasKind = z.enum(['tiny_id', 'global_id', 'detail_id', 'stable_id', 'canonical_url', 'canonical_path', 'relative_path', 'url_path', 'unknown']);
const optionalFact = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const inventoryManifestSchema = z.object({
  id,
  scopeKey: id,
  completedAt: timestamp,
  coverageStatus: z.literal('complete'),
  verified: z.literal(true),
}).strict();

export const ingestFactsV2Schema = z.object({
  sourceUrl: z.string().url().optional(),
  canonicalUrl: z.string().url().optional(),
  address: z.object({
    countryCode: optionalFact(z.string().length(2).transform(value => value.toUpperCase())),
    street: optionalFact(z.string()),
    postalCode: optionalFact(z.string()),
    houseNumber: optionalFact(z.union([z.string(), z.number().int()])),
    houseNumberAddition: optionalFact(z.string()),
    city: optionalFact(z.string()),
    latitude: optionalFact(z.number().min(-90).max(90)),
    longitude: optionalFact(z.number().min(-180).max(180)),
  }).strict().nullable().optional(),
  askingPrice: optionalFact(z.number().int().nonnegative().safe()),
  priceType: optionalFact(z.enum(['sale', 'rent', 'unknown'])),
  pricePeriod: optionalFact(z.enum(['month', 'week', 'day', 'year', 'total', 'unknown'])),
  priceUnit: optionalFact(z.enum(['listing', 'm2', 'unknown'])),
  priceCondition: optionalFact(z.enum(['asking', 'on_request', 'auction', 'unknown'])),
  currency: optionalFact(z.string().length(3).transform(value => value.toUpperCase())),
  livingAreaM2: optionalFact(z.number().int().nonnegative()),
  numRooms: optionalFact(z.number().nonnegative()),
  energyLabel: optionalFact(z.string()),
  thumbnailUrl: optionalFact(z.string().url()),
  ogTitle: optionalFact(z.string()),
  propertyType: optionalFact(z.string()),
  listedAt: optionalFact(timestamp),
  soldAt: optionalFact(timestamp),
  rentedAt: optionalFact(timestamp),
  withdrawnAt: optionalFact(timestamp),
  lifecycleStatus: z.enum(['available', 'conditional', 'sold', 'rented', 'withdrawn', 'unavailable']).optional(),
}).strict();

const common = {
  eventId: id,
  sequence: z.number().int().positive().safe(),
  observedAt: timestamp,
  collector: z.enum(['direct', 'realtyapi']),
  evidenceStrength: z.enum(['inventory', 'detail']),
  identity: z.object({
    sourceListingId: id,
    sourceListingIdKind: aliasKind,
    aliases: z.array(z.object({ kind: aliasKind, value: z.string().trim().min(1).max(2048) }).strict()).max(50).default([]),
  }).strict(),
  inventoryManifestId: id.optional(),
  inventoryManifest: inventoryManifestSchema.optional(),
};

export const ingestEvidenceV2Schema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('facts'), facts: ingestFactsV2Schema }).strict(),
  z.object({ ...common, kind: z.literal('sighting'), availability: z.enum(['available', 'conditional']).default('available') }).strict(),
  z.object({ ...common, kind: z.literal('absence'), inventoryManifest: inventoryManifestSchema }).strict(),
]).superRefine((record, ctx) => {
  if (record.inventoryManifest && record.inventoryManifestId && record.inventoryManifest.id !== record.inventoryManifestId) {
    ctx.addIssue({ code: 'custom', path: ['inventoryManifestId'], message: 'Inventory manifest references disagree' });
  }
  if (record.kind === 'facts' && Object.keys(record.facts).length === 0) {
    ctx.addIssue({ code: 'custom', path: ['facts'], message: 'Facts must contain at least one present field' });
  }
  if (record.kind === 'absence') {
    const delta = new Date(record.observedAt).getTime() - new Date(record.inventoryManifest.completedAt).getTime();
    if (delta < 0 || delta > 5 * 60 * 1000) {
      ctx.addIssue({ code: 'custom', path: ['observedAt'], message: 'Absence must be observed at completed inventory time (within five minutes)' });
    }
  }
});

export type IngestFactsV2 = z.infer<typeof ingestFactsV2Schema>;
export type IngestEvidenceV2 = z.infer<typeof ingestEvidenceV2Schema>;
