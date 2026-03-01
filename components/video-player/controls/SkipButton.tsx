import type React from "react";
import { Text, TouchableOpacity, View, type ViewProps } from "react-native";

interface SkipButtonProps extends ViewProps {
  onPress: () => void;
  showButton: boolean;
  buttonText: string;
}

const SkipButton: React.FC<SkipButtonProps> = ({
  onPress,
  showButton,
  buttonText,
  ...props
}) => {
  // Use size-based hiding instead of display:none / NativeWind "hidden" class.
  // In React Native Fabric (New Architecture), toggling display:none causes the
  // native view to be removed and re-inserted, which can race with pending
  // Reanimated layout updates on sibling views and trigger a
  // RetryableMountingLayerException. Collapsing to 0×0 keeps the native view
  // in the tree so no REMOVE/INSERT mount items are generated.
  return (
    <View
      style={
        showButton ? undefined : { maxWidth: 0, maxHeight: 0, overflow: "hidden" }
      }
      pointerEvents={showButton ? "box-none" : "none"}
      {...props}
    >
      <TouchableOpacity
        onPress={onPress}
        className='bg-black/60 rounded-md px-3 py-3 border border-neutral-900'
      >
        <Text className='text-white font-bold'>{buttonText}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default SkipButton;
