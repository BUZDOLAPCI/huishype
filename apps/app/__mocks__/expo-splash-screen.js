// Mock for expo-splash-screen
module.exports = {
  hideAsync: jest.fn().mockResolvedValue(undefined),
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
};
