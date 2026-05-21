import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  fetchAdminCommentReports,
  fetchAdminPropertyReports,
  fetchAdminReportDetail,
  patchAdminReport,
  type AdminLogEntry,
  type AdminReportPatchInput,
  type AdminReportTargetType,
} from '@/src/services/admin-moderation';

export const adminModerationKeys = {
  all: ['admin-moderation'] as const,
  dashboard: (viewerKey: string) =>
    [...adminModerationKeys.all, 'dashboard', viewerKey] as const,
  reports: (viewerKey: string, targetType: AdminReportTargetType) =>
    [...adminModerationKeys.all, 'reports', viewerKey, targetType] as const,
  detail: (viewerKey: string, reportId: string) =>
    [...adminModerationKeys.all, 'detail', viewerKey, reportId] as const,
  logs: (viewerKey: string) =>
    [...adminModerationKeys.all, 'logs', viewerKey] as const,
};

export function useAdminPropertyReports(enabled: boolean) {
  const { getAccessToken, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: adminModerationKeys.reports(viewerKey, 'property'),
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchAdminPropertyReports(accessToken);
    },
    enabled,
    staleTime: 20 * 1000,
  });
}

export function useAdminCommentReports(enabled: boolean) {
  const { getAccessToken, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: adminModerationKeys.reports(viewerKey, 'comment'),
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchAdminCommentReports(accessToken);
    },
    enabled,
    staleTime: 20 * 1000,
  });
}

export function useAdminDashboard(enabled: boolean) {
  const propertyReports = useAdminPropertyReports(enabled);
  const commentReports = useAdminCommentReports(enabled);

  return {
    propertyReports,
    commentReports,
    isLoading: propertyReports.isLoading || commentReports.isLoading,
    isError: propertyReports.isError || commentReports.isError,
    error: propertyReports.error ?? commentReports.error,
  };
}

export function useAdminReportDetail(reportId: string, enabled: boolean) {
  const { getAccessToken, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: adminModerationKeys.detail(viewerKey, reportId),
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchAdminReportDetail(accessToken, reportId);
    },
    enabled: enabled && !!reportId,
    staleTime: 15 * 1000,
  });
}

export function useAdminActivityLogs(enabled: boolean) {
  const { propertyReports, commentReports, isLoading, isError, error } =
    useAdminDashboard(enabled);

  const logs = [
    ...(propertyReports.data?.recentModerationActions ?? []),
    ...(commentReports.data?.recentModerationActions ?? []),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const uniqueLogs = logs.filter((entry, index, list) => {
    return list.findIndex((candidate) => candidate.id === entry.id) === index;
  });

  return {
    data: uniqueLogs as AdminLogEntry[],
    isLoading,
    isError,
    error,
    refetch: async () => {
      await Promise.all([
        propertyReports.refetch(),
        commentReports.refetch(),
      ]);
    },
  };
}

export function useAdminReportAction() {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuthContext();

  return useMutation({
    mutationFn: async ({
      reportId,
      input,
    }: {
      reportId: string;
      input: AdminReportPatchInput;
    }) => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return patchAdminReport(accessToken, reportId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminModerationKeys.all });
    },
  });
}
