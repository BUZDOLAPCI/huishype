import BottomSheetLib, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { forwardRef, useCallback, type ReactNode } from 'react';

interface BottomSheetProps {
  children: ReactNode;
  snapPoints?: (string | number)[];
  enablePanDownToClose?: boolean;
  onClose?: () => void;
}

export const BottomSheet = forwardRef<BottomSheetLib, BottomSheetProps>(
  function BottomSheet(
    {
      children,
      snapPoints = ['25%', '50%', '90%'],
      enablePanDownToClose = true,
      onClose,
    },
    ref
  ) {
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    return (
      <BottomSheetLib
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose={enablePanDownToClose}
        backdropComponent={renderBackdrop}
        onClose={onClose}
        backgroundStyle={{ backgroundColor: 'white' }}
        handleIndicatorStyle={{ backgroundColor: '#D1D5DB' }}
      >
        <BottomSheetView className="flex-1 px-4">{children}</BottomSheetView>
      </BottomSheetLib>
    );
  }
);
