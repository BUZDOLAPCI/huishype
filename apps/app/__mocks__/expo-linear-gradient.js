const React = require('react');
const { View } = require('react-native');

const LinearGradient = React.forwardRef((props, ref) =>
  React.createElement(View, { ...props, ref }, props.children)
);

LinearGradient.displayName = 'LinearGradient';

module.exports = {
  __esModule: true,
  LinearGradient,
};
