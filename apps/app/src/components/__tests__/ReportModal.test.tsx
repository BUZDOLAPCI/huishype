import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ReportModal } from '../ReportModal';

const mockMutation = {
  isPending: false,
  error: null as Error | null,
  mutate: jest.fn(),
  reset: jest.fn(),
};

jest.mock('@/src/hooks/useReport', () => ({
  useSubmitReport: () => mockMutation,
}));

describe('ReportModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockMutation.isPending = false;
    mockMutation.error = null;
    mockMutation.mutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps submit disabled until a category is selected', () => {
    render(
      <ReportModal
        visible
        target={{ type: 'property', id: 'property-1' }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('report-submit-button')).toBeDisabled();

    fireEvent.press(screen.getByTestId('report-category-incorrect_property_data'));

    expect(screen.getByTestId('report-submit-button')).not.toBeDisabled();
  });

  it('limits optional details to 140 characters and submits the selected reason', () => {
    render(
      <ReportModal
        visible
        target={{ type: 'comment', id: 'comment-1' }}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('report-category-harassment_hate'));
    fireEvent.changeText(screen.getByTestId('report-details-input'), 'x'.repeat(160));
    fireEvent.press(screen.getByTestId('report-submit-button'));

    expect(mockMutation.mutate).toHaveBeenCalledWith(
      {
        target: { type: 'comment', id: 'comment-1' },
          reason: 'harassment_hate',
        details: 'x'.repeat(140),
      },
      expect.any(Object),
    );
  });

  it('shows inline errors from the report mutation', () => {
    mockMutation.error = new Error('Report endpoint failed');

    render(
      <ReportModal
        visible
        target={{ type: 'property', id: 'property-1' }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('report-error')).toHaveTextContent('Report endpoint failed');
  });

  it('shows success and auto-closes after the success delay', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();

    render(
      <ReportModal
        visible
        target={{ type: 'property', id: 'property-1' }}
        onClose={onClose}
      />,
    );

    fireEvent.press(screen.getByTestId('report-category-spam_scam'));
    fireEvent.press(screen.getByTestId('report-submit-button'));

    expect(screen.getByTestId('report-success')).toHaveTextContent(
      'Thanks. We will review this report.',
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockMutation.reset).toHaveBeenCalled();
  });

  it('closes from the backdrop and cancel button', () => {
    const onClose = jest.fn();

    render(
      <ReportModal
        visible
        target={{ type: 'property', id: 'property-1' }}
        onClose={onClose}
      />,
    );

    fireEvent.press(screen.getByTestId('report-modal-backdrop'));
    fireEvent.press(screen.getByTestId('report-cancel-button'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
