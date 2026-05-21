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

export function AdminDisabledPropertiesScreen() {
  return (
    <AdminShell
      title="Disabled Properties"
      subtitle="Review properties where public comment threads are paused."
    >
      <AdminAccessGate>
        {(enabled) => <DisabledPropertiesContent enabled={enabled} />}
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
          onDisableComments={() => runGroupAction(action.mutate, group, 'disable_property_comments')}
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

function DisabledPropertiesContent({ enabled }: { enabled: boolean }) {
  const query = useAdminDisabledProperties(enabled);
  const action = useAdminPropertyCommentsAction();
  const [targetInput, setTargetInput] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const handleDisable = React.useCallback(async () => {
    setFormError(null);
    const propertyId = await resolvePropertyIdInput(targetInput).catch((error) => {
      setFormError(error instanceof Error ? error.message : 'Unable to resolve property.');
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
  }, [action, reason, targetInput]);

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
          <Text style={styles.formTitle}>Disable comments by property</Text>
          <TextInput
            value={targetInput}
            onChangeText={setTargetInput}
            placeholder="Property UUID or HuisHype URL"
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Optional reason"
            maxLength={140}
            style={styles.input}
          />
          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
          <Button
            label="Disable comments"
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
          title="No disabled properties"
          body="Properties with paused comment threads will show up here."
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
  return (
    <AdminCard>
      <View style={styles.reportCardShim}>
        <View style={styles.formStack}>
          <Text style={styles.formTitle} selectable>
            {formatPropertyTitle(property)}
          </Text>
          <Text style={styles.mutedText} selectable>
            {formatPropertyLocation(property)}
          </Text>
          <Text style={styles.mutedText} selectable>
            Disabled {formatDate(property.commentsDisabledAt)}
            {property.commentsDisabledReason ? ` - ${property.commentsDisabledReason}` : ''}
          </Text>
        </View>
        <View style={styles.actionsRowShim}>
          <Button
            label="Open public detail"
            variant="ghost"
            size="sm"
            onPress={() => router.push(toInternalAppHref(buildPropertyRoute(property, '/admin/comments-disabled')))}
            testID={`open-disabled-property-${property.id}`}
          />
          <Button
            label="Enable comments"
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

async function resolvePropertyIdInput(value: string): Promise<string> {
  const trimmed = value.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed, 'https://huishype.nl');
  } catch {
    throw new Error('Enter a property UUID or HuisHype URL.');
  }

  const resolved = await resolveMapRoute(url.pathname);
  if (
    resolved.kind !== 'preview' &&
    resolved.kind !== 'property' &&
    resolved.kind !== 'comments' &&
    resolved.kind !== 'guesses'
  ) {
    throw new Error('The URL does not point to a property.');
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
