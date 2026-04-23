import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ListingSubmissionSheet } from '../ListingSubmissionSheet';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

type MockAuthContext = {
  accessToken: string | null;
  user: { id: string } | null;
  isAuthenticated: boolean;
};

let mockAuthContext: MockAuthContext = {
  accessToken: 'test-access-token',
  user: { id: 'user-1' },
  isAuthenticated: true,
};

jest.mock('../../../providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext,
}));

jest.mock('../../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
}));

describe('ListingSubmissionSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContext = {
      accessToken: 'test-access-token',
      user: { id: 'user-1' },
      isAuthenticated: true,
    };
  });

  it('submits thumbnailUrl (not ogImage) and keeps preview request unauthenticated', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
          canonicalUrl: 'https://www.funda.nl/detail/12345',
          sourceListingId: '12345',
          sourceListingIdKind: 'tiny_id',
          validationState: 'valid',
          matchState: 'matched',
          watchState: 'not_required',
          reasonCode: 'source_identity_match',
          title: 'Example Listing',
          description: 'Example description',
          imageUrl: 'https://cdn.example.com/thumb.jpg',
          askingPrice: 495000,
          priceType: 'sale',
          currency: 'EUR',
          address: 'Example Street 1',
          submittedPropertyId: '11111111-1111-4111-8111-111111111111',
          matchedPropertyId: '11111111-1111-4111-8111-111111111111',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'submit failed' }),
      } as Response);

    render(
      <ListingSubmissionSheet
        propertyId="11111111-1111-4111-8111-111111111111"
        visible
        onClose={jest.fn()}
        onSubmitted={jest.fn()}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Paste a Funda or Pararius link'),
      'https://www.funda.nl/koop/eindhoven/huis-12345/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    expect(screen.getByText('Validated')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [previewUrl, previewOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(previewUrl).toBe('http://localhost:3100/listings/preview');
    expect(previewOptions.headers).toEqual({ 'Content-Type': 'application/json' });

    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const [submitUrl, submitOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(submitUrl).toBe('http://localhost:3100/listings/submit');
    expect(submitOptions.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-access-token',
    });

    const submitPayload = JSON.parse(String(submitOptions.body));
    expect(submitPayload).toMatchObject({
      url: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
      propertyId: '11111111-1111-4111-8111-111111111111',
      ogTitle: 'Example Listing',
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      title: 'Example Listing',
      description: 'Example description',
      imageUrl: 'https://cdn.example.com/thumb.jpg',
      askingPrice: 495000,
      priceType: 'sale',
      currency: 'EUR',
    });
    expect(submitPayload).not.toHaveProperty('ogImage');
  });

  it('treats legacy OG-only preview data as provisional instead of proof', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ogTitle: 'Example Listing',
          ogImage: 'https://cdn.example.com/thumb.jpg',
          ogDescription: 'Example description',
          sourceName: 'funda',
          addressMatch: true,
          warning: null,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'submit failed' }),
      } as Response);

    render(
      <ListingSubmissionSheet
        propertyId="11111111-1111-4111-8111-111111111111"
        visible
        onClose={jest.fn()}
        onSubmitted={jest.fn()}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Paste a Funda or Pararius link'),
      'https://www.funda.nl/koop/eindhoven/huis-12345/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    expect(screen.getAllByText('Pending validation').length).toBeGreaterThan(0);
    expect(screen.queryByText('Source validation matched')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [previewUrl, previewOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(previewUrl).toBe('http://localhost:3100/listings/preview');
    expect(previewOptions.headers).toEqual({ 'Content-Type': 'application/json' });

    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const [submitUrl, submitOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(submitUrl).toBe('http://localhost:3100/listings/submit');
    expect(submitOptions.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-access-token',
    });

    const submitPayload = JSON.parse(String(submitOptions.body));
    expect(submitPayload).toMatchObject({
      url: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
      propertyId: '11111111-1111-4111-8111-111111111111',
      ogTitle: 'Example Listing',
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      title: 'Example Listing',
      description: 'Example description',
      imageUrl: 'https://cdn.example.com/thumb.jpg',
      priceType: 'unknown',
    });
    expect(submitPayload).not.toHaveProperty('ogImage');
  });

  it('requires auth for submit even after an unauthenticated preview', async () => {
    mockAuthContext = {
      accessToken: null,
      user: null,
      isAuthenticated: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
        canonicalUrl: 'https://www.funda.nl/detail/12345',
        sourceListingId: '12345',
        sourceListingIdKind: 'tiny_id',
        validationState: 'provisional',
        matchState: 'unverified',
        watchState: 'will_enqueue',
        reasonCode: 'validation_pending',
        title: 'Example Listing',
        description: null,
        imageUrl: 'https://cdn.example.com/thumb.jpg',
        askingPrice: null,
        priceType: 'unknown',
        currency: null,
        address: null,
        submittedPropertyId: '11111111-1111-4111-8111-111111111111',
        matchedPropertyId: null,
      }),
    } as Response);

    const onAuthRequired = jest.fn();

    render(
      <ListingSubmissionSheet
        propertyId="11111111-1111-4111-8111-111111111111"
        visible
        onClose={jest.fn()}
        onSubmitted={jest.fn()}
        onAuthRequired={onAuthRequired}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Paste a Funda or Pararius link'),
      'https://www.funda.nl/koop/eindhoven/huis-12345/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('disables confirmation for confirmed listing mismatches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/detail/mismatch-12345',
        canonicalUrl: 'https://www.funda.nl/detail/12345',
        sourceListingId: '12345',
        sourceListingIdKind: 'tiny_id',
        validationState: 'invalid',
        matchState: 'mismatch',
        watchState: 'not_required',
        reasonCode: 'address_mismatch',
        title: 'Other Property',
        description: null,
        imageUrl: null,
        askingPrice: null,
        priceType: 'unknown',
        currency: null,
        address: 'Other Street 1',
        submittedPropertyId: '11111111-1111-4111-8111-111111111111',
        matchedPropertyId: '22222222-2222-4222-8222-222222222222',
      }),
    } as Response);

    render(
      <ListingSubmissionSheet
        propertyId="11111111-1111-4111-8111-111111111111"
        visible
        onClose={jest.fn()}
        onSubmitted={jest.fn()}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Paste a Funda or Pararius link'),
      'https://www.funda.nl/detail/mismatch-12345'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Cannot Add Listing');
    expect(screen.getByText('Mismatch')).toBeTruthy();
    expect(screen.getByText('This listing does not match this property.')).toBeTruthy();

    fireEvent.press(screen.getByText('Cannot Add Listing'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
