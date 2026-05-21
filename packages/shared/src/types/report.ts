/**
 * Shared report and moderation categories.
 *
 * Keep these as the single source consumed by API validation, client code, and
 * mocks so report reasons cannot drift across surfaces.
 */

export const propertyReportCategories = [
  'incorrect_property_data',
  'wrong_location',
  'wrong_listing',
  'privacy_safety',
  'spam_scam',
  'other',
] as const;

export const commentReportCategories = [
  'harassment_hate',
  'spam',
  'privacy_personal_info',
  'misleading',
  'illegal',
  'other',
] as const;

export type PropertyReportCategory = (typeof propertyReportCategories)[number];
export type CommentReportCategory = (typeof commentReportCategories)[number];
export type ReportTargetType = 'property' | 'comment';
export type ContentReportStatus = 'unresolved' | 'resolved';
export type ContentReportReviewAction =
  | 'dismiss_reports'
  | 'mark_property_reviewed'
  | 'hide_comment'
  | 'disable_property_comments'
  | 'enable_property_comments';

export interface CreatePropertyReportRequest {
  reason: PropertyReportCategory;
  details?: string;
  reporterDeviceId?: string;
}

export interface CreateCommentReportRequest {
  reason: CommentReportCategory;
  details?: string;
  reporterDeviceId?: string;
}

export interface ContentReportResponse {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reporterUserId: string | null;
  reporterDeviceId: string | null;
  reason: PropertyReportCategory | CommentReportCategory;
  details: string | null;
  status: ContentReportStatus;
  reviewAction: ContentReportReviewAction | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reporter?: {
    id: string;
    username: string;
    displayName: string | null;
    email?: string | null;
    karma?: number | null;
  } | null;
  property?: {
    id: string;
    address: string;
    street: string;
    city: string;
    postalCode: string | null;
    houseNumber: number;
    houseNumberAddition: string | null;
    countryCode: string;
  } | null;
  comment?: {
    id: string;
    text: string;
    author?: {
      id: string;
      username: string;
      displayName: string | null;
      karma?: number | null;
    } | null;
    property?: {
      id: string;
      address: string;
      street: string;
      city: string;
      postalCode: string | null;
      houseNumber: number;
      houseNumberAddition: string | null;
      countryCode: string;
    } | null;
  } | null;
}

export interface AdminLogResponse {
  id: string;
  createdAt: string;
  action: ContentReportReviewAction;
  targetType: ReportTargetType;
  targetId: string;
  details: Record<string, unknown>;
  admin?: {
    id: string;
    username: string;
    displayName: string | null;
    email?: string | null;
  } | null;
}

export interface CreateContentReportResponse {
  report: ContentReportResponse;
}

export interface AdminReportListResponse {
  data: ContentReportResponse[];
  meta: {
    limit: number;
    offset: number;
    total: number;
  };
  recentModerationActions?: AdminLogResponse[];
}

export interface AdminReportDetailResponse {
  report: ContentReportResponse;
  target: ContentReportResponse['property'] | ContentReportResponse['comment'] | null;
  activeReports: ContentReportResponse[];
  recentModerationActions: AdminLogResponse[];
}

export interface AdminPatchReportRequest {
  action: ContentReportReviewAction;
  moderationReason?: string;
}

export interface AdminPatchReportResponse {
  report: ContentReportResponse;
  resolvedCount: number;
  hiddenCommentId?: string;
}
