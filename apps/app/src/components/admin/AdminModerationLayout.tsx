import React, { type ReactNode } from 'react';
import {
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
  buildPropertyRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';

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
  { label: 'Dashboard', href: '/admin' },
  { label: 'Flagged Properties', href: '/admin/properties' },
  { label: 'Flagged Comments', href: '/admin/comments' },
  { label: 'Activity Logs', href: '/admin/activity' },
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
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const sidebar = width >= 920;

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>HuisHype Admin</Text>
          <Text style={styles.headerMeta}>Moderation console</Text>
        </View>
        <Button
          label="Open App"
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
  return (
    <View style={vertical ? styles.navVertical : styles.navHorizontal}>
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href);

        return (
          <Pressable
            key={item.href}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
            onPress={() => router.push(item.href)}
            style={[styles.navItem, active && styles.navItemActive]}
          >
            <Text style={[styles.navText, active && styles.navTextActive]}>
              {item.label}
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
  return (
    <AdminCard>
      <Text style={styles.stateText}>Loading moderation queue...</Text>
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
  const forbidden = error instanceof AdminForbiddenError;

  return (
    <AdminCard>
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>
          {forbidden ? 'Forbidden' : 'Unable to load admin data'}
        </Text>
        <Text style={styles.emptyBody} selectable>
          {forbidden
            ? 'Your account is signed in but does not have admin access.'
            : error instanceof Error
              ? error.message
              : 'The moderation API did not return a usable response.'}
        </Text>
        {onRetry ? (
          <Button label="Retry" variant="secondary" size="sm" onPress={onRetry} />
        ) : null}
      </View>
    </AdminCard>
  );
}

export function PropertyReportCard({
  group,
  onDismiss,
  onReview,
  disabled,
}: {
  group: AdminReportGroup;
  onDismiss: () => void;
  onReview: () => void;
  disabled?: boolean;
}) {
  const property = group.property;
  const propertyHref = getPropertyHref(property);

  return (
    <AdminCard>
      <View style={styles.reportCardHeader}>
        <View style={styles.reportTitleBlock}>
          <Text style={styles.reportTitle} selectable>
            {formatPropertyTitle(property)}
          </Text>
          <Text style={styles.reportMeta} selectable>
            {formatPropertyLocation(property)}
          </Text>
        </View>
        <AdminBadge label={`${group.reportCount} reports`} tone="red" />
      </View>

      <ReasonChips reasons={group.reasons} />

      <Text style={styles.reportMeta} selectable>
        Latest report {formatDate(group.latestReportAt)}
      </Text>

      <View style={styles.actionsRow}>
        {propertyHref ? (
          <Button
            label="Open public detail"
            variant="ghost"
            size="sm"
            onPress={() => router.push(toInternalAppHref(propertyHref))}
          />
        ) : null}
        <Button
          label="Dismiss reports"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onPress={onDismiss}
          testID={`dismiss-property-${group.id}`}
        />
        <Button
          label="Mark property reviewed"
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
  const comment = group.comment;

  return (
    <AdminCard>
      <View style={styles.reportCardHeader}>
        <View style={styles.reportTitleBlock}>
          <Text style={styles.reportTitle} selectable numberOfLines={3}>
            {comment?.text ?? 'Comment unavailable'}
          </Text>
          <Text style={styles.reportMeta} selectable>
            {formatReporter(comment?.author)} on {formatPropertyTitle(comment?.property)}
          </Text>
        </View>
        <AdminBadge label={`${group.reportCount} reports`} tone="red" />
      </View>

      <ReasonChips reasons={group.reasons} />

      <Text style={styles.reportMeta} selectable>
        Latest report {formatDate(group.latestReportAt)}
      </Text>

      <View style={styles.actionsRow}>
        <Button
          label="Dismiss reports"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onPress={onDismiss}
          testID={`dismiss-comment-${group.id}`}
        />
        <Button
          label="Hide comment"
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
  if (reports.length === 0) {
    return <AdminEmptyState title="No recent reports" body="Incoming reports will appear here." />;
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
              {report.targetType} - {formatDate(report.createdAt)}
            </Text>
          </View>
          <Text style={styles.listChevron}>View</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ActivityLogList({ logs }: { logs: AdminLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <AdminEmptyState
        title="No activity yet"
        body="Moderation actions returned by the admin reports API will appear here."
      />
    );
  }

  return (
    <View style={styles.listStack}>
      {logs.map((entry) => (
        <View key={entry.id} style={styles.logRow}>
          <View style={styles.logTime}>
            <Text style={styles.listMeta} selectable>
              {formatDate(entry.createdAt)}
            </Text>
          </View>
          <View style={styles.listRowMain}>
            <Text style={styles.listTitle} selectable>
              {entry.action}
            </Text>
            <Text style={styles.listMeta} selectable>
              {formatReporter(entry.admin)} - {entry.targetType ?? 'target'}{' '}
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
                {formatReporter(report.reporter)} - {formatDate(report.createdAt)}
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
  return (
    <View style={styles.reasonRow}>
      {reasons.length > 0 ? (
        reasons.map((reason) => (
          <AdminBadge key={reason} label={reason} tone="amber" />
        ))
      ) : (
        <AdminBadge label="No reason supplied" />
      )}
    </View>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown';
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

export function formatReporter(reporter?: AdminReporter | null): string {
  if (!reporter) {
    return 'Unknown reporter';
  }

  return reporter.displayName ?? reporter.username ?? reporter.email ?? reporter.id;
}

export function formatPropertyTitle(property?: AdminPropertyTarget | null): string {
  if (!property) {
    return 'Property unavailable';
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

export function formatPropertyLocation(property?: AdminPropertyTarget | null): string {
  if (!property) {
    return 'No address metadata';
  }

  return [property.city, property.postalCode].filter(Boolean).join(' - ') || property.id;
}

export function formatCommentTarget(comment?: AdminCommentTarget | null): string {
  return comment?.text ?? 'Comment unavailable';
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
