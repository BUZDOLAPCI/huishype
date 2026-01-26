/**
 * PDOK Locatieserver API mock handlers
 *
 * Mocks the PDOK address resolution API for testing.
 * API: https://api.pdok.nl/bzk/locatieserver/search/v3_1/free
 *
 * CRITICAL: Returns centroide_ll (WGS84) NOT centroide_rd (RD)
 */

import { http, HttpResponse } from 'msw';

/**
 * Mock PDOK address data
 * Real data format for Deflectiespoelstraat 16, 5651HP Eindhoven
 */
export const mockPDOKAddresses: Record<string, PDOKMockDocument> = {
  // Deflectiespoelstraat 16 - the test address
  'deflectiespoelstraat-16-5651hp': {
    id: 'adr-51d1f8e8e3ca30e9c0258e0900015b44',
    type: 'adres',
    weergavenaam: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
    score: 18.5,
    centroide_ll: 'POINT(5.4557789 51.4300456)', // WGS84 coordinates
    huisnummer: '16',
    postcode: '5651HP',
    straatnaam: 'Deflectiespoelstraat',
    woonplaatsnaam: 'Eindhoven',
    gemeentenaam: 'Eindhoven',
    provincienaam: 'Noord-Brabant',
  },
  // Additional test addresses
  'deflectiespoelstraat-33-5651hp': {
    id: 'adr-51d1f8e8e3ca30e9c0258e0900015b45',
    type: 'adres',
    weergavenaam: 'Deflectiespoelstraat 33, 5651HP Eindhoven',
    score: 18.3,
    centroide_ll: 'POINT(5.4560123 51.4302789)',
    huisnummer: '33',
    postcode: '5651HP',
    straatnaam: 'Deflectiespoelstraat',
    woonplaatsnaam: 'Eindhoven',
    gemeentenaam: 'Eindhoven',
    provincienaam: 'Noord-Brabant',
  },
  'stationsplein-1-5611ab': {
    id: 'adr-51d1f8e8e3ca30e9c0258e0900015b46',
    type: 'adres',
    weergavenaam: 'Stationsplein 1, 5611AB Eindhoven',
    score: 18.0,
    centroide_ll: 'POINT(5.4817 51.4433)',
    huisnummer: '1',
    postcode: '5611AB',
    straatnaam: 'Stationsplein',
    woonplaatsnaam: 'Eindhoven',
    gemeentenaam: 'Eindhoven',
    provincienaam: 'Noord-Brabant',
  },
};

interface PDOKMockDocument {
  id: string;
  type: string;
  weergavenaam: string;
  score: number;
  centroide_ll: string;
  huisnummer: string;
  postcode: string;
  straatnaam: string;
  woonplaatsnaam: string;
  gemeentenaam: string;
  provincienaam: string;
}

interface PDOKResponse {
  response: {
    numFound: number;
    start: number;
    maxScore: number;
    docs: PDOKMockDocument[];
  };
}

/**
 * Find a mock address matching the query
 */
function findMockAddress(query: string): PDOKMockDocument | null {
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');

  // Try to parse postcode:XXXX and huisnummer:XX patterns
  const postcodeMatch = normalizedQuery.match(/postcode:([a-z0-9]+)/);
  const huisnummerMatch = normalizedQuery.match(/huisnummer:(\d+)/);

  if (postcodeMatch && huisnummerMatch) {
    const postcode = postcodeMatch[1].toUpperCase();
    const huisnummer = huisnummerMatch[1];

    // Find exact match
    for (const doc of Object.values(mockPDOKAddresses)) {
      const docPostcode = doc.postcode.replace(/\s+/g, '').toUpperCase();
      if (docPostcode === postcode && doc.huisnummer === huisnummer) {
        return doc;
      }
    }
  }

  // Try free text match
  for (const doc of Object.values(mockPDOKAddresses)) {
    const searchText = `${doc.straatnaam} ${doc.huisnummer} ${doc.postcode} ${doc.woonplaatsnaam}`
      .toLowerCase()
      .replace(/\s+/g, '');
    if (searchText.includes(normalizedQuery) || normalizedQuery.includes(searchText.slice(0, 20))) {
      return doc;
    }
  }

  return null;
}

/**
 * PDOK Locatieserver mock handlers
 */
export const pdokHandlers = [
  /**
   * GET https://api.pdok.nl/bzk/locatieserver/search/v3_1/free
   * The main address search endpoint
   */
  http.get('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const filterQuery = url.searchParams.get('fq') || '';

    // Only return results for type:adres filter
    if (filterQuery && !filterQuery.includes('type:adres')) {
      const response: PDOKResponse = {
        response: {
          numFound: 0,
          start: 0,
          maxScore: 0,
          docs: [],
        },
      };
      return HttpResponse.json(response);
    }

    const matchedDoc = findMockAddress(query);

    if (!matchedDoc) {
      const response: PDOKResponse = {
        response: {
          numFound: 0,
          start: 0,
          maxScore: 0,
          docs: [],
        },
      };
      return HttpResponse.json(response);
    }

    const response: PDOKResponse = {
      response: {
        numFound: 1,
        start: 0,
        maxScore: matchedDoc.score,
        docs: [matchedDoc],
      },
    };

    return HttpResponse.json(response);
  }),
];

/**
 * Helper to add a mock address for testing
 */
export function addMockPDOKAddress(key: string, doc: PDOKMockDocument): void {
  mockPDOKAddresses[key] = doc;
}

/**
 * Helper to clear all mock addresses
 */
export function clearMockPDOKAddresses(): void {
  for (const key of Object.keys(mockPDOKAddresses)) {
    delete mockPDOKAddresses[key];
  }
}
