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
        ogTitle: 'Example Listing',
        ogImage: 'https://cdn.example.com/thumb.jpg',
        ogDescription: null,
        sourceName: 'funda',
        addressMatch: true,
        warning: null,
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
});
