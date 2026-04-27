import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWelcomeModal } from '../useWelcomeModal';
import {
  getWelcomeModalDismissed,
  markWelcomeModalDismissed,
} from '../../lib/welcomeModalStorage';

jest.mock('../../lib/welcomeModalStorage', () => ({
  getWelcomeModalDismissed: jest.fn(),
  markWelcomeModalDismissed: jest.fn(),
}));

const mockGetWelcomeModalDismissed = getWelcomeModalDismissed as jest.MockedFunction<typeof getWelcomeModalDismissed>;
const mockMarkWelcomeModalDismissed = markWelcomeModalDismissed as jest.MockedFunction<typeof markWelcomeModalDismissed>;

describe('useWelcomeModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkWelcomeModalDismissed.mockResolvedValue(undefined);
  });

  it('shows the welcome modal when it has not been dismissed', async () => {
    mockGetWelcomeModalDismissed.mockResolvedValue(false);

    const { result } = renderHook(() => useWelcomeModal());

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.visible).toBe(true);
  });

  it('keeps the welcome modal hidden when it was already dismissed', async () => {
    mockGetWelcomeModalDismissed.mockResolvedValue(true);

    const { result } = renderHook(() => useWelcomeModal());

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.visible).toBe(false);
  });

  it('persists dismissal when closed and can be reopened manually', async () => {
    mockGetWelcomeModalDismissed.mockResolvedValue(false);

    const { result } = renderHook(() => useWelcomeModal());
    await waitFor(() => expect(result.current.visible).toBe(true));

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.visible).toBe(false);
    expect(mockMarkWelcomeModalDismissed).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.open();
    });

    expect(result.current.visible).toBe(true);
  });
});

