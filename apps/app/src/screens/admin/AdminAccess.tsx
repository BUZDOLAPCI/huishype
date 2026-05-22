import React, { type ReactNode } from 'react';
import { Text } from 'react-native';

import { AdminCard } from '@/src/components/admin/AdminModerationLayout';
import { useT } from '@/src/i18n';
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
  const t = useT();
  const accessState = useAdminAccessState();

  if (accessState === 'loading') {
    return (
      <AdminCard>
        <Text>{t('admin.access.checking')}</Text>
      </AdminCard>
    );
  }

  if (accessState === 'signed-out') {
    return (
      <AdminCard>
        <Text>{t('admin.access.signedOut')}</Text>
      </AdminCard>
    );
  }

  if (accessState === 'forbidden') {
    return (
      <AdminCard>
        <Text>{t('admin.access.forbidden')}</Text>
      </AdminCard>
    );
  }

  return <>{children(true)}</>;
}
