import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import FlaggedPropertiesRoute from '@/app/admin/properties';
import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  useAdminPropertyReports,
  useAdminReportAction,
} from '@/src/hooks/admin/useAdminModeration';

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/admin/useAdminModeration', () => ({
  useAdminPropertyReports: jest.fn(),
  useAdminReportAction: jest.fn(),
}));

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockUseAdminPropertyReports =
  useAdminPropertyReports as jest.MockedFunction<typeof useAdminPropertyReports>;
const mockUseAdminReportAction =
  useAdminReportAction as jest.MockedFunction<typeof useAdminReportAction>;

function seedAuth(overrides: Partial<ReturnType<typeof useAuthContext>> = {}) {
  mockUseAuthContext.mockReturnValue({
    user: {
      id: 'admin-1',
      username: 'admin',
      displayName: 'Admin',
      karma: 0,
      karmaRank: 'Newcomer',
      createdAt: '2026-01-01T00:00:00.000Z',
      isAdmin: true,
    } as ReturnType<typeof useAuthContext>['user'],
    isAuthenticated: true,
    isLoading: false,
    accessToken: 'token-1',
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    signOut: jest.fn(),
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
    ...overrides,
  });
}

describe('admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAdminPropertyReports.mockReturnValue({
      data: {
        items: [],
        recentReports: [],
        recentModerationActions: [],
        pendingCount: 0,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminPropertyReports>);
    mockUseAdminReportAction.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useAdminReportAction>);
  });

  it('renders forbidden state when auth exposes a non-admin user', () => {
    seedAuth({
      user: {
        id: 'user-1',
        username: 'user',
        displayName: 'User',
        karma: 0,
        karmaRank: 'Newcomer',
        createdAt: '2026-01-01T00:00:00.000Z',
        isAdmin: false,
      } as ReturnType<typeof useAuthContext>['user'],
    });

    const screen = render(<FlaggedPropertiesRoute />);

    expect(screen.getAllByText('Flagged Properties').length).toBeGreaterThan(0);
    expect(screen.getByText('Your account does not have admin access.')).toBeTruthy();
    expect(mockUseAdminPropertyReports).not.toHaveBeenCalled();
  });

  it('renders forbidden state when auth has no explicit admin marker', () => {
    seedAuth({
      user: {
        id: 'user-1',
        username: 'user',
        displayName: 'User',
        karma: 0,
        karmaRank: 'Newcomer',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as ReturnType<typeof useAuthContext>['user'],
    });

    const screen = render(<FlaggedPropertiesRoute />);

    expect(screen.getByText('Your account does not have admin access.')).toBeTruthy();
    expect(mockUseAdminPropertyReports).not.toHaveBeenCalled();
  });

  it('renders flagged property cards and dispatches review action', () => {
    const mutate = jest.fn();
    seedAuth();
    mockUseAdminReportAction.mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useAdminReportAction>);
    mockUseAdminPropertyReports.mockReturnValue({
      data: {
        items: [
          {
            id: 'property-p1',
            targetType: 'property',
            targetId: 'p1',
            reportCount: 2,
            latestReportAt: '2026-05-20T10:00:00.000Z',
            reasons: ['wrong listing', 'privacy'],
            property: {
              id: 'p1',
              address: 'Beeldbuisring 41',
              city: 'Eindhoven',
              postalCode: '5651 HA',
            },
            reports: [
              {
                id: 'report-1',
                targetType: 'property',
                targetId: 'p1',
                reason: 'wrong listing',
                createdAt: '2026-05-20T10:00:00.000Z',
              },
            ],
          },
        ],
        recentReports: [],
        recentModerationActions: [],
        pendingCount: 2,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminPropertyReports>);

    const screen = render(<FlaggedPropertiesRoute />);

    expect(screen.getByText('Beeldbuisring 41')).toBeTruthy();
    expect(screen.getByText('Eindhoven - 5651 HA')).toBeTruthy();

    fireEvent.press(screen.getByTestId('review-property-property-p1'));

    expect(mutate).toHaveBeenCalledWith({
      reportId: 'report-1',
      input: {
        action: 'mark_property_reviewed',
        status: 'reviewed',
        targetId: 'p1',
        targetType: 'property',
      },
    });
  });
});
