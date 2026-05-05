import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ListingSubmissionSheet } from '../ListingSubmissionSheet';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

type MockAuthContext = {
  accessToken: string | null;
  user: { id: string } | null;
  isAuthenticated: boolean;
  getAccessToken: jest.Mock<Promise<string | null>, []>;
};

let mockAuthContext: MockAuthContext = {
  accessToken: 'test-access-token',
  user: { id: 'user-1' },
  isAuthenticated: true,
  getAccessToken: jest.fn(async () => 'test-access-token'),
};

jest.mock('../../../providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext,
}));

jest.mock('../../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
}));

const previewContractFields = {
  previewToken: 'mock-preview-token-000000000000000000',
  previewId: '22222222-2222-4222-8222-222222222222',
} as const;

describe('ListingSubmissionSheet', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.clearAllMocks();
    mockAuthContext = {
      accessToken: 'test-access-token',
      user: { id: 'user-1' },
      isAuthenticated: true,
      getAccessToken: jest.fn(async () => 'test-access-token'),
    };
  });

  it('submits the preview token and keeps preview request unauthenticated', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...previewContractFields,
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
          canonicalUrl: 'https://www.funda.nl/detail/12345',
          sourceListingId: '12345',
          sourceListingIdKind: 'tiny_id',
          validationState: 'valid',
          matchState: 'matched',
          handoffState: 'will_create',
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
    expect(screen.getByText(/€\s?495[,.]000/)).toBeTruthy();
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
      previewToken: previewContractFields.previewToken,
    });
    expect(submitPayload).not.toHaveProperty('url');
    expect(submitPayload).not.toHaveProperty('propertyId');
  });

  it('renders structured preview addresses without throwing and shows asking price', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...previewContractFields,
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-structured/',
        canonicalUrl: 'https://www.funda.nl/detail/structured',
        sourceListingId: 'structured',
        sourceListingIdKind: 'tiny_id',
        validationState: 'valid',
        matchState: 'matched',
        handoffState: 'will_create',
        reasonCode: 'source_identity_match',
        title: 'Structured Address Listing',
        description: 'Fallback description',
        imageUrl: null,
        askingPrice: 487500,
        priceType: 'sale',
        currency: 'EUR',
        address: {
          street: 'Beeldbuisring',
          houseNumber: 41,
          houseNumberAddition: 'A',
          postalCode: '5651 HA',
          city: 'Eindhoven',
        },
        submittedPropertyId: '11111111-1111-4111-8111-111111111111',
        matchedPropertyId: '11111111-1111-4111-8111-111111111111',
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
      'https://www.funda.nl/koop/eindhoven/huis-structured/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    expect(screen.getByText('Structured Address Listing')).toBeTruthy();
    expect(screen.getByText('Beeldbuisring 41 A, 5651 HA Eindhoven')).toBeTruthy();
    expect(screen.getByText(/€\s?487[,.]500/)).toBeTruthy();
    expect(screen.queryByText('Fallback description')).toBeNull();
  });

  it('treats provisional preview data as pending validation', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...previewContractFields,
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
          canonicalUrl: 'https://www.funda.nl/detail/12345',
          sourceListingId: '12345',
          sourceListingIdKind: 'tiny_id',
          validationState: 'provisional',
          matchState: 'unverified',
          handoffState: 'will_create',
          reasonCode: 'validation_pending',
          title: 'Example Listing',
          description: 'Example description',
          imageUrl: 'https://cdn.example.com/thumb.jpg',
          askingPrice: null,
          priceType: 'unknown',
          currency: null,
          address: null,
          submittedPropertyId: '11111111-1111-4111-8111-111111111111',
          matchedPropertyId: null,
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
      previewToken: previewContractFields.previewToken,
    });
    expect(submitPayload).not.toHaveProperty('url');
  });

  it('requires auth for submit even after an unauthenticated preview', async () => {
    mockAuthContext = {
      accessToken: null,
      user: null,
      isAuthenticated: false,
      getAccessToken: jest.fn(async () => null),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...previewContractFields,
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
        canonicalUrl: 'https://www.funda.nl/detail/12345',
        sourceListingId: '12345',
        sourceListingIdKind: 'tiny_id',
        validationState: 'provisional',
        matchState: 'unverified',
        handoffState: 'will_create',
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
    expect(screen.getByText('Candidate will be queued')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    await waitFor(() => expect(onAuthRequired).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves preview state and submits after successful login', async () => {
    mockAuthContext = {
      accessToken: null,
      user: null,
      isAuthenticated: false,
      getAccessToken: jest.fn(async () => null),
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...previewContractFields,
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
          canonicalUrl: null,
          sourceListingId: '12345',
          sourceListingIdKind: 'tiny_id',
          validationState: 'valid',
          matchState: 'matched',
          handoffState: 'will_create',
          reasonCode: 'source_identity_match',
          title: 'Example Listing',
          description: null,
          imageUrl: 'https://cdn.example.com/thumb.jpg',
          askingPrice: null,
          priceType: 'unknown',
          currency: null,
          address: null,
          submittedPropertyId: '11111111-1111-4111-8111-111111111111',
          matchedPropertyId: '11111111-1111-4111-8111-111111111111',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'listing-1',
          verificationState: 'validated',
        }),
      } as Response);

    const onAuthRequired = jest.fn();
    const props = {
      propertyId: '11111111-1111-4111-8111-111111111111',
      visible: true,
      onClose: jest.fn(),
      onSubmitted: jest.fn(),
      onAuthRequired,
    };
    const { rerender } = render(<ListingSubmissionSheet {...props} />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Paste a Funda or Pararius link'),
      'https://www.funda.nl/koop/eindhoven/huis-12345/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    await waitFor(() => {
      expect(onAuthRequired).toHaveBeenCalledWith(
        'Sign in to add this listing',
        expect.any(Function),
      );
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockAuthContext = {
      accessToken: 'fresh-access-token',
      user: { id: 'user-1' },
      isAuthenticated: true,
      getAccessToken: jest.fn(async () => 'fresh-access-token'),
    };
    rerender(<ListingSubmissionSheet {...props} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const [submitUrl, submitOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(submitUrl).toBe('http://localhost:3100/listings/submit');
    expect(submitOptions.headers).toMatchObject({
      Authorization: 'Bearer fresh-access-token',
    });
  });

  it('registers an auth continuation that submits with the fresh token', async () => {
    const getAccessToken = jest
      .fn<Promise<string | null>, []>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue('fresh-access-token');
    mockAuthContext = {
      accessToken: null,
      user: null,
      isAuthenticated: false,
      getAccessToken,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...previewContractFields,
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
          canonicalUrl: null,
          sourceListingId: '12345',
          sourceListingIdKind: 'tiny_id',
          validationState: 'valid',
          matchState: 'matched',
          handoffState: 'will_create',
          reasonCode: 'source_identity_match',
          title: 'Example Listing',
          description: null,
          imageUrl: 'https://cdn.example.com/thumb.jpg',
          askingPrice: null,
          priceType: 'unknown',
          currency: null,
          address: null,
          submittedPropertyId: '11111111-1111-4111-8111-111111111111',
          matchedPropertyId: '11111111-1111-4111-8111-111111111111',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'listing-1',
          verificationState: 'validated',
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
    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    await waitFor(() => {
      expect(onAuthRequired).toHaveBeenCalledWith(
        'Sign in to add this listing',
        expect.any(Function),
      );
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const resumeAfterAuth = onAuthRequired.mock.calls[0][1] as () => void;
    act(() => {
      resumeAfterAuth();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const [, submitOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(submitOptions.headers).toMatchObject({
      Authorization: 'Bearer fresh-access-token',
    });
  });

  it('shows fallback confirmation content when preview title and image are missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...previewContractFields,
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
        canonicalUrl: null,
        sourceListingId: '12345',
        sourceListingIdKind: 'tiny_id',
        validationState: 'provisional',
        matchState: 'unverified',
        handoffState: 'will_create',
        reasonCode: 'validation_pending',
        title: null,
        description: null,
        imageUrl: null,
        askingPrice: null,
        priceType: 'unknown',
        currency: null,
        address: null,
        submittedPropertyId: '11111111-1111-4111-8111-111111111111',
        matchedPropertyId: null,
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
      'https://www.funda.nl/koop/eindhoven/huis-12345/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    expect(screen.getByText('Funda listing')).toBeTruthy();
    expect(screen.getByText('https://www.funda.nl/koop/eindhoven/huis-12345/')).toBeTruthy();
    expect(screen.getByText('No preview image')).toBeTruthy();
    expect(screen.getByText('Candidate will be queued')).toBeTruthy();
    expect(screen.queryByText('Candidate queued')).toBeNull();
  });

  it('disables confirmation for unsupported previews', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...previewContractFields,
        sourceName: 'other',
        rawUrl: 'https://example.com/listing/123',
        canonicalUrl: 'https://example.com/listing/123',
        sourceListingId: null,
        sourceListingIdKind: null,
        validationState: 'provisional',
        matchState: 'unsupported',
        handoffState: 'unsupported',
        reasonCode: 'source_not_supported',
        title: null,
        description: null,
        imageUrl: null,
        askingPrice: null,
        priceType: 'unknown',
        currency: null,
        address: null,
        submittedPropertyId: '11111111-1111-4111-8111-111111111111',
        matchedPropertyId: null,
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
      'https://example.com/listing/123'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Cannot Add Listing');
    expect(screen.getByText('Listing preview')).toBeTruthy();
    expect(screen.getByText('Unsupported')).toBeTruthy();
    expect(screen.getByText('This listing source is not supported.')).toBeTruthy();
    expect(screen.queryByText('Pending source validation')).toBeNull();

    fireEvent.press(screen.getByText('Cannot Add Listing'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('disables confirmation for confirmed listing mismatches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...previewContractFields,
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/detail/mismatch-12345',
        canonicalUrl: 'https://www.funda.nl/detail/12345',
        sourceListingId: '12345',
        sourceListingIdKind: 'tiny_id',
        validationState: 'invalid',
        matchState: 'mismatch',
        handoffState: 'will_create',
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
