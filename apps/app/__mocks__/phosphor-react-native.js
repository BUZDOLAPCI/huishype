// Mock for phosphor-react-native — every Phosphor icon is a simple Text element.
const React = require('react');

const createIconMock = (name) => {
  const Component = (props) =>
    React.createElement('Text', { testID: props.testID || `phosphor-${name}`, ...props }, name);
  Component.displayName = name;
  return Component;
};

// Export every icon used in the app's Icon component map
const iconNames = [
  'ArrowLeft', 'ArrowRight', 'ArrowSquareOut', 'Bell', 'BookmarkSimple',
  'Buildings', 'Calendar', 'Camera', 'CaretDown', 'CaretLeft', 'CaretRight',
  'ChartLineUp', 'ChatCircle', 'Check', 'CheckCircle', 'Crown', 'Crosshair',
  'CurrencyEur', 'Copy', 'CopySimple', 'DotsThreeVertical', 'Envelope', 'Eye',
  'Flag', 'Flame', 'GearSix',
  'Globe', 'Heart', 'HouseLine', 'Info', 'Link', 'List', 'ListBullets',
  'MagnifyingGlass', 'MapPin', 'MapTrifold', 'Medal', 'PaperPlaneTilt',
  'PencilSimple', 'Plus', 'Ruler', 'ShareNetwork', 'ShieldCheck', 'SignOut',
  'Star', 'Tag', 'Thermometer', 'Trash', 'TrendDown', 'TrendUp', 'Trophy',
  'User', 'UserPlus', 'Users', 'WarningCircle', 'X',
];

const mocks = { __esModule: true };
for (const name of iconNames) {
  mocks[name] = createIconMock(name);
}

module.exports = mocks;
