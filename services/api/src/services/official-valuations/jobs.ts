import type { OfficialValuationSource } from './contracts.js';

export const OFFICIAL_VALUATION_HYDRATION_QUEUE = 'official-valuation-hydration';
export const OFFICIAL_VALUATION_HYDRATION_JOB = 'official-valuation-hydration';

export interface OfficialValuationHydrationJobData {
  jobId: string;
  propertyId: string;
  source: OfficialValuationSource;
  valuationYear: number;
}
