import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ListingSubmissionSheet } from '../ListingSubmissionSheet';
import { WebDismissibleLayerProvider } from '../../../providers/WebDismissibleLayerProvider';

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
const originalPlatform = Platform.OS;

function renderWithDismissibleLayer(ui: React.ReactElement) {
  return render(<WebDismissibleLayerProvider>{ui}</WebDismissibleLayerProvider>);
}

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

describe('ListingSubmissionSheet', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.clearAllMocks();
    setPlatform(originalPlatform);
    mockAuthContext = {
      accessToken: 'test-access-token',
      user: { id: 'user-1' },
      isAuthenticated: true,
      getAccessToken: jest.fn(async () => 'test-access-token'),
    };
  });

  afterEach(() => {
    setPlatform(originalPlatform);
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
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('This listing is ready to add.')).toBeTruthy();
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

  it('submits a provisional preview token when validation is pending', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...previewContractFields,
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-pending/',
          canonicalUrl: 'https://www.funda.nl/detail/pending',
          sourceListingId: 'pending',
          sourceListingIdKind: 'tiny_id',
          validationState: 'provisional',
          matchState: 'unverified',
          handoffState: 'will_create',
          reasonCode: 'mirror_unavailable',
          title: 'Pending Listing',
          description: 'Pending description',
          imageUrl: null,
          askingPrice: 425000,
          priceType: 'sale',
          currency: 'EUR',
          address: null,
          submittedPropertyId: '11111111-1111-4111-8111-111111111111',
          matchedPropertyId: null,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'listing-1',
          propertyId: '11111111-1111-4111-8111-111111111111',
          sourceUrl: 'https://www.funda.nl/koop/eindhoven/huis-pending/',
          sourceName: 'funda',
          canonicalUrl: 'https://www.funda.nl/detail/pending',
          sourceListingId: 'pending',
          status: 'active',
          verificationState: 'provisional',
          candidateHandoffState: 'queued',
          candidateId: '33333333-3333-4333-8333-333333333333',
          reasonCode: 'mirror_unavailable',
          createdAt: '2026-05-06T12:00:00.000Z',
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
      'https://www.funda.nl/koop/eindhoven/huis-pending/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(
      screen.getByText(
        'This listing will be added to HuisHype immediately.'
      )
    ).toBeTruthy();

    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [submitUrl, submitOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(submitUrl).toBe('http://localhost:3100/listings/submit');
    expect(JSON.parse(String(submitOptions.body))).toMatchObject({
      previewToken: previewContractFields.previewToken,
    });
  });

  it('treats duplicate 409 submit bodies as submitted listings', async () => {
    const onSubmitted = jest.fn();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...previewContractFields,
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/koop/eindhoven/huis-duplicate/',
          canonicalUrl: 'https://www.funda.nl/detail/duplicate',
          sourceListingId: 'duplicate',
          sourceListingIdKind: 'tiny_id',
          validationState: 'valid',
          matchState: 'matched',
          handoffState: 'will_create',
          reasonCode: 'source_identity_match',
          title: 'Duplicate Listing',
          description: null,
          imageUrl: 'https://cdn.example.com/duplicate.jpg',
          askingPrice: 495000,
          priceType: 'sale',
          currency: 'EUR',
          address: null,
          submittedPropertyId: '11111111-1111-4111-8111-111111111111',
          matchedPropertyId: '11111111-1111-4111-8111-111111111111',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          id: '44444444-4444-4444-8444-444444444444',
          propertyId: '11111111-1111-4111-8111-111111111111',
          sourceUrl: 'https://www.funda.nl/detail/duplicate',
          sourceName: 'funda',
          canonicalUrl: 'https://www.funda.nl/detail/duplicate',
          sourceListingId: 'duplicate',
          status: 'active',
          verificationState: 'provisional',
          candidateHandoffState: 'queued',
          candidateId: '55555555-5555-4555-8555-555555555555',
          reasonCode: 'source_identity_match',
          createdAt: '2026-05-06T12:00:00.000Z',
        }),
      } as Response);

    render(
      <ListingSubmissionSheet
        propertyId="11111111-1111-4111-8111-111111111111"
        visible
        onClose={jest.fn()}
        onSubmitted={onSubmitted}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Paste a Funda or Pararius link'),
      'https://www.funda.nl/koop/eindhoven/huis-duplicate/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    fireEvent.press(screen.getByText('Confirm & Add Listing'));

    await screen.findByText('Listing Added');
    await waitFor(
      () => {
        expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({
          id: '44444444-4444-4444-8444-444444444444',
          ogTitle: 'Duplicate Listing',
          askingPrice: 495000,
          candidateHandoffState: 'queued',
        }));
      },
      { timeout: 2000 }
    );
  });

  it.each(['parser_error', 'validation_pending'] as const)(
    'enables confirmation for provisional %s previews',
    async (reasonCode) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...previewContractFields,
          sourceName: 'pararius',
          rawUrl: `https://www.pararius.com/apartment-for-rent/eindhoven/${reasonCode}/listing`,
          canonicalUrl: `https://www.pararius.com/apartment-for-rent/eindhoven/${reasonCode}/listing`,
          sourceListingId: `/apartment-for-rent/eindhoven/${reasonCode}/listing`,
          sourceListingIdKind: 'canonical_path',
          validationState: 'provisional',
          matchState: 'unverified',
          handoffState: 'will_create',
          reasonCode,
          title: 'Provisional Listing',
          description: null,
          imageUrl: null,
          askingPrice: null,
          priceType: 'rent',
          currency: 'EUR',
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
        `https://www.pararius.com/apartment-for-rent/eindhoven/${reasonCode}/listing`
      );
      fireEvent.press(screen.getByText('Preview'));

      await screen.findByText('Confirm & Add Listing');
      expect(screen.getByText('Ready')).toBeTruthy();
      expect(screen.queryByText('Cannot Add Listing')).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );

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

  it('unwinds preview state to the URL input on web popstate', async () => {
    setPlatform('web');
    const routeNavigation = jest.fn();
    window.addEventListener('popstate', routeNavigation);
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
        validationState: 'valid',
        matchState: 'matched',
        handoffState: 'will_create',
        reasonCode: 'source_identity_match',
        title: 'Example Listing',
        description: null,
        imageUrl: null,
        askingPrice: null,
        priceType: 'unknown',
        currency: null,
        address: null,
        submittedPropertyId: '11111111-1111-4111-8111-111111111111',
        matchedPropertyId: '11111111-1111-4111-8111-111111111111',
      }),
    } as Response);

    try {
      renderWithDismissibleLayer(
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

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      await screen.findByPlaceholderText('Paste a Funda or Pararius link');
      expect(screen.queryByText('Confirm & Add Listing')).toBeNull();
      expect(routeNavigation).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', routeNavigation);
    }
  });

  it('unwinds submit errors back to preview on web popstate', async () => {
    setPlatform('web');
    const routeNavigation = jest.fn();
    window.addEventListener('popstate', routeNavigation);
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
          description: null,
          imageUrl: null,
          askingPrice: null,
          priceType: 'unknown',
          currency: null,
          address: null,
          submittedPropertyId: '11111111-1111-4111-8111-111111111111',
          matchedPropertyId: '11111111-1111-4111-8111-111111111111',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'submit failed' }),
      } as Response);

    try {
      renderWithDismissibleLayer(
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
      fireEvent.press(screen.getByText('Confirm & Add Listing'));

      await screen.findByText('Something went wrong');

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      await screen.findByText('Confirm & Add Listing');
      expect(screen.queryByText('Something went wrong')).toBeNull();
      expect(routeNavigation).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', routeNavigation);
    }
  });

  it('shows preview validation failures without creating a confirmation step', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'LISTING_VALIDATION_FAILED',
        message: 'Listing validation failed: address_mismatch',
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

    await screen.findByText('This listing does not appear to match this property.');
    expect(screen.queryByText('Confirm & Add Listing')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [previewUrl, previewOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(previewUrl).toBe('http://localhost:3100/listings/preview');
    expect(previewOptions.headers).toEqual({ 'Content-Type': 'application/json' });
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
    expect(screen.queryByText('Ready to add')).toBeNull();
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
          canonicalUrl: 'https://www.funda.nl/detail/12345',
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
        expect.any(Function)
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
          canonicalUrl: 'https://www.funda.nl/detail/12345',
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
        expect.any(Function)
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
        canonicalUrl: 'https://www.funda.nl/detail/12345',
        sourceListingId: '12345',
        sourceListingIdKind: 'tiny_id',
        validationState: 'valid',
        matchState: 'matched',
        handoffState: 'will_create',
        reasonCode: 'source_identity_match',
        title: null,
        description: null,
        imageUrl: null,
        askingPrice: null,
        priceType: 'unknown',
        currency: null,
        address: null,
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
      'https://www.funda.nl/koop/eindhoven/huis-12345/'
    );
    fireEvent.press(screen.getByText('Preview'));

    await screen.findByText('Confirm & Add Listing');
    expect(screen.getByText('Funda listing')).toBeTruthy();
    expect(screen.getByText('https://www.funda.nl/detail/12345')).toBeTruthy();
    expect(screen.getByText('No preview image')).toBeTruthy();
    expect(screen.queryByText('Ready to add')).toBeNull();
    expect(screen.queryByText('Candidate queued')).toBeNull();
  });

  it('shows unsupported source preview rejections without confirmation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'LISTING_VALIDATION_FAILED',
        message: 'Listing validation failed: source_not_supported',
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

    await screen.findByText('That listing site is not supported yet.');
    expect(screen.queryByText('Cannot Add Listing')).toBeNull();
    expect(screen.queryByText('Confirm & Add Listing')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('shows listing mismatch preview rejections without confirmation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'LISTING_VALIDATION_FAILED',
        message: 'Listing validation failed: address_mismatch',
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

    await screen.findByText('This listing does not appear to match this property.');
    expect(screen.queryByText('Cannot Add Listing')).toBeNull();
    expect(screen.queryByText('Confirm & Add Listing')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
