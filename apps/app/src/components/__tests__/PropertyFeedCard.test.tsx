import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Mock FontAwesome before importing the component
jest.mock('@expo/vector-icons/FontAwesome', () => 'FontAwesome');

// Mock the hooks module
jest.mock('@/src/hooks', () => ({
  useReverseGeocode: jest.fn(() => ({
    data: null,
    isLoading: false,
  })),
  isBagPandPlaceholder: jest.fn((address: string) => address.startsWith('BAG Pand')),
}));

import { PropertyFeedCard } from '../PropertyFeedCard';
import { useReverseGeocode, isBagPandPlaceholder } from '@/src/hooks';

describe('PropertyFeedCard', () => {
  const defaultProps = {
    id: 'test-id',
    address: 'Prinsengracht 123',
    city: 'Amsterdam',
    postalCode: '1015 DV',
    wozValue: 500000,
    activityLevel: 'warm' as const,
    commentCount: 15,
    guessCount: 10,
    viewCount: 100,
  };

  it('renders address and city correctly', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('Prinsengracht 123')).toBeTruthy();
    expect(getByText('Amsterdam, 1015 DV')).toBeTruthy();
  });

  it('renders WOZ value label', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    // WOZ value should be displayed with label
    expect(getByText('WOZ Value')).toBeTruthy();
  });

  it('renders activity stats', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('15')).toBeTruthy(); // comment count
    expect(getByText('10 guesses')).toBeTruthy();
  });

  it('calls onPress when card is tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <PropertyFeedCard {...defaultProps} onPress={onPress} />
    );

    fireEvent.press(getByTestId('property-feed-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows "Trending" badge for hot activity', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="hot" />
    );

    expect(getByText('Trending')).toBeTruthy();
  });

  it('shows "Active" badge for warm activity', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="warm" />
    );

    expect(getByText('Active')).toBeTruthy();
  });

  it('does not show badge for cold activity', () => {
    const { queryByText } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="cold" />
    );

    expect(queryByText('Trending')).toBeNull();
    expect(queryByText('Active')).toBeNull();
  });

  it('renders placeholder when no image URL provided', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('No image available')).toBeTruthy();
  });

  it('renders image when photoUrl is provided', () => {
    const { getByTestId } = render(
      <PropertyFeedCard {...defaultProps} photoUrl="https://example.com/image.jpg" />
    );

    expect(getByTestId('property-image')).toBeTruthy();
  });

  it('shows building year when provided', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} bouwjaar={1920} />
    );

    expect(getByText(/1920/)).toBeTruthy();
  });

  it('shows surface area when provided', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} oppervlakte={85} />
    );

    expect(getByText(/85 m/)).toBeTruthy();
  });

  it('shows FMV value when provided', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} fmvValue={550000} />
    );

    expect(getByText('Crowd FMV')).toBeTruthy();
  });

  it('shows price difference indicator when both asking and FMV are present', () => {
    const { getByText } = render(
      <PropertyFeedCard
        {...defaultProps}
        askingPrice={600000}
        fmvValue={500000}
      />
    );

    // Should show difference vs asking
    expect(getByText(/vs asking/)).toBeTruthy();
  });

  describe('BAG Pand placeholder resolution', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('does not trigger reverse geocoding for real addresses', () => {
      (isBagPandPlaceholder as jest.Mock).mockReturnValue(false);

      render(<PropertyFeedCard {...defaultProps} coordinates={{ lat: 52.37, lng: 4.89 }} />);

      // Should not try to resolve a real address
      expect(useReverseGeocode).toHaveBeenCalledWith(null, null, { enabled: false });
    });

    it('triggers reverse geocoding for BAG Pand placeholders when coordinates are provided', () => {
      (isBagPandPlaceholder as jest.Mock).mockReturnValue(true);

      render(
        <PropertyFeedCard
          {...defaultProps}
          address="BAG Pand 0772100001217229"
          coordinates={{ lat: 51.45, lng: 5.47 }}
        />
      );

      // Should attempt to resolve the BAG Pand placeholder
      expect(useReverseGeocode).toHaveBeenCalledWith(51.45, 5.47, { enabled: true });
    });

    it('displays resolved address when available', () => {
      (isBagPandPlaceholder as jest.Mock).mockReturnValue(true);
      (useReverseGeocode as jest.Mock).mockReturnValue({
        data: {
          address: 'Operalaan 15',
          city: 'Eindhoven',
          postalCode: '5653 AB',
        },
        isLoading: false,
      });

      const { getByText } = render(
        <PropertyFeedCard
          {...defaultProps}
          address="BAG Pand 0772100001217229"
          city="Unknown"
          coordinates={{ lat: 51.45, lng: 5.47 }}
        />
      );

      // Should display the resolved address, not the BAG Pand placeholder
      expect(getByText('Operalaan 15')).toBeTruthy();
      expect(getByText('Eindhoven, 5653 AB')).toBeTruthy();
    });

    it('displays original BAG Pand when resolution fails or no coordinates', () => {
      (isBagPandPlaceholder as jest.Mock).mockReturnValue(true);
      (useReverseGeocode as jest.Mock).mockReturnValue({
        data: null,
        isLoading: false,
      });

      const { getByText } = render(
        <PropertyFeedCard
          {...defaultProps}
          address="BAG Pand 0772100001217229"
          city="Eindhoven"
        />
      );

      // Should fall back to displaying the original BAG Pand
      expect(getByText('BAG Pand 0772100001217229')).toBeTruthy();
    });
  });
});
