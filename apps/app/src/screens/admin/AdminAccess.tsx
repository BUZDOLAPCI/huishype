import React, { type ReactNode } from 'react';
import { Text } from 'react-native';

import { AdminCard } from '@/src/components/admin/AdminModerationLayout';
import { useAuthContext, type AuthUser } from '@/src/providers/AuthProvider';

type AdminAuthState = 'loading' | 'signed-out' | 'forbidden' | 'allowed';

type AdminAwareUser = AuthUser & {
  isAdmin?: boolean;
  admin?: boolean;
  role?: string;
  roles?: string[];
  permissions?: string[];
};

function hasExplicitAdminSignal(user: AdminAwareUser): boolean {
  return (
    typeof user.isAdmin === 'boolean' ||
    typeof user.admin === 'boolean' ||
    typeof user.role === 'string' ||
    Array.isArray(user.roles) ||
    Array.isArray(user.permissions)
  );
}

function userHasAdminAccess(user: AdminAwareUser): boolean {
  return Boolean(
    user.isAdmin === true ||
    user.admin === true ||
    user.role === 'admin' ||
    user.roles?.includes('admin') ||
    user.permissions?.includes('admin'),
  );
}

export function useAdminAccessState(): AdminAuthState {
  const { user, isAuthenticated, isLoading } = useAuthContext();

  if (isLoading) {
    return 'loading';
  }

  if (!isAuthenticated || !user) {
    return 'signed-out';
  }

  const adminAwareUser = user as AdminAwareUser;
  if (!hasExplicitAdminSignal(adminAwareUser) || !userHasAdminAccess(adminAwareUser)) {
    return 'forbidden';
  }

  return 'allowed';
}

export function AdminAccessGate({
  children,
}: {
  children: (enabled: boolean) => ReactNode;
}) {
  const accessState = useAdminAccessState();

  if (accessState === 'loading') {
    return (
      <AdminCard>
        <Text>Checking admin session...</Text>
      </AdminCard>
    );
  }

  if (accessState === 'signed-out') {
    return (
      <AdminCard>
        <Text>You need to sign in before opening the admin console.</Text>
      </AdminCard>
    );
  }

  if (accessState === 'forbidden') {
    return (
      <AdminCard>
        <Text>Your account does not have admin access.</Text>
      </AdminCard>
    );
  }

  return <>{children(true)}</>;
}
