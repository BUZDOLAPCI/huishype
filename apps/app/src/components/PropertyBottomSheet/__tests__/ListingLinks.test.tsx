import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ListingLinks } from '../ListingLinks';
import type { ListingData } from '../../../hooks/useListings';

jest.mock('../SectionCard', () => ({
  SectionCard: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, null, children);
  },
}));

const baseListing: ListingData = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  propertyId: '550e8400-e29b-41d4-a716-446655440001',
  sourceUrl: 'https://www.funda.nl/detail/123/',
  canonicalUrl: 'https://www.funda.nl/detail/123/',
  displayUrl: 'https://www.funda.nl/detail/123/',
  sourceName: 'funda',
  sourceListingId: '123',
  askingPrice: 425000,
  priceType: 'sale',
  currency: 'EUR',
  thumbnailUrl: null,
  ogTitle: null,
  livingAreaM2: null,
  numRooms: null,
  energyLabel: null,
  status: 'active',
  candidateHandoffState: null,
  verificationState: 'validated',
  reasonCode: null,
  listedAt: null,
  soldAt: null,
  rentedAt: null,
  withdrawnAt: null,
  firstSeenAt: '2026-04-02T08:00:00.000Z',
  lastSeenAt: '2026-04-06T10:00:00.000Z',
  lifecycleDate: '2026-04-02T08:00:00.000Z',
  createdAt: '2026-04-01T10:00:00.000Z',
};

describe('ListingLinks', () => {
  it('prefers source lifecycle dates over lifecycleDate and mirror timestamps', () => {
    render(
      <ListingLinks
        listings={[
          {
            ...baseListing,
            listedAt: '2027-01-15T12:00:00.000Z',
            firstSeenAt: '2026-01-15T12:00:00.000Z',
            lifecycleDate: '2025-01-15T12:00:00.000Z',
          },
          {
            ...baseListing,
            id: '550e8400-e29b-41d4-a716-446655440002',
            status: 'sold',
            soldAt: '2027-02-15T12:00:00.000Z',
            lastSeenAt: '2026-02-15T12:00:00.000Z',
            lifecycleDate: '2025-02-15T12:00:00.000Z',
          },
          {
            ...baseListing,
            id: '550e8400-e29b-41d4-a716-446655440003',
            status: 'rented',
            rentedAt: '2027-03-15T12:00:00.000Z',
            lastSeenAt: '2026-03-15T12:00:00.000Z',
            lifecycleDate: '2025-03-15T12:00:00.000Z',
          },
          {
            ...baseListing,
            id: '550e8400-e29b-41d4-a716-446655440004',
            status: 'withdrawn',
            withdrawnAt: '2027-04-15T12:00:00.000Z',
            lastSeenAt: '2026-04-15T12:00:00.000Z',
            lifecycleDate: '2025-04-15T12:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getByText(/^Listed .*2027$/)).toBeTruthy();
    expect(screen.getByText(/^Sold .*2027$/)).toBeTruthy();
    expect(screen.getByText(/^Rented .*2027$/)).toBeTruthy();
    expect(screen.getByText(/^Withdrawn .*2027$/)).toBeTruthy();
    expect(screen.queryByText(/^Listed .*2026$/)).toBeNull();
    expect(screen.queryByText(/^Sold .*2026$/)).toBeNull();
    expect(screen.queryByText(/^Rented .*2026$/)).toBeNull();
    expect(screen.queryByText(/^Withdrawn .*2026$/)).toBeNull();
  });

  it('falls back to first seen for active and last seen for inactive statuses', () => {
    render(
      <ListingLinks
        listings={[
          {
            ...baseListing,
            listedAt: null,
            firstSeenAt: '2028-01-15T12:00:00.000Z',
            lifecycleDate: '2025-01-15T12:00:00.000Z',
          },
          {
            ...baseListing,
            id: '550e8400-e29b-41d4-a716-446655440002',
            status: 'sold',
            soldAt: null,
            lastSeenAt: '2028-02-15T12:00:00.000Z',
            lifecycleDate: '2025-02-15T12:00:00.000Z',
          },
          {
            ...baseListing,
            id: '550e8400-e29b-41d4-a716-446655440003',
            status: 'rented',
            rentedAt: null,
            lastSeenAt: '2028-03-15T12:00:00.000Z',
            lifecycleDate: '2025-03-15T12:00:00.000Z',
          },
          {
            ...baseListing,
            id: '550e8400-e29b-41d4-a716-446655440004',
            status: 'withdrawn',
            withdrawnAt: null,
            lastSeenAt: '2028-04-15T12:00:00.000Z',
            lifecycleDate: '2025-04-15T12:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getByText(/^Listed .*2028$/)).toBeTruthy();
    expect(screen.getByText(/^Sold .*2028$/)).toBeTruthy();
    expect(screen.getByText(/^Rented .*2028$/)).toBeTruthy();
    expect(screen.getByText(/^Withdrawn .*2028$/)).toBeTruthy();
    expect(screen.queryByText(/^Listed .*2025$/)).toBeNull();
    expect(screen.queryByText(/^Sold .*2025$/)).toBeNull();
    expect(screen.queryByText(/^Rented .*2025$/)).toBeNull();
    expect(screen.queryByText(/^Withdrawn .*2025$/)).toBeNull();
  });

  it('keeps price and status rendering while omitting missing lifecycle dates', () => {
    render(
      <ListingLinks
        listings={[
          {
            ...baseListing,
            status: 'sold',
            soldAt: null,
            lifecycleDate: '2026-04-09T14:30:00.000Z',
            firstSeenAt: null,
            lastSeenAt: null,
          },
        ]}
      />
    );

    expect(screen.getByText('Sold')).toBeTruthy();
    expect(screen.getByText(/425/)).toBeTruthy();
    expect(screen.queryByText(/^Sold .*2026$/)).toBeNull();
  });
});
