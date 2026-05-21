import { API_URL } from '@/src/utils/api';

export type ReportTargetType = 'property' | 'comment';

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
}

export interface SubmitReportInput {
  target: ReportTarget;
  reason: string;
  details?: string;
  reporterDeviceId?: string;
  accessToken?: string | null;
}

export interface SubmitReportResponse {
  success?: boolean;
  id?: string;
}

function reportEndpoint(target: ReportTarget): string {
  if (target.type === 'property') {
    return `/properties/${target.id}/report`;
  }

  return `/comments/${target.id}/report`;
}

export async function submitReport({
  target,
  reason,
  details,
  reporterDeviceId,
  accessToken,
}: SubmitReportInput): Promise<SubmitReportResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const trimmedDetails = details?.trim();
  const response = await fetch(`${API_URL}${reportEndpoint(target)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      reason,
      ...(trimmedDetails ? { details: trimmedDetails } : {}),
      ...(reporterDeviceId ? { reporterDeviceId } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Failed to submit report' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json().catch(() => ({ success: true }));
}
