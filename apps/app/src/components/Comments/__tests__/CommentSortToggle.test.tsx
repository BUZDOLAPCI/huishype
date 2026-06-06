import { fireEvent, render } from '@testing-library/react-native';

import { CommentSortToggle } from '../CommentSortToggle';

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }

  if (style && typeof style === 'object') {
    return style as Record<string, unknown>;
  }

  return {};
}

describe('CommentSortToggle', () => {
  it('uses the compact pill shape with orange selected styling', () => {
    const onChange = jest.fn();
    const screen = render(<CommentSortToggle value="popular" onChange={onChange} />);

    const popularButton = screen.getByTestId('sort-popular');
    const recentButton = screen.getByTestId('sort-recent');

    expect(flattenStyle(screen.getByTestId('comment-sort-toggle').props.style)).toMatchObject({
      backgroundColor: '#FBF4E7',
      borderRadius: 999,
      padding: 3,
      gap: 4,
    });
    expect(flattenStyle(popularButton.props.style)).toMatchObject({
      borderRadius: 999,
      backgroundColor: '#F5A623',
      paddingHorizontal: 12,
      paddingVertical: 7,
    });
    expect(flattenStyle(screen.getByText('Popular').props.style)).toMatchObject({
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
    });
    expect(flattenStyle(recentButton.props.style)).not.toMatchObject({
      backgroundColor: '#F5A623',
    });

    fireEvent.press(recentButton);

    expect(onChange).toHaveBeenCalledWith('recent');
  });
});
