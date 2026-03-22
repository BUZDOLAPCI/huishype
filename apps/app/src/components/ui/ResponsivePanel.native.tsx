/**
 * ResponsivePanel (native) — Full-screen passthrough.
 *
 * On native (phone form-factor), the layout is always portrait.
 * This component simply renders children as-is — the route page
 * handles its own safe areas and layout.
 */
import type { ReactNode } from 'react';

export interface ResponsivePanelProps {
  children: ReactNode;
  /** Title (unused on native — exists for API parity with web). */
  title?: string;
  /** Close callback (unused on native — navigation is handled by the stack). */
  onClose?: () => void;
}

export function ResponsivePanel({ children }: ResponsivePanelProps) {
  return <>{children}</>;
}
