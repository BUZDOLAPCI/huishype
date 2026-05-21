import React from 'react';
import { View, StyleSheet } from 'react-native';

import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminShell,
  CommentReportCard,
  PropertyReportCard,
} from '@/src/components/admin/AdminModerationLayout';
import {
  useAdminCommentReports,
  useAdminPropertyReports,
  useAdminReportAction,
} from '@/src/hooks/admin/useAdminModeration';
import { AdminAccessGate } from '@/src/screens/admin/AdminAccess';
import type { AdminReportGroup } from '@/src/services/admin-moderation';

export function AdminFlaggedPropertiesScreen() {
  return (
    <AdminShell
      title="Flagged Properties"
      subtitle="Review active property reports and mark addressed targets."
    >
      <AdminAccessGate>
        {(enabled) => <FlaggedPropertiesContent enabled={enabled} />}
      </AdminAccessGate>
    </AdminShell>
  );
}

export function AdminFlaggedCommentsScreen() {
  return (
    <AdminShell
      title="Flagged Comments"
      subtitle="Review reported discussion and hide comments when needed."
    >
      <AdminAccessGate>
        {(enabled) => <FlaggedCommentsContent enabled={enabled} />}
      </AdminAccessGate>
    </AdminShell>
  );
}

function FlaggedPropertiesContent({ enabled }: { enabled: boolean }) {
  const query = useAdminPropertyReports(enabled);
  const action = useAdminReportAction();

  if (query.isLoading) {
    return <AdminLoadingState />;
  }

  if (query.isError) {
    return (
      <AdminErrorState
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <AdminEmptyState
        title="No flagged properties"
        body="Pending property reports will show up in this queue."
      />
    );
  }

  return (
    <View style={styles.stack}>
      {items.map((group) => (
        <PropertyReportCard
          key={group.id}
          group={group}
          disabled={action.isPending}
          onDismiss={() => runGroupAction(action.mutate, group, 'dismiss_reports')}
          onReview={() => runGroupAction(action.mutate, group, 'mark_property_reviewed')}
        />
      ))}
    </View>
  );
}

function FlaggedCommentsContent({ enabled }: { enabled: boolean }) {
  const query = useAdminCommentReports(enabled);
  const action = useAdminReportAction();

  if (query.isLoading) {
    return <AdminLoadingState />;
  }

  if (query.isError) {
    return (
      <AdminErrorState
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <AdminEmptyState
        title="No flagged comments"
        body="Pending comment reports will show up in this queue."
      />
    );
  }

  return (
    <View style={styles.stack}>
      {items.map((group) => (
        <CommentReportCard
          key={group.id}
          group={group}
          disabled={action.isPending}
          onDismiss={() => runGroupAction(action.mutate, group, 'dismiss_reports')}
          onHide={() => runGroupAction(action.mutate, group, 'hide_comment')}
        />
      ))}
    </View>
  );
}

function runGroupAction(
  mutate: ReturnType<typeof useAdminReportAction>['mutate'],
  group: AdminReportGroup,
  action:
    | 'dismiss_reports'
    | 'mark_property_reviewed'
    | 'hide_comment',
) {
  const anchorReportId = group.reports[0]?.id ?? group.id;
  const status =
    action === 'dismiss_reports'
      ? 'dismissed'
      : action === 'hide_comment'
        ? 'hidden'
        : 'reviewed';

  mutate({
    reportId: anchorReportId,
    input: {
      action,
      status,
      targetId: group.targetId,
      targetType: group.targetType,
    },
  });
}

const styles = StyleSheet.create({
  stack: {
    gap: 12,
  },
});
