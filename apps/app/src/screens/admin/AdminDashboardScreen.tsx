import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

import {
  ActivityLogList,
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminShell,
  AdminStatCard,
  RecentReportsList,
} from '@/src/components/admin/AdminModerationLayout';
import { useAdminDashboard } from '@/src/hooks/admin/useAdminModeration';
import { AdminAccessGate } from '@/src/screens/admin/AdminAccess';

export function AdminDashboardScreen() {
  return (
    <AdminShell
      title="Dashboard"
      subtitle="Pending reports and recent moderation activity."
    >
      <AdminAccessGate>
        {(enabled) => <DashboardContent enabled={enabled} />}
      </AdminAccessGate>
    </AdminShell>
  );
}

function DashboardContent({ enabled }: { enabled: boolean }) {
  const { propertyReports, commentReports, isLoading, isError, error } =
    useAdminDashboard(enabled);

  if (isLoading) {
    return <AdminLoadingState />;
  }

  if (isError) {
    return (
      <AdminErrorState
        error={error}
        onRetry={() => {
          void propertyReports.refetch();
          void commentReports.refetch();
        }}
      />
    );
  }

  const recentReports = [
    ...(propertyReports.data?.recentReports ?? []),
    ...(commentReports.data?.recentReports ?? []),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const recentModerationActions = [
    ...(propertyReports.data?.recentModerationActions ?? []),
    ...(commentReports.data?.recentModerationActions ?? []),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <>
      <View style={styles.statsGrid}>
        <AdminStatCard
          label="Pending property reports"
          value={propertyReports.data?.pendingCount ?? 0}
          tone="amber"
        />
        <AdminStatCard
          label="Pending comment reports"
          value={commentReports.data?.pendingCount ?? 0}
          tone="blue"
        />
      </View>

      <View style={styles.twoColumn}>
        <AdminCard>
          <View style={styles.section}>
            <SectionTitle title="Recent reports" />
            {recentReports.length > 0 ? (
              <RecentReportsList reports={recentReports} />
            ) : (
              <Text style={styles.emptyText}>
                New property and comment reports will appear here.
              </Text>
            )}
          </View>
        </AdminCard>

        <AdminCard>
          <View style={styles.section}>
            <SectionTitle title="Recent moderation actions" />
            {recentModerationActions.length > 0 ? (
              <ActivityLogList logs={recentModerationActions.slice(0, 6)} />
            ) : (
              <Text style={styles.emptyText}>
                Moderation actions returned by the API will appear here.
              </Text>
            )}
          </View>
        </AdminCard>
      </View>
    </>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text style={styles.sectionTitle} accessibilityRole="header">
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  section: {
    minWidth: 280,
    flex: 1,
    gap: 12,
  },
  sectionTitle: {
    color: '#111827',
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 24,
  },
  emptyText: {
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
});
