// Mock for @expo/vector-icons
const React = require('react');

const createIconComponent = (name) => {
  const Component = (props) =>
    React.createElement('Text', { testID: `icon-${name}`, ...props });
  Component.displayName = name;
  return Component;
};

module.exports = {
  __esModule: true,
  default: createIconComponent('Icon'),
  FontAwesome: createIconComponent('FontAwesome'),
  FontAwesome5: createIconComponent('FontAwesome5'),
  Ionicons: createIconComponent('Ionicons'),
  MaterialIcons: createIconComponent('MaterialIcons'),
  MaterialCommunityIcons: createIconComponent('MaterialCommunityIcons'),
  Feather: createIconComponent('Feather'),
  AntDesign: createIconComponent('AntDesign'),
  Entypo: createIconComponent('Entypo'),
  EvilIcons: createIconComponent('EvilIcons'),
  Foundation: createIconComponent('Foundation'),
  Octicons: createIconComponent('Octicons'),
  SimpleLineIcons: createIconComponent('SimpleLineIcons'),
  Zocial: createIconComponent('Zocial'),
};
