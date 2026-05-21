import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import GlossaryScreen from '../(tabs)/glossary/index';
import GlossaryTermScreen from '../(tabs)/glossary/[slug]';
import HelpArticleScreen from '../(tabs)/help/article/[slug]';
import HelpCategoryScreen from '../(tabs)/help/category/[slug]';
import HelpScreen from '../(tabs)/help/index';

const mockUseLocalSearchParams = jest.fn(() => ({}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

const getRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;
const getRouterReplace = () =>
  (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router.replace;

describe('static help and glossary pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
  });

  it('renders the help hub and navigates to category, article, and glossary pages', () => {
    const { getByTestId, getByText } = render(<HelpScreen />);

    expect(getByTestId('help-screen')).toBeTruthy();
    expect(getByText('Help Center')).toBeTruthy();
    expect(getByText(/Find help for browsing homes/i)).toBeTruthy();

    fireEvent.press(getByTestId('help-category-basics'));
    expect(getRouterPush()).toHaveBeenCalledWith('/help/category/basics');

    fireEvent.press(getByTestId('help-article-price-guesses'));
    expect(getRouterPush()).toHaveBeenCalledWith('/help/article/price-guesses');

    fireEvent.press(getByTestId('help-glossary-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/glossary');
  });

  it('renders a help category and article from dynamic slugs', () => {
    mockUseLocalSearchParams.mockReturnValue({ slug: 'prices-and-valuations' });

    const category = render(<HelpCategoryScreen />);

    expect(category.getByTestId('help-category-screen')).toBeTruthy();
    expect(category.getByText('Prices and valuations')).toBeTruthy();
    expect(category.getByText(/Price guesses, asking prices/i)).toBeTruthy();

    mockUseLocalSearchParams.mockReturnValue({ slug: 'price-guesses' });

    const article = render(<HelpArticleScreen />);

    expect(article.getByTestId('help-article-screen')).toBeTruthy();
    expect(article.getByText('How do price guesses work?')).toBeTruthy();
    expect(article.getByText(/your opinion about what a property may be worth/i)).toBeTruthy();
  });

  it('renders glossary index and glossary term pages', () => {
    const glossary = render(<GlossaryScreen />);

    expect(glossary.getByTestId('glossary-screen')).toBeTruthy();
    expect(glossary.getAllByText('Glossary').length).toBeGreaterThan(0);

    fireEvent.press(glossary.getByTestId('glossary-term-asking-price'));
    expect(getRouterPush()).toHaveBeenCalledWith('/glossary/asking-price');

    mockUseLocalSearchParams.mockReturnValue({ slug: 'woz-value' });

    const term = render(<GlossaryTermScreen />);

    expect(term.getByTestId('glossary-term-screen')).toBeTruthy();
    expect(term.getByText('WOZ value')).toBeTruthy();
    expect(
      term.getAllByText(/Dutch official property value used for taxes/i).length
    ).toBeGreaterThan(0);
  });

  it('returns from static pages through replace navigation', () => {
    const { getByTestId } = render(<HelpScreen />);

    fireEvent.press(getByTestId('static-page-back'));

    expect(getRouterReplace()).toHaveBeenCalledWith('/profile-settings');
  });
});
