import React, { type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, usePathname } from 'expo-router';

import { Button } from '@/src/components/ui/Button';
import {
  type AdminCommentTarget,
  type AdminLogEntry,
  type AdminPropertyTarget,
  type AdminReport,
  type AdminReportGroup,
  type AdminReporter,
  AdminForbiddenError,
} from '@/src/services/admin-moderation';
import {
  buildPropertyCommentsRoute,
  buildPropertyRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';
import { useT, type TranslationKey } from '@/src/i18n';

const COLORS = {
  background: '#F3F4F6',
  surface: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  text: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  blue: '#2563EB',
  blueSoft: '#EFF6FF',
  green: '#047857',
  greenSoft: '#ECFDF5',
  red: '#B91C1C',
  redSoft: '#FEF2F2',
  amber: '#B45309',
  amberSoft: '#FFFBEB',
} as const;

const NAV_ITEMS = [
  { labelKey: 'admin.nav.dashboard', href: '/admin' },
  { labelKey: 'admin.nav.flaggedProperties', href: '/admin/properties' },
  { labelKey: 'admin.nav.disabledProperties', href: '/admin/comments-disabled' },
  { labelKey: 'admin.nav.flaggedComments', href: '/admin/comments' },
  { labelKey: 'admin.nav.activityLogs', href: '/admin/activity' },
] as const;

export function AdminShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const sidebar = width >= 920;

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>{t('admin.brand')}</Text>
          <Text style={styles.headerMeta}>{t('admin.console')}</Text>
        </View>
        <Button
          label={t('admin.openApp')}
          variant="secondary"
          size="sm"
          onPress={() => router.push('/')}
        />
      </View>

      <View style={[styles.body, sidebar && styles.bodyWide]}>
        {sidebar ? (
          <View style={styles.sidebar}>
            <AdminNav pathname={pathname} vertical />
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.topNavScroller}
            contentContainerStyle={styles.topNav}
          >
            <AdminNav pathname={pathname} />
          </ScrollView>
        )}

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.contentScroller}
          contentContainerStyle={styles.content}
        >
          <View style={styles.pageHeader}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

function AdminNav({
  pathname,
  vertical = false,
}: {
  pathname: string;
  vertical?: boolean;
}) {
  const t = useT();

  return (
    <View style={vertical ? styles.navVertical : styles.navHorizontal}>
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Pressable
            key={item.href}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
            onPress={() => router.push(item.href)}
            style={[styles.navItem, active && styles.navItemActive]}
          >
            <Text style={[styles.navText, active && styles.navTextActive]}>
              {t(item.labelKey as TranslationKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AdminCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function AdminStatCard({
  label,
  value,
  tone = 'blue',
}: {
  label: string;
  value: string | number;
  tone?: 'blue' | 'green' | 'amber';
}) {
  return (
    <AdminCard>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text
          style={[
            styles.statValue,
            tone === 'green' && styles.statValueGreen,
            tone === 'amber' && styles.statValueAmber,
          ]}
        >
          {value}
        </Text>
      </View>
    </AdminCard>
  );
}

export function AdminBadge({
  label,
  tone = 'gray',
}: {
  label: string;
  tone?: 'gray' | 'blue' | 'green' | 'red' | 'amber';
}) {
  return (
    <View
      style={[
        styles.badge,
        tone === 'blue' && styles.badgeBlue,
        tone === 'green' && styles.badgeGreen,
        tone === 'red' && styles.badgeRed,
        tone === 'amber' && styles.badgeAmber,
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          tone === 'blue' && styles.badgeTextBlue,
          tone === 'green' && styles.badgeTextGreen,
          tone === 'red' && styles.badgeTextRed,
          tone === 'amber' && styles.badgeTextAmber,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function AdminEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <AdminCard>
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyBody}>{body}</Text>
      </View>
    </AdminCard>
  );
}

export function AdminLoadingState() {
  const t = useT();

  return (
    <AdminCard>
      <Text style={styles.stateText}>{t('admin.loadingQueue')}</Text>
    </AdminCard>
  );
}

export function AdminErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const t = useT();
  const forbidden = error instanceof AdminForbiddenError;

  return (
    <AdminCard>
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>
          {forbidden ? t('admin.error.forbidden') : t('admin.error.loadData')}
        </Text>
        <Text style={styles.emptyBody} selectable>
          {forbidden
            ? t('admin.error.forbiddenBody')
            : error instanceof Error
              ? error.message
              : t('admin.error.badResponse')}
        </Text>
        {onRetry ? (
          <Button label={t('common.retry')} variant="secondary" size="sm" onPress={onRetry} />
        ) : null}
      </View>
    </AdminCard>
  );
}

export function PropertyReportCard({
  group,
  onDismiss,
  onReview,
  onDisableComments,
  disabled,
}: {
  group: AdminReportGroup;
  onDismiss: () => void;
  onReview: () => void;
  onDisableComments: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const property = group.property;
  const propertyHref = getPropertyHref(property);

  return (
    <AdminCard>
      <View style={styles.reportCardHeader}>
        <View style={styles.reportTitleBlock}>
          <Text style={styles.reportTitle} selectable>
            {formatPropertyTitle(property, t('admin.propertyUnavailable'))}
          </Text>
          <Text style={styles.reportMeta} selectable>
            {formatPropertyLocation(property, t('admin.noAddressMetadata'))}
          </Text>
        </View>
        <AdminBadge label={t('admin.reportCount', { count: group.reportCount })} tone="red" />
      </View>

      <ReasonChips reasons={group.reasons} />

      <Text style={styles.reportMeta} selectable>
        {t('admin.latestReport', { date: formatDate(group.latestReportAt, t('admin.dateUnknown')) })}
      </Text>

      <View style={styles.actionsRow}>
        {propertyHref ? (
          <Button
            label={t('admin.actions.openPublicDetail')}
            variant="ghost"
            size="sm"
            onPress={() => openPublicHref(propertyHref)}
            testID={`open-property-${group.id}`}
          />
        ) : null}
        <Button
          label={t('admin.actions.disableComments')}
          variant="secondary"
          size="sm"
          disabled={disabled}
          onPress={onDisableComments}
          testID={`disable-comments-property-${group.id}`}
        />
        <Button
          label={t('admin.actions.dismissReports')}
          variant="secondary"
          size="sm"
          disabled={disabled}
          onPress={onDismiss}
          testID={`dismiss-property-${group.id}`}
        />
        <Button
          label={t('admin.actions.markPropertyReviewed')}
          variant="primary"
          size="sm"
          disabled={disabled}
          onPress={onReview}
          testID={`review-property-${group.id}`}
        />
      </View>
    </AdminCard>
  );
}

export function CommentReportCard({
  group,
  onDismiss,
  onHide,
  disabled,
}: {
  group: AdminReportGroup;
  onDismiss: () => void;
  onHide: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const comment = group.comment;
  const commentHref = getCommentHref(comment);

  return (
    <AdminCard>
      <View style={styles.reportCardHeader}>
        <View style={styles.reportTitleBlock}>
          <Text style={styles.reportTitle} selectable numberOfLines={3}>
            {comment?.text ?? t('admin.commentUnavailable')}
          </Text>
          <Text style={styles.reportMeta} selectable>
            {t('admin.commentOnProperty', {
              reporter: formatReporter(comment?.author, t('admin.unknownReporter')),
              property: formatPropertyTitle(comment?.property, t('admin.propertyUnavailable')),
            })}
          </Text>
        </View>
        <AdminBadge label={t('admin.reportCount', { count: group.reportCount })} tone="red" />
      </View>

      <ReasonChips reasons={group.reasons} />

      <Text style={styles.reportMeta} selectable>
        {t('admin.latestReport', { date: formatDate(group.latestReportAt, t('admin.dateUnknown')) })}
      </Text>

      <View style={styles.actionsRow}>
        {commentHref ? (
          <Button
            label={t('admin.actions.viewComment')}
            variant="ghost"
            size="sm"
            onPress={() => openPublicHref(commentHref)}
            testID={`view-comment-${group.id}`}
          />
        ) : null}
        <Button
          label={t('admin.actions.dismissReports')}
          variant="secondary"
          size="sm"
          disabled={disabled}
          onPress={onDismiss}
          testID={`dismiss-comment-${group.id}`}
        />
        <Button
          label={t('admin.actions.hideComment')}
          variant="primary"
          size="sm"
          disabled={disabled}
          onPress={onHide}
          testID={`hide-comment-${group.id}`}
        />
      </View>
    </AdminCard>
  );
}

export function RecentReportsList({ reports }: { reports: AdminReport[] }) {
  const t = useT();

  if (reports.length === 0) {
    return (
      <AdminEmptyState
        title={t('admin.empty.noRecentReports.title')}
        body={t('admin.empty.noRecentReports.body')}
      />
    );
  }

  return (
    <View style={styles.listStack}>
      {reports.slice(0, 6).map((report) => (
        <Pressable
          key={report.id}
          accessibilityRole="link"
          onPress={() => router.push(`/admin/reports/${report.id}`)}
          style={styles.listRow}
        >
          <View style={styles.listRowMain}>
            <Text style={styles.listTitle} selectable>
              {report.reason}
            </Text>
            <Text style={styles.listMeta} selectable>
              {report.targetType} - {formatDate(report.createdAt, t('admin.dateUnknown'))}
            </Text>
          </View>
          <Text style={styles.listChevron}>{t('admin.actions.view')}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ActivityLogList({ logs }: { logs: AdminLogEntry[] }) {
  const t = useT();

  if (logs.length === 0) {
    return (
      <AdminEmptyState
        title={t('admin.empty.noActivity.title')}
        body={t('admin.empty.noActivity.body')}
      />
    );
  }

  return (
    <View style={styles.listStack}>
      {logs.map((entry) => (
        <View key={entry.id} style={styles.logRow}>
          <View style={styles.logTime}>
            <Text style={styles.listMeta} selectable>
              {formatDate(entry.createdAt, t('admin.dateUnknown'))}
            </Text>
          </View>
          <View style={styles.listRowMain}>
            <Text style={styles.listTitle} selectable>
              {entry.action}
            </Text>
            <Text style={styles.listMeta} selectable>
              {formatReporter(entry.admin, t('admin.unknownReporter'))} - {entry.targetType ?? t('admin.targetFallback')}{' '}
              {entry.targetId ?? ''}
            </Text>
            {entry.details ? (
              <Text style={styles.logDetails} selectable numberOfLines={3}>
                {formatDetails(entry.details)}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function ReportDetailReportList({ reports }: { reports: AdminReport[] }) {
  const t = useT();

  return (
    <View style={styles.listStack}>
      {reports.map((report) => (
        <View key={report.id} style={styles.detailReport}>
          <View style={styles.reportCardHeader}>
            <View style={styles.reportTitleBlock}>
              <Text style={styles.listTitle} selectable>
                {report.reason}
              </Text>
              <Text style={styles.listMeta} selectable>
                {formatReporter(report.reporter, t('admin.unknownReporter'))} - {formatDate(report.createdAt, t('admin.dateUnknown'))}
              </Text>
            </View>
            {report.status ? <AdminBadge label={report.status} tone="amber" /> : null}
          </View>
          {report.details ? (
            <Text style={styles.detailText} selectable>
              {report.details}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ReasonChips({ reasons }: { reasons: string[] }) {
  const t = useT();

  return (
    <View style={styles.reasonRow}>
      {reasons.length > 0 ? (
        reasons.map((reason) => (
          <AdminBadge key={reason} label={reason} tone="amber" />
        ))
      ) : (
        <AdminBadge label={t('admin.noReasonSupplied')} />
      )}
    </View>
  );
}

export function formatDate(value: string | null | undefined, unknownLabel = 'unknown'): string {
  if (!value) {
    return unknownLabel;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatReporter(
  reporter?: AdminReporter | null,
  unknownReporterLabel = 'Unknown reporter',
): string {
  if (!reporter) {
    return unknownReporterLabel;
  }

  return reporter.displayName ?? reporter.username ?? reporter.email ?? reporter.id;
}

export function formatPropertyTitle(
  property?: AdminPropertyTarget | null,
  unavailableLabel = 'Property unavailable',
): string {
  if (!property) {
    return unavailableLabel;
  }

  if (property.address) {
    return property.address;
  }

  const street = property.streetName ?? property.street;
  const house = [property.houseNumber, property.houseNumberAddition]
    .filter(Boolean)
    .join(' ');
  const title = [street, house].filter(Boolean).join(' ');

  return title || property.id;
}

export function formatPropertyLocation(
  property?: AdminPropertyTarget | null,
  unavailableLabel = 'No address metadata',
): string {
  if (!property) {
    return unavailableLabel;
  }

  return [property.city, property.postalCode].filter(Boolean).join(' - ') || property.id;
}

export function formatCommentTarget(
  comment?: AdminCommentTarget | null,
  unavailableLabel = 'Comment unavailable',
): string {
  return comment?.text ?? unavailableLabel;
}

function getPropertyHref(property?: AdminPropertyTarget | null): string | null {
  if (!property) {
    return null;
  }

  try {
    return buildPropertyRoute(property, '/admin/properties');
  } catch {
    return null;
  }
}

function getCommentHref(comment?: AdminCommentTarget | null): string | null {
  if (!comment?.property) {
    return null;
  }

  try {
    return buildPropertyCommentsRoute(comment.property, '/admin/comments');
  } catch {
    return null;
  }
}

function openPublicHref(href: string) {
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof window.open === 'function'
  ) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }

  router.push(toInternalAppHref(href));
}

function formatDetails(details: string | Record<string, unknown>): string {
  if (typeof details === 'string') {
    return details;
  }

  return JSON.stringify(details);
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  brand: {
    color: COLORS.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    lineHeight: 26,
  },
  headerMeta: {
    color: COLORS.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  body: {
    flex: 1,
  },
  bodyWide: {
    flexDirection: 'row',
  },
  sidebar: {
    width: 248,
    padding: 16,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  topNavScroller: {
    maxHeight: 58,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topNav: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  navVertical: {
    gap: 8,
  },
  navHorizontal: {
    flexDirection: 'row',
    gap: 8,
  },
  navItem: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  navItemActive: {
    backgroundColor: COLORS.blueSoft,
  },
  navText: {
    color: COLORS.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  navTextActive: {
    color: COLORS.blue,
  },
  contentScroller: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 1180,
    padding: 24,
    gap: 16,
  },
  pageHeader: {
    gap: 4,
  },
  title: {
    color: COLORS.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    lineHeight: 36,
  },
  subtitle: {
    color: COLORS.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    gap: 12,
  },
  statCard: {
    gap: 8,
  },
  statLabel: {
    color: COLORS.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    textTransform: 'uppercase',
  },
  statValue: {
    color: COLORS.blue,
    fontFamily: 'Inter_700Bold',
    fontSize: 30,
    lineHeight: 36,
    fontVariant: ['tabular-nums'],
  },
  statValueGreen: {
    color: COLORS.green,
  },
  statValueAmber: {
    color: COLORS.amber,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  badgeBlue: {
    backgroundColor: COLORS.blueSoft,
    borderColor: '#BFDBFE',
  },
  badgeGreen: {
    backgroundColor: COLORS.greenSoft,
    borderColor: '#BBF7D0',
  },
  badgeRed: {
    backgroundColor: COLORS.redSoft,
    borderColor: '#FECACA',
  },
  badgeAmber: {
    backgroundColor: COLORS.amberSoft,
    borderColor: '#FDE68A',
  },
  badgeText: {
    color: COLORS.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
  },
  badgeTextBlue: {
    color: COLORS.blue,
  },
  badgeTextGreen: {
    color: COLORS.green,
  },
  badgeTextRed: {
    color: COLORS.red,
  },
  badgeTextAmber: {
    color: COLORS.amber,
  },
  emptyState: {
    gap: 10,
  },
  emptyTitle: {
    color: COLORS.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 24,
  },
  emptyBody: {
    color: COLORS.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  stateText: {
    color: COLORS.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  reportCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  reportTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  reportTitle: {
    color: COLORS.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    lineHeight: 24,
  },
  reportMeta: {
    color: COLORS.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  listStack: {
    gap: 10,
  },
  listRow: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  listRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  listTitle: {
    color: COLORS.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  listMeta: {
    color: COLORS.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  listChevron: {
    color: COLORS.blue,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  logRow: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
  },
  logTime: {
    width: 116,
  },
  logDetails: {
    color: COLORS.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  detailReport: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  detailText: {
    color: COLORS.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
});
