import { Link } from 'react-router-dom';

import { Icon } from '@/src/components/ui/Icon';

import {
  CenteredState,
  mergeStyles,
  primaryButtonStyle,
  safeTopStyle,
  screenStyle,
} from '../dom';
import { colors } from '../theme';

export function NotFoundRoute() {
  return (
    <div style={mergeStyles(screenStyle, safeTopStyle)}>
      <CenteredState
        icon={<Icon name="WarningCircle" size={52} color={colors.textSoft} />}
        title="Page not found"
        body="The browser router owns this path now, and no route matched it."
        action={(
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/" style={primaryButtonStyle}>Map</Link>
            <Link to="/feed" style={primaryButtonStyle}>Feed</Link>
            <Link to="/profile" style={primaryButtonStyle}>Profile</Link>
          </div>
        )}
      />
    </div>
  );
}
