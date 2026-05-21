import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router, usePathname } from 'expo-router';
import { Platform, Text } from 'react-native';

import FlaggedCommentsRoute from '@/app/admin/comments';
import FlaggedPropertiesRoute from '@/app/admin/properties';
import { AdminShell } from '@/src/components/admin/AdminModerationLayout';
import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  useAdminCommentReports,
  useAdminDisabledProperties,
  useAdminPropertyCommentsAction,
  useAdminPropertyReports,
  useAdminReportAction,
} from '@/src/hooks/admin/useAdminModeration';

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/admin/useAdminModeration', () => ({
  useAdminCommentReports: jest.fn(),
  useAdminDisabledProperties: jest.fn(),
  useAdminPropertyCommentsAction: jest.fn(),
  useAdminPropertyReports: jest.fn(),
  useAdminReportAction: jest.fn(),
}));

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockUseAdminCommentReports =
  useAdminCommentReports as jest.MockedFunction<typeof useAdminCommentReports>;
const mockUseAdminPropertyReports =
  useAdminPropertyReports as jest.MockedFunction<typeof useAdminPropertyReports>;
const mockUseAdminDisabledProperties =
  useAdminDisabledProperties as jest.MockedFunction<typeof useAdminDisabledProperties>;
const mockUseAdminReportAction =
  useAdminReportAction as jest.MockedFunction<typeof useAdminReportAction>;
const mockUseAdminPropertyCommentsAction =
  useAdminPropertyCommentsAction as jest.MockedFunction<typeof useAdminPropertyCommentsAction>;
const mockRouterPush = router.push as jest.MockedFunction<typeof router.push>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const mockWindowOpen = jest.fn();
const originalPlatform = Platform.OS;

function getNavLinkState(
  screen: ReturnType<typeof render>,
  label: string,
): { selected?: boolean } | undefined {
  const navLink = screen.UNSAFE_getAllByProps({ accessibilityRole: 'link' }).find((node) =>
    node.findAllByType(Text).some((textNode: { props: { children?: React.ReactNode } }) =>
      textNode.props.children === label
    ),
  );
  return navLink?.props.accessibilityState;
}

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
  beforeAll(() => {
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: mockWindowOpen,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'web';
    mockUsePathname.mockReturnValue('/');
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
    mockUseAdminCommentReports.mockReturnValue({
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
    } as unknown as ReturnType<typeof useAdminCommentReports>);
    mockUseAdminReportAction.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useAdminReportAction>);
    mockUseAdminDisabledProperties.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminDisabledProperties>);
    mockUseAdminPropertyCommentsAction.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useAdminPropertyCommentsAction>);
  });

  afterAll(() => {
    Platform.OS = originalPlatform;
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

  it('selects only the exact admin nav item for prefixed route names', () => {
    mockUsePathname.mockReturnValue('/admin/comments-disabled');

    const screen = render(
      <AdminShell title="Disabled Properties">
        {null}
      </AdminShell>,
    );

    expect(getNavLinkState(screen, 'Disabled Properties')).toEqual({ selected: true });
    expect(getNavLinkState(screen, 'Flagged Comments')).toEqual({ selected: false });
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

    fireEvent.press(screen.getByTestId('open-property-property-p1'));

    expect(mockWindowOpen).toHaveBeenCalledWith(
      '/eindhoven/5651ha/beeldbuisring/41?returnTo=%2Fadmin%2Fproperties',
      '_blank',
      'noopener,noreferrer',
    );
    expect(mockRouterPush).not.toHaveBeenCalled();

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

    fireEvent.press(screen.getByTestId('disable-comments-property-property-p1'));

    expect(mutate).toHaveBeenCalledWith({
      reportId: 'report-1',
      input: {
        action: 'disable_property_comments',
        status: 'resolved',
        targetId: 'p1',
        targetType: 'property',
      },
    });
  });

  it('renders a flagged comment view button and opens the canonical comments route in a new page', () => {
    seedAuth();
    mockUseAdminCommentReports.mockReturnValue({
      data: {
        items: [
          {
            id: 'comment-c1',
            targetType: 'comment',
            targetId: 'c1',
            reportCount: 1,
            latestReportAt: '2026-05-20T11:00:00.000Z',
            reasons: ['harassment'],
            comment: {
              id: 'c1',
              text: 'This discussion needs moderator review.',
              author: {
                id: 'user-2',
                username: 'reported-user',
              },
              property: {
                id: 'p1',
                address: 'Beeldbuisring 41',
                city: 'Eindhoven',
                postalCode: '5651 HA',
              },
            },
            reports: [
              {
                id: 'report-comment-1',
                targetType: 'comment',
                targetId: 'c1',
                reason: 'harassment',
                createdAt: '2026-05-20T11:00:00.000Z',
              },
            ],
          },
        ],
        recentReports: [],
        recentModerationActions: [],
        pendingCount: 1,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAdminCommentReports>);

    const screen = render(<FlaggedCommentsRoute />);

    expect(screen.getByText('This discussion needs moderator review.')).toBeTruthy();
    expect(screen.getByText('View comment')).toBeTruthy();

    fireEvent.press(screen.getByTestId('view-comment-comment-c1'));

    expect(mockWindowOpen).toHaveBeenCalledWith(
      '/eindhoven/5651ha/beeldbuisring/41/comments?returnTo=%2Fadmin%2Fcomments',
      '_blank',
      'noopener,noreferrer',
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
