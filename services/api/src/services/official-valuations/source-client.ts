import type { OfficialValuationSource } from './contracts.js';
import type { OfficialValuationSourceConfig } from './registry.js';
import { createWozSourceClient } from './sources/woz.js';

export type OfficialValuationSourceProperty = {
  id: string;
  countryCode: string;
  nationalId: string | null;
  street: string;
  postalCode: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  city: string;
};

export type OfficialValuationSourceResult = {
  valuation: number;
  valuationYear: number;
  referenceDate?: string | null;
  sourceRecordId?: string | null;
  sourceDatasetVersion?: string | null;
  sourceUrl?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

export interface OfficialValuationSourceClient {
  fetchCurrentValuation(
    property: OfficialValuationSourceProperty,
    config: OfficialValuationSourceConfig,
  ): Promise<OfficialValuationSourceResult | null>;
}

const clients = new Map<OfficialValuationSource, OfficialValuationSourceClient>([
  ['woz', createWozSourceClient()],
]);

export function setOfficialValuationSourceClient(
  source: OfficialValuationSource,
  client: OfficialValuationSourceClient,
): void {
  clients.set(source, client);
}

export function getOfficialValuationSourceClient(
  source: OfficialValuationSource,
): OfficialValuationSourceClient {
  const client = clients.get(source);
  if (!client) {
    throw new Error(`No official valuation source client registered for ${source}`);
  }
  return client;
}
