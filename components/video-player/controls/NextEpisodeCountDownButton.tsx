import type React from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  TouchableOpacity,
  type TouchableOpacityProps,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/common/Text";
import { Colors } from "@/constants/Colors";

interface NextEpisodeCountDownButtonProps extends TouchableOpacityProps {
  onFinish?: () => void;
  onPress?: () => void;
  show: boolean;
}

const NextEpisodeCountDownButton: React.FC<NextEpisodeCountDownButtonProps> = ({
  onFinish,
  onPress,
  show,
  ...props
}) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (show) {
      progress.value = 0;
      progress.value = withTiming(
        1,
        {
          duration: 10000, // 10 seconds
          easing: Easing.linear,
        },
        (finished) => {
          if (finished && onFinish) {
            runOnJS(onFinish)();
          }
        },
      );
    } else {
      // Cancel any running animation so there are no pending UI-thread updates
      // targeting the Animated.View after it becomes hidden.
      cancelAnimation(progress);
      progress.value = 0;
    }
  }, [show, onFinish]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: `${progress.value * 100}%`,
      backgroundColor: Colors.primary,
    };
  });

  const handlePress = () => {
    if (onPress) {
      onPress();
    }
  };

  const { t } = useTranslation();

  // Always render (never return null) to keep the native view in Fabric's tree.
  // Returning null causes a REMOVE/INSERT cycle for the Animated.View inside,
  // which can race with pending Reanimated layout updates and trigger a
  // RetryableMountingLayerException. Use size-based hiding instead.
  return (
    <TouchableOpacity
      className='w-32 overflow-hidden rounded-md bg-black/60 border border-neutral-900'
      style={
        show ? undefined : { maxWidth: 0, maxHeight: 0, overflow: "hidden" }
      }
      pointerEvents={show ? "auto" : "none"}
      {...props}
      onPress={handlePress}
    >
      <Animated.View style={animatedStyle} />
      <View className='px-3 py-3'>
        <Text numberOfLines={1} className='text-center font-bold'>
          {t("player.next_episode")}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default NextEpisodeCountDownButton;
