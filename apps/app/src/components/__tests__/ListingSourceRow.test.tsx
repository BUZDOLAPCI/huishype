import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ListingSourceRow, type ListingSourceData } from '../ListingSourceRow';

// Linking.openURL is not available in this jest environment.
// We mock it at the component level via the react-native auto-mock.
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Linking = {
    openURL: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    canOpenURL: jest.fn().mockResolvedValue(true),
    getInitialURL: jest.fn().mockResolvedValue(null),
  };
  return RN;
});

describe('ListingSourceRow', () => {
  const fundaListing: ListingSourceData = {
    source: 'funda',
    url: 'https://funda.nl/listing/123',
    price: 415000,
    isActive: true,
    type: 'Buy',
  };

  const parariusListing: ListingSourceData = {
    source: 'pararius',
    url: 'https://pararius.nl/listing/456',
    price: 1650,
    isActive: true,
    type: 'Rent',
    pricePeriod: '/mo',
  };

  it('renders Funda source name', () => {
    render(<ListingSourceRow listing={fundaListing} />);
    expect(screen.getByText('Funda')).toBeTruthy();
  });

  it('renders Pararius source name', () => {
    render(<ListingSourceRow listing={parariusListing} />);
    expect(screen.getByText('Pararius')).toBeTruthy();
  });

  it('renders "Active" status badge', () => {
    render(<ListingSourceRow listing={fundaListing} />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('renders "Expired" status badge', () => {
    render(<ListingSourceRow listing={{ ...fundaListing, isActive: false }} />);
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('renders provisional verification status', () => {
    render(
      <ListingSourceRow
        listing={{
          ...fundaListing,
          verificationState: 'validation_pending',
          candidateHandoffState: 'queued',
        }}
      />
    );
    expect(screen.getByText('Handoff pending')).toBeTruthy();
  });

  it('renders listing type', () => {
    render(<ListingSourceRow listing={fundaListing} />);
    expect(screen.getByText(/Buy/)).toBeTruthy();
  });

  it('renders price period for rentals', () => {
    render(<ListingSourceRow listing={parariusListing} />);
    expect(screen.getByText(/\/mo/)).toBeTruthy();
  });

  it('is pressable and has link accessibility role', () => {
    render(<ListingSourceRow listing={fundaListing} />);
    const row = screen.getByTestId('listing-source-row');
    expect(row).toBeTruthy();
    // Verify it can be pressed without crashing
    fireEvent.press(row);
    // Verify accessibility
    expect(row.props.accessibilityRole).toBe('link');
  });

  it('handles unknown listing source gracefully', () => {
    const unknown: ListingSourceData = {
      source: 'unknown_source',
      url: 'https://example.com',
    };
    render(<ListingSourceRow listing={unknown} />);
    expect(screen.getByText('Listing')).toBeTruthy();
  });

  it('renders without price', () => {
    const noPriceListing: ListingSourceData = {
      source: 'funda',
      url: 'https://funda.nl/listing/789',
    };
    render(<ListingSourceRow listing={noPriceListing} />);
    expect(screen.getByText('Funda')).toBeTruthy();
  });

  it('does not show status badge when isActive is undefined', () => {
    const noStatus: ListingSourceData = {
      source: 'funda',
      url: 'https://funda.nl/listing/101',
    };
    render(<ListingSourceRow listing={noStatus} />);
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });
});
