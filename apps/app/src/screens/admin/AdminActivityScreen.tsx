import React from 'react';

import {
  ActivityLogList,
  AdminErrorState,
  AdminLoadingState,
  AdminShell,
} from '@/src/components/admin/AdminModerationLayout';
import { useAdminActivityLogs } from '@/src/hooks/admin/useAdminModeration';
import { AdminAccessGate } from '@/src/screens/admin/AdminAccess';

export function AdminActivityScreen() {
  return (
    <AdminShell
      title="Activity Logs"
      subtitle="Recent admin log entries from moderation actions."
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
