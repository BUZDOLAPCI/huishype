import { useMutation } from '@tanstack/react-query';

import { getReportDeviceId } from '@/src/lib/reportDeviceId';
import {
  submitReport,
  type ReportTarget,
  type SubmitReportResponse,
} from '@/src/services/reports';
import { useAuthContext } from '@/src/providers/AuthProvider';

export interface ReportMutationInput {
  target: ReportTarget;
  reason: string;
  details?: string;
}

export function useSubmitReport() {
  const { getAccessToken } = useAuthContext();

  return useMutation<SubmitReportResponse, Error, ReportMutationInput>({
    mutationFn: async ({ target, reason, details }) => {
      const [reporterDeviceId, accessToken] = await Promise.all([
        getReportDeviceId(),
        getAccessToken(),
      ]);

      return submitReport({
        target,
        reason,
        details,
        reporterDeviceId,
        accessToken,
      });
    },
  });
}
