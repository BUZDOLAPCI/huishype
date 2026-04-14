import type { CSSProperties, ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';

import { AerialImageCard } from '@/src/components/AerialImageCard';
import { ConsensusAlignment } from '@/src/components/ConsensusAlignment';
import { FMVVisualization, type FMVData } from '@/src/components/FMVVisualization';
import { Icon } from '@/src/components/ui/Icon';

import { colors, shadows } from '../theme';
import { RouteSection, surfaceStyle } from './shared';

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #FCF8F1 0%, #F7F1E7 100%)',
  color: colors.text,
};

const shellStyle: CSSProperties = {
  width: 'min(100%, 1040px)',
  margin: '0 auto',
  padding: '24px clamp(16px, 4vw, 32px) 96px',
  display: 'grid',
  gap: 20,
};

const heroStyle: CSSProperties = {
  ...surfaceStyle,
  padding: '22px clamp(18px, 2vw, 28px)',
  display: 'grid',
  gap: 16,
};

const heroActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
};

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 42,
  padding: '0 16px',
  borderRadius: 999,
  border: `1px solid ${colors.border}`,
  background: 'rgba(255, 255, 255, 0.7)',
  color: colors.text,
  fontWeight: 700,
  boxShadow: shadows.card,
};

const demoHighFmv: FMVData = {
  value: 628000,
  confidence: 'high',
  guessCount: 23,
  distribution: {
    min: 540000,
    p10: 558000,
    p25: 584000,
    p50: 628000,
    p75: 652000,
    p90: 674000,
    max: 690000,
  },
  officialValuation: 612000,
  askingPrice: 645000,
  divergence: -3,
};

const demoMediumFmv: FMVData = {
  value: 553000,
  confidence: 'medium',
  guessCount: 7,
  distribution: {
    min: 490000,
    p10: 505000,
    p25: 525000,
    p50: 553000,
    p75: 582000,
    p90: 608000,
    max: 622000,
  },
  officialValuation: 540000,
  askingPrice: 579000,
  divergence: -4,
};

const demoLowFmv: FMVData = {
  value: 491000,
  confidence: 'low',
  guessCount: 2,
  distribution: {
    min: 430000,
    p10: 438000,
    p25: 451000,
    p50: 491000,
    p75: 529000,
    p90: 556000,
    max: 574000,
  },
  officialValuation: 503000,
  askingPrice: 515000,
  divergence: -5,
};

const demoWideFmv: FMVData = {
  value: 576000,
  confidence: 'medium',
  guessCount: 12,
  distribution: {
    min: 420000,
    p10: 444000,
    p25: 485000,
    p50: 576000,
    p75: 661000,
    p90: 722000,
    max: 760000,
  },
  officialValuation: 565000,
  askingPrice: 620000,
  divergence: -7,
};

const consensusGuesses = [
  { userId: '1', guessedPrice: 545000, createdAt: '2026-04-11T08:30:00Z', user: { username: 'mila', displayName: 'Mila', karma: 142 } },
  { userId: '2', guessedPrice: 552000, createdAt: '2026-04-11T08:45:00Z', user: { username: 'sam', displayName: 'Sam', karma: 89 } },
  { userId: '3', guessedPrice: 562000, createdAt: '2026-04-11T09:05:00Z', user: { username: 'peter', displayName: 'Peter', karma: 204 } },
  { userId: '4', guessedPrice: 610000, createdAt: '2026-04-11T09:10:00Z', user: { username: 'lena', displayName: 'Lena', karma: 73 } },
] as const;

function PageLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} style={buttonStyle}>
      {children}
    </Link>
  );
}

function ShowcaseHeader() {
  return (
    <div style={heroStyle}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="Star" size="md" color={colors.goldDeep} />
          <span style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 12, fontWeight: 800, color: colors.textSoft }}>
            Showcase
          </span>
        </div>
        <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.1, color: colors.text }}>
          The browser-first contract for visual components
        </h1>
        <p style={{ margin: 0, maxWidth: 720, color: colors.textMuted, lineHeight: 1.65 }}>
          These pages are first-class browser routes. They exist so the visual suite can exercise the real runtime state
          instead of falling through to the address catch-all.
        </p>
      </div>

      <div style={heroActionsStyle}>
        <PageLink to="/">Map</PageLink>
        <PageLink to="/showcase/fmv-visualization">FMV</PageLink>
        <PageLink to="/showcase/consensus-alignment">Consensus</PageLink>
        <PageLink to="/showcase/pdok-aerial-imagery">PDOK imagery</PageLink>
      </div>
    </div>
  );
}

export function ShowcaseLayoutRoute() {
  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <ShowcaseHeader />
        <Outlet />
      </div>
    </div>
  );
}

export function ShowcaseLandingRoute() {
  return (
    <RouteSection
      title="Showcase routes"
      description="Browse the dedicated component showcases used by the visual suite."
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={surfaceStyle as CSSProperties}>
          <div style={{ display: 'grid', gap: 8, padding: 20 }}>
            <h2 style={{ margin: 0, fontSize: 22, color: colors.text }}>FMV visualization</h2>
            <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.6 }}>
              Crowd estimate states, distribution bars, and comparison copy.
            </p>
            <PageLink to="/showcase/fmv-visualization">Open FMV showcase</PageLink>
          </div>
        </div>

        <div style={surfaceStyle as CSSProperties}>
          <div style={{ display: 'grid', gap: 8, padding: 20 }}>
            <h2 style={{ margin: 0, fontSize: 22, color: colors.text }}>Consensus alignment</h2>
            <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.6 }}>
              Positive feedback states for aligned, close, and outlier guesses.
            </p>
            <PageLink to="/showcase/consensus-alignment">Open consensus showcase</PageLink>
          </div>
        </div>

        <div style={surfaceStyle as CSSProperties}>
          <div style={{ display: 'grid', gap: 8, padding: 20 }}>
            <h2 style={{ margin: 0, fontSize: 22, color: colors.text }}>PDOK aerial imagery</h2>
            <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.6 }}>
              Reference aerial image cards with marker overlays and address bars.
            </p>
            <PageLink to="/showcase/pdok-aerial-imagery">Open imagery showcase</PageLink>
          </div>
        </div>
      </div>
    </RouteSection>
  );
}

export function FMVVisualizationShowcaseRoute() {
  return (
    <div data-testid="fmv-visualization-showcase" style={{ display: 'grid', gap: 20 }}>
      <RouteSection
        title="FMV visualization showcase"
        description="Each card demonstrates the live crowd estimate component in a different confidence state."
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div data-testid="fmv-visualization-high" style={surfaceStyle as CSSProperties}>
            <div style={{ display: 'grid', gap: 12, padding: 20 }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: colors.goldDeep }}>
                  Strong consensus
                </div>
                <p style={{ margin: 0, color: colors.textMuted }}>High confidence, broader distribution, and a visible asking-price comparison.</p>
              </div>
              <FMVVisualization fmv={demoHighFmv} userGuess={635000} countryCode="NL" variant="full" />
            </div>
          </div>

          <div data-testid="fmv-visualization-medium" style={surfaceStyle as CSSProperties}>
            <div style={{ display: 'grid', gap: 12, padding: 20 }}>
              <FMVVisualization fmv={demoMediumFmv} userGuess={545000} countryCode="NL" variant="full" />
            </div>
          </div>

          <div data-testid="fmv-visualization-low" style={surfaceStyle as CSSProperties}>
            <div style={{ display: 'grid', gap: 12, padding: 20 }}>
              <FMVVisualization fmv={demoLowFmv} userGuess={482000} countryCode="NL" variant="full" />
            </div>
          </div>

          <div data-testid="fmv-visualization-wide" style={surfaceStyle as CSSProperties}>
            <div style={{ display: 'grid', gap: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: colors.textSoft }}>
                Wide distribution
              </div>
              <FMVVisualization fmv={demoWideFmv} userGuess={715000} countryCode="NL" variant="full" />
            </div>
          </div>

          <div data-testid="fmv-no-data-card" style={surfaceStyle as CSSProperties}>
            <div style={{ padding: 20 }}>
              <FMVVisualization fmv={null} countryCode="NL" variant="full" />
            </div>
          </div>
        </div>
      </RouteSection>
    </div>
  );
}

export function ConsensusAlignmentShowcaseRoute() {
  return (
    <div data-testid="consensus-alignment-showcase" style={{ display: 'grid', gap: 20 }}>
      <RouteSection
        title="Consensus alignment showcase"
        description="Feedback cards for aligned, close, and outlier guesses."
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div data-testid="consensus-alignment-aligned" style={surfaceStyle as CSSProperties}>
            <div style={{ padding: 20 }}>
              <ConsensusAlignment
                userGuess={550000}
                crowdEstimate={548000}
                guessCount={12}
                percentileRank={90}
                topPredictorsAgreement={90}
                guesses={consensusGuesses as any}
                countryCode="NL"
                variant="full"
              />
            </div>
          </div>

          <div data-testid="consensus-alignment-close" style={surfaceStyle as CSSProperties}>
            <div style={{ padding: 20 }}>
              <ConsensusAlignment
                userGuess={540000}
                crowdEstimate={570000}
                guessCount={8}
                percentileRank={62}
                topPredictorsAgreement={63}
                guesses={consensusGuesses as any}
                countryCode="NL"
                variant="full"
              />
            </div>
          </div>

          <div data-testid="consensus-alignment-different" style={surfaceStyle as CSSProperties}>
            <div style={{ padding: 20 }}>
              <ConsensusAlignment
                userGuess={635000}
                crowdEstimate={525000}
                guessCount={11}
                percentileRank={18}
                topPredictorsAgreement={24}
                guesses={consensusGuesses as any}
                countryCode="NL"
                variant="full"
              />
            </div>
          </div>

          <div data-testid="consensus-alignment-different-below" style={surfaceStyle as CSSProperties}>
            <div style={{ padding: 20 }}>
              <ConsensusAlignment
                userGuess={462000}
                crowdEstimate={555000}
                guessCount={11}
                percentileRank={15}
                topPredictorsAgreement={18}
                guesses={consensusGuesses as any}
                countryCode="NL"
                variant="full"
              />
            </div>
          </div>
        </div>
      </RouteSection>
    </div>
  );
}

export function PDOKAerialImageryShowcaseRoute() {
  return (
    <div data-testid="pdok-aerial-imagery-showcase" style={{ display: 'grid', gap: 20 }}>
      <RouteSection
        title="PDOK aerial imagery showcase"
        description="Aerial snapshots and markers for the canonical NL imagery contract."
      >
        <div style={{ display: 'grid', gap: 18 }}>
          <AerialImageCard
            testID="aerial-tegenbosch"
            address="Tegenbosch 16, Eindhoven"
            lat={51.4613225767584}
            lon={5.41869962895219}
          />
          <AerialImageCard
            testID="aerial-dom-tower"
            address="Domplein 1, Utrecht"
            lat={52.0907}
            lon={5.1214}
          />
          <AerialImageCard
            testID="aerial-deflectiespoelstraat"
            address="Deflectiespoelstraat 16, Eindhoven"
            lat={51.4300456}
            lon={5.4557789}
          />
        </div>
      </RouteSection>
    </div>
  );
}
