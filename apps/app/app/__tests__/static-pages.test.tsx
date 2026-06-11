import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import GlossaryScreen from '../settings/glossary/index';
import GlossaryTermScreen from '../settings/glossary/[slug]';
import HelpArticleScreen from '../settings/help/article/[slug]';
import HelpCategoryScreen from '../settings/help/category/[slug]';
import HelpScreen from '../settings/help/index';

const mockUseLocalSearchParams = jest.fn(() => ({}));
const mockUseLanguage = jest.fn(() => ({
  language: 'en',
  setLanguage: jest.fn(),
  t: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    push: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/src/i18n', () => ({
  useLanguage: () => mockUseLanguage(),
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
const getRouterBack = () =>
  (jest.requireMock('expo-router') as { router: { back: jest.Mock } }).router.back;
const getRouterCanGoBack = () =>
  (jest.requireMock('expo-router') as { router: { canGoBack: jest.Mock } }).router.canGoBack;

describe('static help and glossary pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLanguage.mockReturnValue({
      language: 'en',
      setLanguage: jest.fn(),
      t: jest.fn(),
    });
    mockUseLocalSearchParams.mockReturnValue({});
  });

  it('renders the help hub and navigates to category, article, and glossary pages', () => {
    const { getByTestId, getByText } = render(<HelpScreen />);

    expect(getByTestId('help-screen')).toBeTruthy();
    expect(getByText('Help Center')).toBeTruthy();
    expect(getByText(/Find help for browsing homes/i)).toBeTruthy();

    fireEvent.press(getByTestId('help-category-basics'));
    expect(getRouterPush()).toHaveBeenCalledWith('/settings/help/category/basics');

    fireEvent.press(getByTestId('help-article-price-guesses'));
    expect(getRouterPush()).toHaveBeenCalledWith('/settings/help/article/price-guesses');

    fireEvent.press(getByTestId('help-glossary-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/settings/glossary');
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
    expect(getRouterPush()).toHaveBeenCalledWith('/settings/glossary/asking-price');

    mockUseLocalSearchParams.mockReturnValue({ slug: 'woz-value' });

    const term = render(<GlossaryTermScreen />);

    expect(term.getByTestId('glossary-term-screen')).toBeTruthy();
    expect(term.getByText('WOZ value')).toBeTruthy();
    expect(
      term.getAllByText(/Dutch official property value used for taxes/i).length
    ).toBeGreaterThan(0);
  });

  it('renders Dutch help, category, article, and glossary content', () => {
    mockUseLanguage.mockReturnValue({
      language: 'nl',
      setLanguage: jest.fn(),
      t: jest.fn(),
    });

    const help = render(<HelpScreen />);

    expect(help.getByText('Helpcentrum')).toBeTruthy();
    expect(help.getByText(/Vind hulp bij woningen bekijken/i)).toBeTruthy();
    expect(help.getByText('HuisHype gebruiken')).toBeTruthy();

    mockUseLocalSearchParams.mockReturnValue({ slug: 'prices-and-valuations' });

    const category = render(<HelpCategoryScreen />);

    expect(category.getByText('Prijzen en taxaties')).toBeTruthy();

    mockUseLocalSearchParams.mockReturnValue({ slug: 'price-guesses' });

    const article = render(<HelpArticleScreen />);

    expect(article.getByText('Hoe werken prijsschattingen?')).toBeTruthy();

    const glossary = render(<GlossaryScreen />);

    expect(glossary.getAllByText('Begrippenlijst').length).toBeGreaterThan(0);

    mockUseLocalSearchParams.mockReturnValue({ slug: 'woz-value' });

    const term = render(<GlossaryTermScreen />);

    expect(term.getByText('WOZ-waarde')).toBeTruthy();
  });

  it('returns from static pages through normal back navigation', () => {
    const { getByTestId } = render(<HelpScreen />);

    fireEvent.press(getByTestId('static-page-back'));

    expect(getRouterBack()).toHaveBeenCalledTimes(1);
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings');
  });

  it('returns from nested help and glossary pages to their parent settings routes', () => {
    mockUseLocalSearchParams.mockReturnValue({ slug: 'prices-and-valuations' });

    const category = render(<HelpCategoryScreen />);

    fireEvent.press(category.getByTestId('static-page-back'));
    expect(getRouterBack()).toHaveBeenCalledTimes(1);
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings/help');

    mockUseLocalSearchParams.mockReturnValue({ slug: 'price-guesses' });

    const article = render(<HelpArticleScreen />);

    fireEvent.press(article.getByTestId('static-page-back'));
    expect(getRouterBack()).toHaveBeenCalledTimes(2);
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings/help');

    const glossary = render(<GlossaryScreen />);

    fireEvent.press(glossary.getByTestId('static-page-back'));
    expect(getRouterBack()).toHaveBeenCalledTimes(3);
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings/help');

    mockUseLocalSearchParams.mockReturnValue({ slug: 'woz-value' });

    const term = render(<GlossaryTermScreen />);

    fireEvent.press(term.getByTestId('static-page-back'));
    expect(getRouterBack()).toHaveBeenCalledTimes(4);
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings/glossary');
  });

  it('uses parent route fallback for direct nested support page entry', () => {
    getRouterCanGoBack().mockReturnValueOnce(false);
    mockUseLocalSearchParams.mockReturnValue({ slug: 'woz-value' });

    const term = render(<GlossaryTermScreen />);

    fireEvent.press(term.getByTestId('static-page-back'));

    expect(getRouterReplace()).toHaveBeenCalledWith('/settings/glossary');
    expect(getRouterBack()).not.toHaveBeenCalled();
  });
});
