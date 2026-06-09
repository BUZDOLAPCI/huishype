/**
 * ResponsivePanel (native) — Full-screen passthrough.
 *
 * On native (phone form-factor), the layout is always portrait.
 * This component simply renders children as-is — the route page
 * handles its own safe areas and layout.
 */
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';

export interface ResponsivePanelProps {
  children: ReactNode;
  /** Title (unused on native — exists for API parity with web). */
  title?: string;
  /** Close callback (unused on native — navigation is handled by the stack). */
  onClose?: () => void;
  /** Web-only chrome state callback for map-sheet choreography. */
  onOpenChange?: (isOpen: boolean) => void;
  /** Web-only presentation hint; native remains route-style passthrough. */
  presentation?: 'route' | 'map-sheet';
  /** Web-only right offset for map sheet choreography. */
  landscapeRightOffset?: number;
}

export interface ResponsivePanelRef {
  close: () => void;
}

export const ResponsivePanel = forwardRef<ResponsivePanelRef, ResponsivePanelProps>(
  function ResponsivePanel({ children, onClose }, ref) {
    useImperativeHandle(
      ref,
      () => ({
        close: () => {
          onClose?.();
        },
      }),
      [onClose]
    );

    return <>{children}</>;
  }
);
