import { buildPropertySharePayload, formatPropertyShareLabel } from '../property-share';

describe('property-share', () => {
  const property = {
    address: 'Beeldbuisring 41',
    city: 'Eindhoven',
    postalCode: '5651 HA',
    countryCode: 'NL',
    streetName: 'Beeldbuisring',
    houseNumber: 41,
  };

  it('formats the quoted share label with compact postcode and city', () => {
    expect(formatPropertyShareLabel(property)).toBe('Beeldbuisring 41, 5651HA Eindhoven');
  });

  it('builds the default share payload with the canonical map URL', () => {
    expect(buildPropertySharePayload(property, 'http://localhost:8081')).toEqual({
      title: 'Beeldbuisring 41 - HuisHype',
      message: 'Check out "Beeldbuisring 41, 5651HA Eindhoven" on HuisHype: http://localhost:8081/map/eindhoven/5651ha/beeldbuisring/41',
      url: 'http://localhost:8081/map/eindhoven/5651ha/beeldbuisring/41',
    });
  });
});
