import React from 'react';
import { render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

import { ScreenBackground } from '../ScreenBackground';

describe('ScreenBackground', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the portrait background without stretching the image', () => {
    jest.spyOn(ReactNative.Dimensions, 'get').mockReturnValue({
      width: 390,
      height: 844,
      scale: 1,
      fontScale: 1,
    });

    render(<ScreenBackground><ReactNative.Text>Content</ReactNative.Text></ScreenBackground>);

    const image = screen.getByTestId('screen-background-portrait', {
      includeHiddenElements: true,
    });
    expect(image.props.resizeMode).toBe('cover');
    expect(image.props.style).toEqual(expect.objectContaining({
      width: '100%',
      height: '100%',
    }));
    expect(image.props.style).not.toEqual(expect.objectContaining({
      opacity: expect.any(Number),
    }));
  });

  it('uses the landscape background in wide layouts', () => {
    jest.spyOn(ReactNative.Dimensions, 'get').mockReturnValue({
      width: 1024,
      height: 768,
      scale: 1,
      fontScale: 1,
    });

    render(<ScreenBackground><ReactNative.Text>Content</ReactNative.Text></ScreenBackground>);

    expect(screen.getByTestId('screen-background-landscape', {
      includeHiddenElements: true,
    })).toBeTruthy();
  });
});
