// Mock for @gorhom/bottom-sheet
const React = require('react');

const BottomSheet = React.forwardRef(({ children, ...props }, ref) => {
  React.useImperativeHandle(ref, () => ({
    snapToIndex: jest.fn(),
    snapToPosition: jest.fn(),
    expand: jest.fn(),
    collapse: jest.fn(),
    close: jest.fn(),
  }));
  return React.createElement('BottomSheet', props, children);
});

const BottomSheetView = ({ children, ...props }) =>
  React.createElement('BottomSheetView', props, children);

const BottomSheetScrollView = ({ children, ...props }) =>
  React.createElement('BottomSheetScrollView', props, children);

const BottomSheetModal = React.forwardRef(({ children, ...props }, ref) => {
  React.useImperativeHandle(ref, () => ({
    present: jest.fn(),
    dismiss: jest.fn(),
    snapToIndex: jest.fn(),
    expand: jest.fn(),
    collapse: jest.fn(),
    close: jest.fn(),
  }));
  return React.createElement('BottomSheetModal', props, children);
});

const BottomSheetModalProvider = ({ children }) => children;

module.exports = {
  __esModule: true,
  default: BottomSheet,
  BottomSheet,
  BottomSheetView,
  BottomSheetScrollView,
  BottomSheetModal,
  BottomSheetModalProvider,
  useBottomSheet: () => ({
    snapToIndex: jest.fn(),
    expand: jest.fn(),
    collapse: jest.fn(),
    close: jest.fn(),
  }),
  useBottomSheetModal: () => ({
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
  }),
};
