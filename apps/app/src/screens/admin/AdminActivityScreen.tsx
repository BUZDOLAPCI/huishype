import React from 'react';

import {
  ActivityLogList,
  AdminErrorState,
  AdminLoadingState,
  AdminShell,
} from '@/src/components/admin/AdminModerationLayout';
import { useAdminActivityLogs } from '@/src/hooks/admin/useAdminModeration';
import { AdminAccessGate } from '@/src/screens/admin/AdminAccess';
import { useT } from '@/src/i18n';

export function AdminActivityScreen() {
  const t = useT();

  return (
    <AdminShell
      title={t('admin.activity.title')}
      subtitle={t('admin.activity.subtitle')}
    >
      <AdminAccessGate>
        {(enabled) => <ActivityContent enabled={enabled} />}
      </AdminAccessGate>
    </AdminShell>
  );
}

function ActivityContent({ enabled }: { enabled: boolean }) {
  const logs = useAdminActivityLogs(enabled);

  if (logs.isLoading) {
    return <AdminLoadingState />;
  }

  if (logs.isError) {
    return (
      <AdminErrorState
        error={logs.error}
        onRetry={() => {
          void logs.refetch();
        }}
      />
    );
  }

  return <ActivityLogList logs={logs.data} />;
}
