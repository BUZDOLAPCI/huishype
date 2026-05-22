import React from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import {
  AdminCard,
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminShell,
  CommentReportCard,
  PropertyReportCard,
  formatDate,
  formatPropertyLocation,
  formatPropertyTitle,
} from '@/src/components/admin/AdminModerationLayout';
import { Button } from '@/src/components/ui/Button';
import {
  useAdminCommentReports,
  useAdminDisabledProperties,
  useAdminPropertyCommentsAction,
  useAdminPropertyReports,
  useAdminReportAction,
} from '@/src/hooks/admin/useAdminModeration';
import { AdminAccessGate } from '@/src/screens/admin/AdminAccess';
import type { AdminDisabledProperty, AdminReportGroup } from '@/src/services/admin-moderation';
import { resolveMapRoute } from '@/src/lib/mapRoute';
import { buildPropertyRoute, toInternalAppHref } from '@/src/utils/property-route';
import { useT } from '@/src/i18n';

export function AdminFlaggedPropertiesScreen() {
  const t = useT();

  return (
    <AdminShell
      title={t('admin.reports.flaggedProperties.title')}
      subtitle={t('admin.reports.flaggedProperties.subtitle')}
    >
      <AdminAccessGate>
        {(enabled) => <FlaggedPropertiesContent enabled={enabled} />}
      </AdminAccessGate>
    </AdminShell>
  );
}

export function AdminFlaggedCommentsScreen() {
  const t = useT();

  return (
    <AdminShell
      title={t('admin.reports.flaggedComments.title')}
      subtitle={t('admin.reports.flaggedComments.subtitle')}
    >
      <AdminAccessGate>
        {(enabled) => <FlaggedCommentsContent enabled={enabled} />}
      </AdminAccessGate>
    </AdminShell>
  );
}

export function AdminDisabledPropertiesScreen() {
  const t = useT();

  return (
    <AdminShell
      title={t('admin.reports.disabledProperties.title')}
      subtitle={t('admin.reports.disabledProperties.subtitle')}
    >
      <AdminAccessGate>
        {(enabled) => <DisabledPropertiesContent enabled={enabled} />}
      </AdminAccessGate>
    </AdminShell>
  );
}

function FlaggedPropertiesContent({ enabled }: { enabled: boolean }) {
  const t = useT();
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
        title={t('admin.empty.noFlaggedProperties.title')}
        body={t('admin.empty.noFlaggedProperties.body')}
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
          onDisableComments={() => runGroupAction(action.mutate, group, 'disable_property_comments')}
        />
      ))}
    </View>
  );
}

function FlaggedCommentsContent({ enabled }: { enabled: boolean }) {
  const t = useT();
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
        title={t('admin.empty.noFlaggedComments.title')}
        body={t('admin.empty.noFlaggedComments.body')}
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

function DisabledPropertiesContent({ enabled }: { enabled: boolean }) {
  const t = useT();
  const query = useAdminDisabledProperties(enabled);
  const action = useAdminPropertyCommentsAction();
  const [targetInput, setTargetInput] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const handleDisable = React.useCallback(async () => {
    setFormError(null);
    const propertyId = await resolvePropertyIdInput(targetInput, {
      enterProperty: t('admin.disable.enterProperty'),
      notPropertyUrl: t('admin.disable.notPropertyUrl'),
    }).catch((error) => {
      setFormError(error instanceof Error ? error.message : t('admin.disable.unableToResolve'));
      return null;
    });
    if (!propertyId) {
      return;
    }

    action.mutate({
      propertyId,
      action: 'disable',
      reason: reason.trim() || undefined,
    });
  }, [action, reason, t, targetInput]);

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

  const items = query.data ?? [];

  return (
    <View style={styles.stack}>
      <AdminCard>
        <View style={styles.formStack}>
          <Text style={styles.formTitle}>{t('admin.disable.formTitle')}</Text>
          <TextInput
            value={targetInput}
            onChangeText={setTargetInput}
            placeholder={t('admin.disable.targetPlaceholder')}
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t('admin.disable.reasonPlaceholder')}
            maxLength={140}
            style={styles.input}
          />
          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
          <Button
            label={t('admin.actions.disableComments')}
            variant="primary"
            size="sm"
            disabled={action.isPending || !targetInput.trim()}
            onPress={() => {
              void handleDisable();
            }}
            testID="disable-comments-submit"
          />
        </View>
      </AdminCard>

      {items.length === 0 ? (
        <AdminEmptyState
          title={t('admin.empty.noDisabledProperties.title')}
          body={t('admin.empty.noDisabledProperties.body')}
        />
      ) : (
        items.map((property) => (
          <DisabledPropertyCard
            key={property.id}
            property={property}
            disabled={action.isPending}
            onEnable={() =>
              action.mutate({
                propertyId: property.id,
                action: 'enable',
              })
            }
          />
        ))
      )}
    </View>
  );
}

function DisabledPropertyCard({
  property,
  disabled,
  onEnable,
}: {
  property: AdminDisabledProperty;
  disabled?: boolean;
  onEnable: () => void;
}) {
  const t = useT();

  return (
    <AdminCard>
      <View style={styles.reportCardShim}>
        <View style={styles.formStack}>
          <Text style={styles.formTitle} selectable>
            {formatPropertyTitle(property, t('admin.propertyUnavailable'))}
          </Text>
          <Text style={styles.mutedText} selectable>
            {formatPropertyLocation(property, t('admin.noAddressMetadata'))}
          </Text>
          <Text style={styles.mutedText} selectable>
            {t('admin.disabledAt', {
              date: formatDate(property.commentsDisabledAt, t('admin.dateUnknown')),
            })}
            {property.commentsDisabledReason ? ` - ${property.commentsDisabledReason}` : ''}
          </Text>
        </View>
        <View style={styles.actionsRowShim}>
          <Button
            label={t('admin.actions.openPublicDetail')}
            variant="ghost"
            size="sm"
            onPress={() => router.push(toInternalAppHref(buildPropertyRoute(property, '/admin/comments-disabled')))}
            testID={`open-disabled-property-${property.id}`}
          />
          <Button
            label={t('admin.actions.enableComments')}
            variant="primary"
            size="sm"
            disabled={disabled}
            onPress={onEnable}
            testID={`enable-comments-${property.id}`}
          />
        </View>
      </View>
    </AdminCard>
  );
}

async function resolvePropertyIdInput(
  value: string,
  messages: { enterProperty: string; notPropertyUrl: string },
): Promise<string> {
  const trimmed = value.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed, 'https://huishype.nl');
  } catch {
    throw new Error(messages.enterProperty);
  }

  const resolved = await resolveMapRoute(url.pathname);
  if (
    resolved.kind !== 'preview' &&
    resolved.kind !== 'property' &&
    resolved.kind !== 'comments' &&
    resolved.kind !== 'guesses'
  ) {
    throw new Error(messages.notPropertyUrl);
  }

  return resolved.property.id;
}

function runGroupAction(
  mutate: ReturnType<typeof useAdminReportAction>['mutate'],
  group: AdminReportGroup,
  action:
    | 'dismiss_reports'
    | 'mark_property_reviewed'
    | 'hide_comment'
    | 'disable_property_comments',
) {
  const anchorReportId = group.reports[0]?.id ?? group.id;
  const status =
    action === 'dismiss_reports'
      ? 'dismissed'
      : action === 'hide_comment'
        ? 'hidden'
        : action === 'disable_property_comments'
          ? 'resolved'
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
  formStack: {
    gap: 10,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
  },
  mutedText: {
    color: '#6B7280',
    fontSize: 13,
  },
  reportCardShim: {
    gap: 14,
  },
  actionsRowShim: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
