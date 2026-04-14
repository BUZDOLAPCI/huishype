import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import CameraRouteScreen from '../@[camera]';

const mockCanonicalAddressRoute = jest.fn(() => {
  const { Text } = require('react-native');
  return <Text>canonical-route</Text>;
});

jest.mock('../[...address]', () => ({
  __esModule: true,
  default: () => mockCanonicalAddressRoute(),
}));

describe('CameraRouteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts the persistent web map surface for camera routes on web', () => {
    Platform.OS = 'web';

    render(<CameraRouteScreen />);

    expect(screen.getByText('canonical-route')).toBeTruthy();
    expect(mockCanonicalAddressRoute).toHaveBeenCalled();
  });

  it('keeps the native branch on the regular map screen', () => {
    Platform.OS = 'android';

    render(<CameraRouteScreen />);

    expect(screen.getByText('canonical-route')).toBeTruthy();
    expect(mockCanonicalAddressRoute).toHaveBeenCalled();
  });
});
