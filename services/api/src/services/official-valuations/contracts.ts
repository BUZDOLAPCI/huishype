import { z } from 'zod';

export const officialValuationSourceSchema = z.enum(['woz']);
export type OfficialValuationSource = z.infer<typeof officialValuationSourceSchema>;

export const officialValuationClientRuntimeSchema = z.enum(['web', 'native']).optional();
export type OfficialValuationClientRuntime = NonNullable<
  z.infer<typeof officialValuationClientRuntimeSchema>
>;

export const hydrateOfficialValuationRequestSchema = z
  .object({
    source: officialValuationSourceSchema.default('woz'),
  })
  .strict();

export type HydrateOfficialValuationRequest = z.infer<
  typeof hydrateOfficialValuationRequestSchema
>;

export type ClientObservedOfficialValuation = Required<
  {
    valuation: number;
    valuationYear: number;
  }
> &
  Partial<{
    referenceDate: string;
    sourceRecordId: string;
    sourceDatasetVersion: string;
    sourceUrl: string;
    rawPayload: unknown;
    clientRuntime: OfficialValuationClientRuntime;
    sourceRequestFingerprint: string;
  }>;

export function getClientObservedValuation(
  request: HydrateOfficialValuationRequest,
): ClientObservedOfficialValuation | null {
  void request;
  return null;
}
