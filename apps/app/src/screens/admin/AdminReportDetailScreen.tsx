import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  ActivityLogList,
  AdminBadge,
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminShell,
  ReportDetailReportList,
  formatCommentTarget,
  formatPropertyLocation,
  formatPropertyTitle,
} from '@/src/components/admin/AdminModerationLayout';
import {
  useAdminReportAction,
  useAdminReportDetail,
} from '@/src/hooks/admin/useAdminModeration';
import { AdminAccessGate } from '@/src/screens/admin/AdminAccess';
import type { AdminCommentTarget, AdminPropertyTarget } from '@/src/services/admin-moderation';
import { Button } from '@/src/components/ui/Button';
import { useT } from '@/src/i18n';

export function AdminReportDetailScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const reportId = Array.isArray(params.id) ? params.id[0] : params.id;

  return (
    <AdminShell
      title={t('admin.detail.title')}
      subtitle={t('admin.detail.subtitle')}
    >
      <AdminAccessGate>
        {(enabled) => (
          <DetailContent reportId={reportId ?? ''} enabled={enabled && !!reportId} />
        )}
      </AdminAccessGate>
    </AdminShell>
  );
}

function DetailContent({
  reportId,
  enabled,
}: {
  reportId: string;
  enabled: boolean;
}) {
  const t = useT();
  const query = useAdminReportDetail(reportId, enabled);
  const action = useAdminReportAction();

  if (!reportId) {
    return (
      <AdminCard>
        <Text style={styles.bodyText}>{t('admin.detail.missingReportId')}</Text>
      </AdminCard>
    );
  }

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

  const detail = query.data;
  if (!detail) {
    return (
      <AdminCard>
        <Text style={styles.bodyText}>{t('admin.detail.unavailable')}</Text>
      </AdminCard>
    );
  }

  const targetType = detail.report.targetType;

  return (
    <>
      <AdminCard>
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.cardTitle}>{t('admin.detail.targetPreview')}</Text>
            <TargetPreview
              targetType={targetType}
              property={detail.report.property ?? (detail.target as AdminPropertyTarget)}
              comment={detail.report.comment ?? (detail.target as AdminCommentTarget)}
            />
          </View>
          <AdminBadge label={targetType} tone="blue" />
        </View>

        <View style={styles.actionRow}>
          <Button
            label={t('admin.actions.dismissReports')}
            variant="secondary"
            size="sm"
            disabled={action.isPending}
            onPress={() =>
              action.mutate({
                reportId,
                input: {
                  action: 'dismiss_reports',
                  status: 'dismissed',
                  targetId: detail.report.targetId,
                  targetType,
                },
              })
            }
          />
          {targetType === 'property' ? (
            <Button
              label={t('admin.actions.markPropertyReviewed')}
              variant="primary"
              size="sm"
              disabled={action.isPending}
              onPress={() =>
                action.mutate({
                  reportId,
                  input: {
                    action: 'mark_property_reviewed',
                    status: 'reviewed',
                    targetId: detail.report.targetId,
                    targetType,
                  },
                })
              }
            />
          ) : (
            <Button
              label={t('admin.actions.hideComment')}
              variant="primary"
              size="sm"
              disabled={action.isPending}
              onPress={() =>
                action.mutate({
                  reportId,
                  input: {
                    action: 'hide_comment',
                    status: 'hidden',
                    targetId: detail.report.targetId,
                    targetType,
                  },
                })
              }
            />
          )}
        </View>
      </AdminCard>

      <AdminCard>
        <Text style={styles.cardTitle}>{t('admin.detail.activeReports')}</Text>
        <ReportDetailReportList reports={detail.activeReports} />
      </AdminCard>

      <AdminCard>
        <Text style={styles.cardTitle}>{t('admin.dashboard.recentActions')}</Text>
        {detail.recentModerationActions.length > 0 ? (
          <ActivityLogList logs={detail.recentModerationActions} />
        ) : (
          <Text style={styles.bodyText}>
            {t('admin.detail.noActions')}
          </Text>
        )}
      </AdminCard>
    </>
  );
}

function TargetPreview({
  targetType,
  property,
  comment,
}: {
  targetType: 'property' | 'comment';
  property?: AdminPropertyTarget | null;
  comment?: AdminCommentTarget | null;
}) {
  const t = useT();

  if (targetType === 'comment') {
    return (
      <View style={styles.previewBlock}>
        <Text style={styles.previewTitle} selectable>
          {formatCommentTarget(comment, t('admin.commentUnavailable'))}
        </Text>
        <Text style={styles.previewMeta} selectable>
          {formatPropertyTitle(comment?.property ?? property, t('admin.propertyUnavailable'))}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.previewBlock}>
      <Text style={styles.previewTitle} selectable>
        {formatPropertyTitle(property, t('admin.propertyUnavailable'))}
      </Text>
      <Text style={styles.previewMeta} selectable>
        {formatPropertyLocation(property, t('admin.noAddressMetadata'))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 10,
  },
  cardTitle: {
    color: '#111827',
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 24,
  },
  previewBlock: {
    gap: 4,
  },
  previewTitle: {
    color: '#111827',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    lineHeight: 23,
  },
  previewMeta: {
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  bodyText: {
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
});
