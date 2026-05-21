import {
  AdminForbiddenError,
  disableAdminPropertyComments,
  enableAdminPropertyComments,
  fetchAdminDisabledProperties,
  fetchAdminPropertyReports,
  patchAdminReport,
} from '@/src/services/admin-moderation';

const fetchMock = jest.fn();

describe('admin moderation service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('fetches and normalizes grouped property reports', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'r1',
            targetType: 'property',
            targetId: 'p1',
            reason: 'wrong_listing',
            createdAt: '2026-05-20T10:00:00.000Z',
          },
          {
            id: 'r2',
            targetType: 'property',
            targetId: 'p1',
            reason: 'privacy_safety',
            createdAt: '2026-05-20T09:00:00.000Z',
          },
        ],
        meta: { limit: 50, offset: 0, total: 2 },
      }),
    });

    const result = await fetchAdminPropertyReports('token-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/reports/properties'),
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(result.pendingCount).toBe(2);
    expect(result.items[0]).toMatchObject({
      id: 'property-p1',
      targetId: 'p1',
      reportCount: 2,
      reasons: ['wrong_listing', 'privacy_safety'],
    });
  });

  it('surfaces forbidden admin responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: jest.fn(),
    });

    await expect(fetchAdminPropertyReports('token-1')).rejects.toBeInstanceOf(
      AdminForbiddenError,
    );
  });

  it('patches report actions with the expected endpoint and body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ success: true }),
    });

    await patchAdminReport('token-1', 'report-1', {
      action: 'dismiss_reports',
      status: 'dismissed',
      targetId: 'property-1',
      targetType: 'property',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/reports/report-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          action: 'dismiss_reports',
          status: 'dismissed',
          targetId: 'property-1',
          targetType: 'property',
        }),
      }),
    );
  });

  it('lists disabled properties', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'p1',
            address: 'Beeldbuisring 41',
            city: 'Eindhoven',
            postalCode: '5651 HA',
            commentsDisabled: true,
            commentsDisabledAt: '2026-05-20T10:00:00.000Z',
          },
        ],
      }),
    });

    const result = await fetchAdminDisabledProperties('token-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/properties/comments-disabled'),
      expect.any(Object),
    );
    expect(result[0]).toMatchObject({
      id: 'p1',
      commentsDisabled: true,
      commentsDisabledAt: '2026-05-20T10:00:00.000Z',
    });
  });

  it('disables and enables property comments with optional reasons', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          property: {
            id: 'p1',
            address: 'Beeldbuisring 41',
            city: 'Eindhoven',
            commentsDisabled: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          property: {
            id: 'p1',
            address: 'Beeldbuisring 41',
            city: 'Eindhoven',
            commentsDisabled: false,
          },
        }),
      });

    await disableAdminPropertyComments('token-1', 'p1', 'Privacy');
    await enableAdminPropertyComments('token-1', 'p1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/admin/properties/p1/comments/disable'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Privacy' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/admin/properties/p1/comments/enable'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
  });
});
