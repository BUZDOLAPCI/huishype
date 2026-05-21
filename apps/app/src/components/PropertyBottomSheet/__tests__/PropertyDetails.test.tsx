import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PropertyDetails } from '../PropertyDetails';
import type { PropertyDetailsData } from '../types';

const property: PropertyDetailsData = {
  id: 'property-1',
  nationalId: 'BAG-1',
  countryCode: 'NL',
  address: 'Activitylaan 1',
  city: 'Eindhoven',
  postalCode: '5611 AA',
  geometry: {
    type: 'Point',
    coordinates: [5.47, 51.44],
  },
  yearBuilt: 1980,
  floorAreaM2: 92,
  status: 'active',
  officialValuation: 350000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  activityLevel: 'warm',
  commentCount: 2,
  guessCount: 3,
  viewCount: 4,
  isLiked: false,
  isSaved: false,
};

describe('PropertyDetails reporting affordance', () => {
  it('places the report button in the Activity area and calls onReport', () => {
    const onReport = jest.fn();
    render(<PropertyDetails property={property} onReport={onReport} />);

    expect(screen.getByText('Activity')).toBeTruthy();
    expect(screen.getByTestId('property-report-button')).toBeTruthy();

    fireEvent.press(screen.getByTestId('property-report-button'));

    expect(onReport).toHaveBeenCalledTimes(1);
  });
});
