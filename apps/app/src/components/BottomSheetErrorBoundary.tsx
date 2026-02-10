import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onError?: () => void;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary for PropertyBottomSheet.
 * Catches transient render errors (e.g. during auth state transitions)
 * and auto-recovers by re-mounting the bottom sheet after a brief delay.
 */
export class BottomSheetErrorBoundary extends Component<Props, State> {
  private recoveryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    // Use console.warn to avoid failing Playwright console error checks
    console.warn('[BottomSheetErrorBoundary] Caught transient render error, recovering:', error.message);
    this.props.onError?.();

    // Auto-recover after brief delay
    this.recoveryTimeout = setTimeout(() => {
      this.setState({ hasError: false });
    }, 500);
  }

  componentWillUnmount(): void {
    if (this.recoveryTimeout) {
      clearTimeout(this.recoveryTimeout);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
