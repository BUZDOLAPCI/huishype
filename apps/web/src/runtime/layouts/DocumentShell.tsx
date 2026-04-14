import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/src/components/ui/Icon';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { colors, shadows } from '../theme';

interface DocumentShellProps {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const shellStyle: CSSProperties = {
  width: '100%',
  maxWidth: 1280,
  margin: '0 auto',
  padding: '24px clamp(16px, 3vw, 32px) 120px',
};

const topBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 28,
};

const brandLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderRadius: 999,
  border: `1px solid ${colors.border}`,
  background: 'rgba(255, 255, 255, 0.74)',
  boxShadow: shadows.card,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  color: colors.text,
  fontWeight: 700,
  letterSpacing: '0.02em',
};

const headerStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  marginBottom: 28,
};

const eyebrowStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: colors.goldDeep,
};

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(2rem, 3.6vw, 3.3rem)',
  lineHeight: 1,
  letterSpacing: '-0.05em',
  color: colors.text,
};

const descriptionStyle: CSSProperties = {
  margin: 0,
  maxWidth: 760,
  color: colors.textMuted,
  fontSize: 16,
  lineHeight: 1.6,
};

export function DocumentShell({
  title,
  eyebrow,
  description,
  actions,
  children,
}: DocumentShellProps) {
  useDocumentTitle(title);

  return (
    <div className="app-root">
      <div style={shellStyle}>
        <div style={topBarStyle}>
          <Link to="/" style={brandLinkStyle}>
            <Icon name="HouseLine" size="sm" weight="bold" color={colors.goldDeep} />
            <span>HuisHype Web</span>
          </Link>
          {actions}
        </div>

        <header style={headerStyle}>
          {eyebrow ? <span style={eyebrowStyle}>{eyebrow}</span> : null}
          <div style={titleRowStyle}>
            <h1 style={titleStyle}>{title}</h1>
            {actions ? <div style={{ minHeight: 48 }} /> : null}
          </div>
          {description ? <p style={descriptionStyle}>{description}</p> : null}
        </header>

        {children}
      </div>
    </div>
  );
}
