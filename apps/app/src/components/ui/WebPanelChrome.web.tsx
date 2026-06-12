import {
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { TAB_BAR_DOCK_HEIGHT } from '../navigation/tabBarMetrics';
import { useIsLandscape } from '../../hooks/useIsLandscape';
import { Icon } from './Icon';
import { useT } from '@/src/i18n';

export type WebPanelState = 'closed' | 'peek' | 'partial' | 'full';
export const WEB_PANEL_TRANSITION_MS = 300;

/** Portrait snap points as translateY percentages. */
export const WEB_PANEL_SNAP_POINTS: Record<Exclude<WebPanelState, 'closed'>, number> = {
  peek: 97,
  partial: 51.5,
  full: 0,
};

export function webPanelStateToIndex(state: WebPanelState): number {
  switch (state) {
    case 'closed':
      return -1;
    case 'peek':
      return 0;
    case 'partial':
      return 1;
    case 'full':
      return 2;
  }
}

const PANEL_CSS_ID = 'web-panel-chrome-css';
if (typeof document !== 'undefined') {
  let style = document.getElementById(PANEL_CSS_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = PANEL_CSS_ID;
    document.head.appendChild(style);
  }

  style.textContent = `
    .web-property-panel-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.15);
      z-index: var(--web-panel-backdrop-z-index, 2000);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .web-property-panel-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .web-property-panel--landscape {
      position: fixed;
      top: 0;
      right: var(--web-panel-landscape-right-offset, 0px);
      bottom: 0;
      width: 420px;
      max-width: 100vw;
      background: var(--web-panel-surface, white);
      z-index: var(--web-panel-z-index, 2001);
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
      transform: translateX(100%);
      transition:
        right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
    }
    .web-property-panel--landscape.open {
      transform: translateX(0);
    }
    @media (max-width: 640px) {
      .web-property-panel--landscape {
        width: 100vw;
      }
    }

    .web-property-panel--portrait {
      position: fixed;
      left: 0;
      right: 0;
      bottom: var(--web-panel-portrait-bottom-offset, ${TAB_BAR_DOCK_HEIGHT}px);
      height: calc(92vh - var(--web-panel-portrait-bottom-offset, ${TAB_BAR_DOCK_HEIGHT}px));
      background: var(--web-panel-surface, white);
      z-index: var(--web-panel-z-index, 2001);
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
    }
    .web-property-panel--portrait.peek {
      transform: translateY(97%);
    }
    .web-property-panel--portrait.partial {
      transform: translateY(51.5%);
    }
    .web-property-panel--portrait.full {
      transform: translateY(0);
    }

    .web-property-panel-header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #F5F0E8;
      flex-shrink: 0;
    }
    .web-property-panel-header.overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 3;
      background: var(--web-panel-surface, white);
    }
    .web-property-panel-title {
      font-size: 16px;
      font-weight: 600;
      color: #2D2926;
    }
    .web-property-panel-title-node {
      min-width: 0;
      flex: 1;
    }
    .web-property-panel-close {
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
    .web-property-panel-close:hover {
      background: #F5F0E8;
    }

    .web-property-panel-handle {
      display: flex;
      justify-content: center;
      padding: 10px 0 2px;
      cursor: grab;
      flex-shrink: 0;
      touch-action: none;
    }
    .web-property-panel-handle:active {
      cursor: grabbing;
    }
    .web-property-panel-handle-bar {
      width: 40px;
      height: 4px;
      border-radius: 2px;
      background: #E8E0D4;
    }
  `;
}

const FLICK_VELOCITY = 0.3;
const TAP_THRESHOLD = 10;

export const DEFAULT_WEB_PANEL_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[data-testid^="quick-action-"]',
  '[data-testid^="price-guess-slider"]',
  '[data-testid^="share-property-"]',
  '[data-testid="web-panel-close"]',
  '[data-testid="web-panel-handle"]',
].join(',');

export interface WebPanelRenderArgs {
  contentWidth?: number;
  isLandscape: boolean;
  isOpen: boolean;
  scrollTopRef: MutableRefObject<number>;
  state: WebPanelState;
}

interface WebPanelChromeProps {
  children: ReactNode | ((args: WebPanelRenderArgs) => ReactNode);
  state: WebPanelState;
  title?: ReactNode;
  titleNode?: ReactNode;
  showHeader?: boolean;
  headerOverlay?: boolean;
  onStateChange: (state: WebPanelState) => void;
  onClose: () => void;
  showBackdrop?: boolean;
  surfaceColor?: string;
  panelZIndex?: number;
  backdropZIndex?: number;
  landscapeRightOffset?: number;
  portraitBottomOffset?: number;
  portalToBody?: boolean;
  enableContentDrag?: boolean;
  enableBodyPressExpand?: boolean;
  interactiveBodyPressSelector?: string;
  panelTestID?: string;
}

export function WebPanelChrome({
  children,
  state,
  title,
  titleNode,
  showHeader = true,
  headerOverlay = false,
  onStateChange,
  onClose,
  showBackdrop,
  surfaceColor,
  panelZIndex,
  backdropZIndex,
  landscapeRightOffset,
  portraitBottomOffset,
  portalToBody = false,
  enableContentDrag = false,
  enableBodyPressExpand = false,
  interactiveBodyPressSelector = DEFAULT_WEB_PANEL_INTERACTIVE_SELECTOR,
  panelTestID = 'web-property-panel',
}: WebPanelChromeProps) {
  const t = useT();
  const isLandscape = useIsLandscape();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const isOpen = state !== 'closed';
  const shouldShowBackdrop =
    showBackdrop ?? (isLandscape ? isOpen : state === 'partial' || state === 'full');

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const updatePanelWidth = () => {
      const nextWidth = panel.getBoundingClientRect().width;
      setPanelWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };

    updatePanelWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updatePanelWidth);
      return () => window.removeEventListener('resize', updatePanelWidth);
    }

    const observer = new ResizeObserver(updatePanelWidth);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isLandscape, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const dragStartY = useRef<number | null>(null);
  const dragStartTime = useRef(0);
  const dragStartState = useRef<WebPanelState>('closed');
  const contentDragActive = useRef(false);

  const onHandlePointerDown = useCallback((event: React.PointerEvent) => {
    dragStartY.current = event.clientY;
    dragStartTime.current = Date.now();
    dragStartState.current = stateRef.current;
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const panel = panelRef.current;
    if (panel) panel.style.transition = 'none';
  }, []);

  const onHandlePointerMove = useCallback((event: React.PointerEvent) => {
    if (dragStartY.current === null) return;

    const panel = panelRef.current;
    if (!panel) return;

    const deltaY = event.clientY - dragStartY.current;
    const panelHeight = panel.offsetHeight;
    if (panelHeight === 0) return;

    const startPercent =
      dragStartState.current === 'closed'
        ? 100
        : WEB_PANEL_SNAP_POINTS[dragStartState.current as Exclude<WebPanelState, 'closed'>];
    const deltaPercent = (deltaY / panelHeight) * 100;
    const nextPercent = Math.max(
      WEB_PANEL_SNAP_POINTS.full,
      Math.min(WEB_PANEL_SNAP_POINTS.peek, startPercent + deltaPercent)
    );

    panel.style.transform = `translateY(${nextPercent}%)`;
  }, []);

  const snapFromDrag = useCallback(
    (deltaY: number, elapsed: number, fromState: WebPanelState, isTap: boolean) => {
      const panel = panelRef.current;
      if (panel) {
        panel.style.transition = '';
        panel.style.transform = '';
      }

      if (isTap) {
        if (fromState === 'peek') onStateChange('partial');
        else if (fromState === 'partial') onStateChange('full');
        else if (fromState === 'full') onStateChange('partial');
        return;
      }

      const velocity = elapsed > 0 ? deltaY / elapsed : 0;
      const isDraggingDown = deltaY > 0;
      const isFlick = Math.abs(velocity) > FLICK_VELOCITY;
      const significantDrag = Math.abs(deltaY) > 50;

      if (isDraggingDown && (isFlick || significantDrag)) {
        if (fromState === 'full') onStateChange('partial');
        else if (fromState === 'partial') onStateChange('peek');
      } else if (!isDraggingDown && (isFlick || significantDrag)) {
        if (fromState === 'peek') onStateChange('partial');
        else if (fromState === 'partial') onStateChange('full');
      }
    },
    [onStateChange]
  );

  const onHandlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (dragStartY.current === null) return;
      const deltaY = event.clientY - dragStartY.current;
      const elapsed = Date.now() - dragStartTime.current;
      const fromState = dragStartState.current;
      dragStartY.current = null;
      snapFromDrag(deltaY, elapsed, fromState, Math.abs(deltaY) < TAP_THRESHOLD);
    },
    [snapFromDrag]
  );

  useEffect(() => {
    if (isLandscape || !enableContentDrag) return;
    const panel = panelRef.current;
    if (!panel) return;

    const onTouchStart = (event: TouchEvent) => {
      if ((event.target as HTMLElement).closest('[data-testid="web-panel-handle"]')) return;
      dragStartY.current = event.touches[0].clientY;
      dragStartTime.current = Date.now();
      dragStartState.current = stateRef.current;
      contentDragActive.current = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (dragStartY.current === null) return;
      if ((event.target as HTMLElement).closest('[data-testid="web-panel-handle"]')) return;

      const touchY = event.touches[0].clientY;
      const deltaY = touchY - dragStartY.current;

      if (!contentDragActive.current) {
        if (Math.abs(deltaY) < TAP_THRESHOLD) return;

        const atScrollTop = scrollTopRef.current <= 1;
        const atFullState = dragStartState.current === 'full';
        const swipingDown = deltaY > 0;
        const swipingUp = deltaY < 0;

        if (atScrollTop && (swipingDown || (swipingUp && !atFullState))) {
          contentDragActive.current = true;
          panel.style.transition = 'none';
        } else {
          dragStartY.current = null;
          return;
        }
      }

      event.preventDefault();

      const panelHeight = panel.offsetHeight;
      if (panelHeight === 0) return;
      const startPercent =
        dragStartState.current === 'closed'
          ? 100
          : WEB_PANEL_SNAP_POINTS[dragStartState.current as Exclude<WebPanelState, 'closed'>];
      const deltaPercent = (deltaY / panelHeight) * 100;
      const nextPercent = Math.max(
        WEB_PANEL_SNAP_POINTS.full,
        Math.min(WEB_PANEL_SNAP_POINTS.peek, startPercent + deltaPercent)
      );
      panel.style.transform = `translateY(${nextPercent}%)`;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!contentDragActive.current || dragStartY.current === null) {
        dragStartY.current = null;
        contentDragActive.current = false;
        return;
      }

      const touchY = event.changedTouches[0].clientY;
      const deltaY = touchY - dragStartY.current;
      const elapsed = Date.now() - dragStartTime.current;
      const fromState = dragStartState.current;
      dragStartY.current = null;
      contentDragActive.current = false;
      snapFromDrag(deltaY, elapsed, fromState, false);
    };

    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('touchend', onTouchEnd);
    };
  }, [enableContentDrag, isLandscape, snapFromDrag]);

  useEffect(() => {
    if (isLandscape || !enableBodyPressExpand) return;
    const panel = panelRef.current;
    if (!panel) return;

    const onPassiveBodyClick = (event: MouseEvent) => {
      if (stateRef.current !== 'partial') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || !panel.contains(target)) return;
      if (target.closest('.web-property-panel-header')) return;
      if (target.closest(interactiveBodyPressSelector)) return;
      onStateChange('full');
    };

    document.addEventListener('click', onPassiveBodyClick, true);
    return () => document.removeEventListener('click', onPassiveBodyClick, true);
  }, [enableBodyPressExpand, interactiveBodyPressSelector, isLandscape, onStateChange]);

  const panelClassName = isLandscape
    ? `web-property-panel--landscape ${isOpen ? 'open' : ''}`
    : `web-property-panel--portrait ${state !== 'closed' ? state : ''}`;
  const cssVars = {
    '--web-panel-surface': surfaceColor,
    '--web-panel-z-index': panelZIndex,
    '--web-panel-backdrop-z-index': backdropZIndex,
    '--web-panel-landscape-right-offset':
      landscapeRightOffset === undefined ? undefined : `${landscapeRightOffset}px`,
    '--web-panel-portrait-bottom-offset':
      portraitBottomOffset === undefined ? undefined : `${portraitBottomOffset}px`,
  } as CSSProperties;
  const renderedChildren =
    typeof children === 'function'
      ? children({
          contentWidth: panelWidth ?? undefined,
          isLandscape,
          isOpen,
          scrollTopRef,
          state,
        })
      : children;

  const chrome = (
    <>
      <div
        className={`web-property-panel-backdrop ${shouldShowBackdrop ? 'open' : ''}`}
        onClick={onClose}
        data-testid="web-panel-backdrop"
        style={cssVars}
      />

      <div ref={panelRef} className={panelClassName} data-testid={panelTestID} style={cssVars}>
        {!isLandscape ? (
          <div
            className="web-property-panel-handle"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            data-testid="web-panel-handle"
          >
            <div className="web-property-panel-handle-bar" />
          </div>
        ) : null}

        {showHeader ? (
          <div className={`web-property-panel-header${headerOverlay ? ' overlay' : ''}`}>
            {titleNode ? (
              <div className="web-property-panel-title-node">{titleNode}</div>
            ) : (
              <span className="web-property-panel-title">{title ?? ''}</span>
            )}
            <button
              className="web-property-panel-close"
              onClick={onClose}
              data-testid="web-panel-close"
              aria-label={t('common.closePanel')}
            >
              <Icon name="X" size="md" color="#9C958A" />
            </button>
          </div>
        ) : null}

        {renderedChildren}
      </div>
    </>
  );

  if (portalToBody && typeof document !== 'undefined') {
    return createPortal(chrome, document.body);
  }

  return chrome;
}
