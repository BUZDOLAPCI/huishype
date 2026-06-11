import { router } from 'expo-router';

import { goBackOrReplace } from '../goBackOrReplace';

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(),
    replace: jest.fn(),
  },
}));

const mockRouter = router as jest.Mocked<typeof router>;

describe('goBackOrReplace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses router back when the navigation stack can go back', () => {
    mockRouter.canGoBack.mockReturnValue(true);

    goBackOrReplace('/profile');

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('uses the fallback route when navigation cannot go back', () => {
    mockRouter.canGoBack.mockReturnValue(false);

    goBackOrReplace('/profile');

    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/profile');
  });
});
