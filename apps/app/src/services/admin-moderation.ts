import { ApiError, API_URL } from '@/src/utils/api';

export type AdminReportTargetType = 'property' | 'comment';

export interface AdminReporter {
  id: string;
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  karma?: number | null;
}

export interface AdminPropertyTarget {
  id: string;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  street?: string | null;
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
  countryCode?: string | null;
}

export interface AdminCommentTarget {
  id: string;
  text?: string | null;
  author?: AdminReporter | null;
  property?: AdminPropertyTarget | null;
}

export interface AdminReport {
  id: string;
  targetType: AdminReportTargetType;
  targetId: string;
  reason: string;
  details?: string | null;
  status?: string | null;
  createdAt: string;
  reporter?: AdminReporter | null;
  property?: AdminPropertyTarget | null;
  comment?: AdminCommentTarget | null;
}

export interface AdminReportGroup {
  id: string;
  targetType: AdminReportTargetType;
  targetId: string;
  reportCount: number;
  latestReportAt: string;
  reasons: string[];
  reports: AdminReport[];
  property?: AdminPropertyTarget | null;
  comment?: AdminCommentTarget | null;
}

export interface AdminLogEntry {
  id: string;
  createdAt: string;
  admin?: AdminReporter | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | Record<string, unknown> | null;
}

export interface AdminReportListResponse {
  items: AdminReportGroup[];
  recentReports: AdminReport[];
  recentModerationActions: AdminLogEntry[];
  pendingCount: number;
}

export interface AdminReportDetailResponse {
  report: AdminReport;
  target: AdminPropertyTarget | AdminCommentTarget | null;
  activeReports: AdminReport[];
  recentModerationActions: AdminLogEntry[];
}

export interface AdminReportPatchInput {
  action:
    | 'dismiss_reports'
    | 'mark_property_reviewed'
    | 'hide_comment'
    | 'mark_reviewed';
  status?: 'dismissed' | 'reviewed' | 'hidden' | 'resolved';
  targetId?: string;
  targetType?: AdminReportTargetType;
  note?: string;
}

export interface AdminReportPatchResponse {
  report?: AdminReport;
  updatedCount?: number;
  log?: AdminLogEntry;
  success?: boolean;
}

export class AdminForbiddenError extends Error {
  status: 401 | 403;

  constructor(status: 401 | 403, message = 'Admin access required') {
    super(message);
    this.name = 'AdminForbiddenError';
    this.status = status;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
}

function normalizeReporter(value: unknown): AdminReporter | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id) ?? stringValue(value.userId);
  if (!id) {
    return null;
  }

  return {
    id,
    displayName:
      stringValue(value.displayName) ?? stringValue(value.name) ?? null,
    username:
      stringValue(value.username) ?? stringValue(value.handle) ?? null,
    email: stringValue(value.email) ?? null,
    karma: numberValue(value.karma) ?? null,
  };
}

function normalizeProperty(value: unknown): AdminPropertyTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id) ?? stringValue(value.propertyId);
  if (!id) {
    return null;
  }

  return {
    id,
    address: stringValue(value.address) ?? stringValue(value.displayAddress) ?? null,
    city: stringValue(value.city) ?? null,
    postalCode:
      stringValue(value.postalCode) ?? stringValue(value.postcode) ?? null,
    street: stringValue(value.street) ?? null,
    streetName: stringValue(value.streetName) ?? null,
    houseNumber:
      stringValue(value.houseNumber) ?? numberValue(value.houseNumber) ?? null,
    houseNumberAddition: stringValue(value.houseNumberAddition) ?? null,
    countryCode: stringValue(value.countryCode) ?? stringValue(value.country_code) ?? null,
  };
}

function normalizeComment(value: unknown): AdminCommentTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id) ?? stringValue(value.commentId);
  if (!id) {
    return null;
  }

  return {
    id,
    text:
      stringValue(value.text) ??
      stringValue(value.body) ??
      stringValue(value.commentText) ??
      null,
    author:
      normalizeReporter(value.author) ??
      normalizeReporter(value.user) ??
      normalizeReporter(value.commentAuthor),
    property:
      normalizeProperty(value.property) ?? normalizeProperty(value.relatedProperty),
  };
}

export function normalizeAdminReport(value: unknown): AdminReport {
  if (!isRecord(value)) {
    throw new Error('Invalid admin report payload');
  }

  const property = normalizeProperty(value.property) ?? normalizeProperty(value.target);
  const comment = normalizeComment(value.comment) ?? normalizeComment(value.target);
  const targetType =
    stringValue(value.targetType) === 'comment' || comment
      ? 'comment'
      : 'property';
  const targetId =
    stringValue(value.targetId) ??
    stringValue(value.propertyId) ??
    stringValue(value.commentId) ??
    property?.id ??
    comment?.id ??
    stringValue(value.id) ??
    'unknown';

  return {
    id: stringValue(value.id) ?? targetId,
    targetType,
    targetId,
    reason: stringValue(value.reason) ?? stringValue(value.category) ?? 'Other',
    details:
      stringValue(value.details) ??
      stringValue(value.description) ??
      stringValue(value.message) ??
      null,
    status: stringValue(value.status) ?? null,
    createdAt:
      stringValue(value.createdAt) ??
      stringValue(value.created_at) ??
      new Date(0).toISOString(),
    reporter:
      normalizeReporter(value.reporter) ??
      normalizeReporter(value.reportedBy) ??
      normalizeReporter(value.user),
    property,
    comment,
  };
}

function normalizeLog(value: unknown): AdminLogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id);
  const action = stringValue(value.action);
  const createdAt = stringValue(value.createdAt) ?? stringValue(value.created_at);

  if (!id || !action || !createdAt) {
    return null;
  }

  return {
    id,
    createdAt,
    admin:
      normalizeReporter(value.admin) ??
      normalizeReporter(value.adminUser) ??
      normalizeReporter(value.user),
    action,
    targetType: stringValue(value.targetType) ?? stringValue(value.target_type) ?? null,
    targetId: stringValue(value.targetId) ?? stringValue(value.target_id) ?? null,
    details: isRecord(value.details) || typeof value.details === 'string'
      ? value.details
      : null,
  };
}

function extractArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of keys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function groupReportsByTarget(
  reports: AdminReport[],
  fallbackType: AdminReportTargetType,
): AdminReportGroup[] {
  const grouped = new Map<string, AdminReport[]>();

  for (const report of reports) {
    const key = `${report.targetType ?? fallbackType}:${report.targetId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), report]);
  }

  return Array.from(grouped.values()).map((group) => {
    const sorted = [...group].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    return reportGroupFromReports(sorted, fallbackType);
  });
}

function normalizeReportGroup(value: unknown, fallbackType: AdminReportTargetType): AdminReportGroup {
  if (!isRecord(value)) {
    const report = normalizeAdminReport(value);
    return reportGroupFromReports([report], fallbackType);
  }

  const reports = extractArray(value.reports, ['items', 'reports']).map(normalizeAdminReport);
  if (reports.length === 0 && stringValue(value.reason)) {
    reports.push(normalizeAdminReport(value));
  }

  const property = normalizeProperty(value.property) ?? reports[0]?.property ?? null;
  const comment = normalizeComment(value.comment) ?? reports[0]?.comment ?? null;
  const targetType: AdminReportTargetType =
    stringValue(value.targetType) === 'comment' || fallbackType === 'comment'
      ? 'comment'
      : 'property';
  const targetId =
    stringValue(value.targetId) ??
    property?.id ??
    comment?.id ??
    reports[0]?.targetId ??
    stringValue(value.id) ??
    'unknown';
  const reasons = stringArray(value.reasons);
  const latestReportAt =
    stringValue(value.latestReportAt) ??
    stringValue(value.latest_report_at) ??
    reports[0]?.createdAt ??
    new Date(0).toISOString();

  return {
    id: stringValue(value.id) ?? `${targetType}-${targetId}`,
    targetType,
    targetId,
    reportCount: numberValue(value.reportCount) ?? numberValue(value.report_count) ?? reports.length,
    latestReportAt,
    reasons: reasons.length > 0
      ? reasons
      : Array.from(new Set(reports.map((report) => report.reason))),
    reports,
    property,
    comment,
  };
}

function reportGroupFromReports(
  reports: AdminReport[],
  fallbackType: AdminReportTargetType,
): AdminReportGroup {
  const first = reports[0];
  const targetType = first?.targetType ?? fallbackType;
  const targetId = first?.targetId ?? 'unknown';

  return {
    id: `${targetType}-${targetId}`,
    targetType,
    targetId,
    reportCount: reports.length,
    latestReportAt: reports[0]?.createdAt ?? new Date(0).toISOString(),
    reasons: Array.from(new Set(reports.map((report) => report.reason))),
    reports,
    property: reports.find((report) => report.property)?.property ?? null,
    comment: reports.find((report) => report.comment)?.comment ?? null,
  };
}

function normalizeReportList(
  payload: unknown,
  fallbackType: AdminReportTargetType,
): AdminReportListResponse {
  const backendData = isRecord(payload) ? extractArray(payload.data, ['data']) : [];
  const rawItems = extractArray(payload, ['items', 'groups', 'reports']);
  const backendReports = backendData.map(normalizeAdminReport);
  const items = backendReports.length > 0
    ? groupReportsByTarget(backendReports, fallbackType)
    : rawItems.map((item) => normalizeReportGroup(item, fallbackType));
  const recentReports = extractArray(payload, ['recentReports', 'recent_reports'])
    .map(normalizeAdminReport);
  const recentModerationActions = extractArray(payload, [
    'recentModerationActions',
    'recentActions',
    'adminLogs',
    'admin_logs',
    'logs',
  ])
    .map(normalizeLog)
    .filter((entry): entry is AdminLogEntry => entry !== null);

  return {
    items,
    recentReports: recentReports.length > 0
      ? recentReports
      : items.flatMap((item) => item.reports).slice(0, 6),
    recentModerationActions,
    pendingCount:
      isRecord(payload) && numberValue(payload.pendingCount) !== undefined
        ? numberValue(payload.pendingCount)!
        : items.reduce((sum, item) => sum + item.reportCount, 0),
  };
}

function normalizeDetail(payload: unknown): AdminReportDetailResponse {
  if (!isRecord(payload)) {
    const report = normalizeAdminReport(payload);
    return {
      report,
      target: report.comment ?? report.property ?? null,
      activeReports: [report],
      recentModerationActions: [],
    };
  }

  const report = normalizeAdminReport(payload.report ?? payload);
  const activeReports = extractArray(payload, ['activeReports', 'reports', 'items'])
    .map(normalizeAdminReport);
  const logs = extractArray(payload, [
    'recentModerationActions',
    'recentActions',
    'adminLogs',
    'admin_logs',
    'logs',
  ])
    .map(normalizeLog)
    .filter((entry): entry is AdminLogEntry => entry !== null);

  return {
    report,
    target:
      normalizeComment(payload.target) ??
      normalizeProperty(payload.target) ??
      report.comment ??
      report.property ??
      null,
    activeReports: activeReports.length > 0 ? activeReports : [report],
    recentModerationActions: logs,
  };
}

async function adminFetch<T>(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401 || response.status === 403) {
    throw new AdminForbiddenError(response.status);
  }

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: `HTTP error! status: ${response.status}` }));
    throw new ApiError(
      response.status,
      stringValue(error.message) ?? `HTTP error! status: ${response.status}`,
      stringValue(error.error),
    );
  }

  return response.json();
}

export async function fetchAdminPropertyReports(
  accessToken: string,
): Promise<AdminReportListResponse> {
  const payload = await adminFetch<unknown>('/admin/reports/properties', accessToken);
  return normalizeReportList(payload, 'property');
}

export async function fetchAdminCommentReports(
  accessToken: string,
): Promise<AdminReportListResponse> {
  const payload = await adminFetch<unknown>('/admin/reports/comments', accessToken);
  return normalizeReportList(payload, 'comment');
}

export async function fetchAdminReportDetail(
  accessToken: string,
  reportId: string,
): Promise<AdminReportDetailResponse> {
  const payload = await adminFetch<unknown>(
    `/admin/reports/${encodeURIComponent(reportId)}`,
    accessToken,
  );
  return normalizeDetail(payload);
}

export async function patchAdminReport(
  accessToken: string,
  reportId: string,
  input: AdminReportPatchInput,
): Promise<AdminReportPatchResponse> {
  return adminFetch<AdminReportPatchResponse>(
    `/admin/reports/${encodeURIComponent(reportId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}
