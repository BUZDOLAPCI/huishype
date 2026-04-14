import type { CSSProperties } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from '@/src/components/ui/Icon';
import { colors, shadows } from '../theme';

const tabs: Array<{
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}> = [
  { to: '/', label: 'Map', icon: 'MapTrifold', end: true },
  { to: '/feed', label: 'Feed', icon: 'List' },
  { to: '/saved', label: 'Saved', icon: 'BookmarkSimple' },
  { to: '/profile', label: 'Profile', icon: 'User' },
];

const shellStyle: CSSProperties = {
  minHeight: '100vh',
  position: 'relative',
};

const navWrapStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  justifyContent: 'center',
  padding: '16px clamp(16px, 4vw, 32px) max(16px, env(safe-area-inset-bottom))',
  pointerEvents: 'none',
  zIndex: 20,
};

const navStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 6,
  width: 'min(100%, 460px)',
  padding: 6,
  borderRadius: 999,
  border: `1px solid ${colors.border}`,
  background: 'rgba(255, 255, 255, 0.78)',
  boxShadow: shadows.tab,
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  pointerEvents: 'auto',
};

const tabStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  gap: 4,
  minHeight: 58,
  borderRadius: 999,
  color: colors.textSoft,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  transition: 'background-color 160ms ease, color 160ms ease, transform 160ms ease',
};

const activeTabStyle: CSSProperties = {
  background: colors.gold,
  color: colors.surface,
  transform: 'translateY(-1px)',
};

export function TabLayout() {
  return (
    <div style={shellStyle}>
      <Outlet />

      <div style={navWrapStyle}>
        <nav aria-label="Primary" style={navStyle}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              role="tab"
              data-testid={`${tab.label.toLowerCase()}-tab`}
              style={({ isActive }) => ({
                ...tabStyle,
                ...(isActive ? activeTabStyle : null),
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    name={tab.icon}
                    size="md"
                    weight={isActive ? 'fill' : 'regular'}
                    color={isActive ? colors.surface : colors.textSoft}
                  />
                  <span>{tab.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
