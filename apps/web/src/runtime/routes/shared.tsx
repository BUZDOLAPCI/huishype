import type { CSSProperties, ReactNode } from 'react';
import { Link, type To, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/src/components/ui/Icon';
import { buildPropertyRoute, type PropertyReturnTarget } from '@/src/utils/property-route';
import { colors, shadows } from '../theme';

export interface DemoProperty {
  id: string;
  address: string;
  city: string;
  countryCode: string;
  priceLabel: string;
  note: string;
}

export const demoProperties: DemoProperty[] = [
  {
    id: 'demo-eindhoven-beeldbuisring-41',
    address: 'Beeldbuisring 41',
    city: 'Eindhoven',
    countryCode: 'NL',
    priceLabel: '€498.000',
    note: 'Warm signal cluster near Strijp-S',
  },
  {
    id: 'demo-amsterdam-prinsengracht-263',
    address: 'Prinsengracht 263',
    city: 'Amsterdam',
    countryCode: 'NL',
    priceLabel: '€1.240.000',
    note: 'High-attention canal house with active guesses',
  },
  {
    id: 'demo-antwerp-kloosterstraat-88',
    address: 'Kloosterstraat 88',
    city: 'Antwerp',
    countryCode: 'BE',
    priceLabel: '€632.000',
    note: 'Belgian expansion sample with saved demand',
  },
];

export const surfaceStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.88)',
  border: `1px solid ${colors.border}`,
  borderRadius: 24,
  boxShadow: shadows.card,
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
};

const heroGridStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
};

const propertyCardStyle: CSSProperties = {
  ...surfaceStyle,
  padding: 20,
  display: 'grid',
  gap: 14,
};

const actionListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
};

const buttonBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 999,
  border: `1px solid rgba(199, 191, 179, 0.72)`,
  fontWeight: 700,
  transition: 'transform 160ms ease, border-color 160ms ease, background-color 160ms ease',
};

const primaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: colors.gold,
  color: colors.surface,
  borderColor: colors.gold,
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: 'rgba(255, 255, 255, 0.72)',
  color: colors.text,
};

const detailHeaderStyle: CSSProperties = {
  ...surfaceStyle,
  padding: '20px clamp(18px, 2vw, 28px)',
  display: 'grid',
  gap: 16,
  marginBottom: 20,
};

const detailTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

const detailMetaStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
};

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 999,
  background: colors.surfaceMuted,
  color: colors.textMuted,
  fontSize: 14,
  fontWeight: 600,
};

export function RouteSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 24, color: colors.text }}>{title}</h2>
        {description ? (
          <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.6 }}>{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function RouteGrid({
  children,
  min = 240,
}: {
  children: ReactNode;
  min?: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 18,
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

export function ActionLink({
  to,
  label,
  icon,
  tone = 'secondary',
}: {
  to: To;
  label: string;
  icon: IconName;
  tone?: 'primary' | 'secondary';
}) {
  return (
    <Link
      to={to}
      style={tone === 'primary' ? primaryButtonStyle : secondaryButtonStyle}
    >
      <Icon
        name={icon}
        size="sm"
        weight={tone === 'primary' ? 'fill' : 'regular'}
        color={tone === 'primary' ? colors.surface : colors.text}
      />
      <span>{label}</span>
    </Link>
  );
}

export function PropertyCard({
  property,
  returnTo,
}: {
  property: DemoProperty;
  returnTo?: PropertyReturnTarget;
}) {
  return (
    <article style={propertyCardStyle}>
      <div style={{ display: 'grid', gap: 8 }}>
        <span style={{ ...pillStyle, width: 'fit-content' }}>{property.countryCode}</span>
        <h3 style={{ margin: 0, fontSize: 22, color: colors.text }}>{property.address}</h3>
        <p style={{ margin: 0, color: colors.textMuted }}>{property.city}</p>
      </div>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: colors.text }}>
        {property.priceLabel}
      </p>
      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.6 }}>{property.note}</p>
      <div style={actionListStyle}>
        <ActionLink
          to={buildPropertyRoute(property.id, returnTo)}
          label="Open property"
          icon="ArrowRight"
          tone="primary"
        />
      </div>
    </article>
  );
}

export function HeroCards({
  children,
}: {
  children: ReactNode;
}) {
  return <div style={heroGridStyle}>{children}</div>;
}

export function DetailRouteShell({
  title,
  subtitle,
  meta,
  fallbackTo = '/',
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: string[];
  fallbackTo?: To;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(fallbackTo);
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <header style={detailHeaderStyle}>
        <div style={detailTitleRowStyle}>
          <button
            type="button"
            onClick={handleBack}
            style={secondaryButtonStyle}
          >
            <Icon name="ArrowLeft" size="sm" color={colors.text} />
            <span>Back</span>
          </button>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ActionLink to="/" label="Map" icon="MapTrifold" />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 'clamp(1.8rem, 3vw, 2.5rem)' }}>{title}</h2>
          {subtitle ? (
            <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.6 }}>{subtitle}</p>
          ) : null}
        </div>

        {meta?.length ? (
          <div style={detailMetaStyle}>
            {meta.map((item) => (
              <span key={item} style={pillStyle}>
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {children}
    </div>
  );
}
