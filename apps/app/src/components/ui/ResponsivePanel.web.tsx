/**
 * ResponsivePanel (web) — Responsive layout wrapper for route pages.
 *
 * Landscape (desktop/wide): 420px right-anchored side panel with backdrop,
 * close button, and slide-in transition — same visual language as
 * PropertyBottomSheet.web.tsx.
 *
 * Portrait (mobile/narrow): Full-screen passthrough — children render
 * without any panel chrome since the route already handles safe areas.
 */
import { useCallback, useEffect, type ReactNode } from 'react';

import { useIsLandscape } from '../../hooks/useIsLandscape';
import { Icon } from './Icon';

export interface ResponsivePanelProps {
  children: ReactNode;
  /** Title shown in the panel header (landscape mode). */
  title?: string;
  /** Called when the panel is dismissed. Defaults to a no-op. */
  onClose?: () => void;
}

// Inject CSS for the responsive panel — same injection pattern as PropertyBottomSheet.web.tsx
const RESPONSIVE_PANEL_CSS_ID = 'responsive-panel-css';
if (typeof document !== 'undefined') {
  let style = document.getElementById(RESPONSIVE_PANEL_CSS_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = RESPONSIVE_PANEL_CSS_ID;
    document.head.appendChild(style);
  }
  // Always update content — handles HMR where element exists but CSS is stale
  style.textContent = `
    .responsive-panel-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.15);
      z-index: 2000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .responsive-panel-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .responsive-panel--landscape {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 420px;
      max-width: 100vw;
      background: #FFFBF5;
      z-index: 2001;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
    }
    .responsive-panel--landscape.open {
      transform: translateX(0);
    }
    @media (max-width: 640px) {
      .responsive-panel--landscape {
        width: 100vw;
      }
    }

    .responsive-panel-header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #F5F0E8;
      flex-shrink: 0;
    }
    .responsive-panel-close {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #FFF8F0;
      border: none;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .responsive-panel-close:hover {
      background: #F5F0E8;
    }
    .responsive-panel-title {
      font-size: 16px;
      font-weight: 600;
      color: #2D2926;
    }
    .responsive-panel-content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
  `;
}

export function ResponsivePanel({ children, title, onClose }: ResponsivePanelProps) {
  const isLandscape = useIsLandscape();

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // Dismiss on Escape key (landscape panel only)
  useEffect(() => {
    if (!isLandscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isLandscape, handleClose]);

  // Portrait: full-screen passthrough — no panel chrome needed
  if (!isLandscape) {
    return <>{children}</>;
  }

  // Landscape: side panel with backdrop
  return (
    <>
      <div
        className="responsive-panel-backdrop open"
        onClick={handleClose}
        data-testid="responsive-panel-backdrop"
      />
      <div
        className="responsive-panel--landscape open"
        data-testid="responsive-panel"
      >
        {/* Header */}
        <div className="responsive-panel-header">
          <span className="responsive-panel-title">{title ?? ''}</span>
          <button
            className="responsive-panel-close"
            onClick={handleClose}
            data-testid="responsive-panel-close"
            aria-label="Close panel"
          >
            <Icon name="X" size="md" color="#9C958A" />
          </button>
        </div>

        {/* Content */}
        <div className="responsive-panel-content">{children}</div>
      </div>
    </>
  );
}
