import { describe, expect, it } from '@jest/globals';
import { contradictsPropertyAddress } from './v2-processor.js';
import type { IngestFactsV2 } from './v2-contracts.js';

const property = { countryCode: 'NL', street: 'Fixturestraat', postalCode: '1234AB', houseNumber: 41, houseNumberAddition: 'A' };
const address = { countryCode: 'NL' as const, street: 'Fixturestraat', postalCode: '1234AB' };

describe('v2 sparse address contradictions', () => {
  it.each([undefined, null, '', '   ', '\t\n', '\u00a0'])('treats unknown house number %p as incomplete evidence', houseNumber => {
    const incoming = houseNumber === undefined ? address : { ...address, houseNumber };
    expect(contradictsPropertyAddress(incoming, property)).toBe(false);
  });

  it.each<NonNullable<IngestFactsV2['address']>>([
    { ...address, houseNumber: '', street: 'Andere straat' },
    { ...address, houseNumber: ' ', postalCode: '5678CD' },
    { ...address, houseNumber: null, countryCode: 'BE' },
    { ...address, houseNumber: 'unknown' },
    { ...address, houseNumber: 42 },
    { ...address, houseNumber: 41, houseNumberAddition: null },
    { ...address, houseNumber: '41 B' },
    { ...address, houseNumber: '', houseNumberAddition: null },
    { ...address, houseNumber: null, houseNumberAddition: 'B' },
  ])('retains an explicit contradiction despite sparse evidence: %p', incoming => {
    expect(contradictsPropertyAddress(incoming, property)).toBe(true);
  });

  it('preserves an omitted suffix and accepts the existing explicit suffix', () => {
    expect(contradictsPropertyAddress({ ...address, houseNumber: 41 }, property)).toBe(false);
    expect(contradictsPropertyAddress({ ...address, houseNumber: '', houseNumberAddition: 'A' }, property)).toBe(false);
  });
});
