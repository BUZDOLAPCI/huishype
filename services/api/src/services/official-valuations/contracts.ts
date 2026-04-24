import { z } from 'zod';

const MAX_RAW_PAYLOAD_BYTES = 64 * 1024;

export const officialValuationSourceSchema = z.enum(['woz']);
export type OfficialValuationSource = z.infer<typeof officialValuationSourceSchema>;

export const officialValuationClientRuntimeSchema = z.enum(['web', 'native']).optional();
export type OfficialValuationClientRuntime = NonNullable<
  z.infer<typeof officialValuationClientRuntimeSchema>
>;

export const hydrateOfficialValuationRequestSchema = z
  .object({
    source: officialValuationSourceSchema.default('woz'),
    valuation: z.number().int().positive().max(100_000_000).optional(),
    valuationYear: z.number().int().min(1990).max(2100).optional(),
    referenceDate: z.string().date().optional(),
    sourceRecordId: z.string().trim().min(1).max(100).optional(),
    sourceDatasetVersion: z.string().trim().min(1).max(100).optional(),
    sourceUrl: z.string().url().max(2_000).optional(),
    rawPayload: z.unknown().optional(),
    clientRuntime: officialValuationClientRuntimeSchema,
    sourceRequestFingerprint: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((value, context) => {
    const hasObservedPayload = value.valuation !== undefined || value.valuationYear !== undefined;
    if (hasObservedPayload && (value.valuation === undefined || value.valuationYear === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'valuation and valuationYear must be submitted together',
        path: value.valuation === undefined ? ['valuation'] : ['valuationYear'],
      });
    }

    if (value.rawPayload !== undefined) {
      const encoded = JSON.stringify(value.rawPayload);
      if (encoded.length > MAX_RAW_PAYLOAD_BYTES) {
        context.addIssue({
          code: 'custom',
          message: `rawPayload must be ${MAX_RAW_PAYLOAD_BYTES} bytes or smaller`,
          path: ['rawPayload'],
        });
      }
    }
  });

export type HydrateOfficialValuationRequest = z.infer<
  typeof hydrateOfficialValuationRequestSchema
>;

export type ClientObservedOfficialValuation = Required<
  Pick<HydrateOfficialValuationRequest, 'valuation' | 'valuationYear'>
> &
  Pick<
    HydrateOfficialValuationRequest,
    | 'referenceDate'
    | 'sourceRecordId'
    | 'sourceDatasetVersion'
    | 'sourceUrl'
    | 'rawPayload'
    | 'clientRuntime'
    | 'sourceRequestFingerprint'
  >;

export function getClientObservedValuation(
  request: HydrateOfficialValuationRequest,
): ClientObservedOfficialValuation | null {
  if (request.valuation === undefined || request.valuationYear === undefined) {
    return null;
  }

  return {
    valuation: request.valuation,
    valuationYear: request.valuationYear,
    referenceDate: request.referenceDate,
    sourceRecordId: request.sourceRecordId,
    sourceDatasetVersion: request.sourceDatasetVersion,
    sourceUrl: request.sourceUrl,
    rawPayload: request.rawPayload,
    clientRuntime: request.clientRuntime,
    sourceRequestFingerprint: request.sourceRequestFingerprint,
  };
}
