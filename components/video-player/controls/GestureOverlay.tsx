import { Ionicons } from "@expo/vector-icons";
import { useCallback, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/common/Text";
import { useHaptic } from "@/hooks/useHaptic";
import { useSettings } from "@/utils/atoms/settings";
import type { TapZone } from "./hooks/useGestureDetection";
import { useGestureDetection } from "./hooks/useGestureDetection";
import { useVolumeAndBrightness } from "./hooks/useVolumeAndBrightness";

interface Props {
  screenWidth: number;
  screenHeight: number;
  showControls: boolean;
  onToggleControls: () => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  onSeekForward: (seconds: number) => void;
  onSeekBackward: (seconds: number) => void;
}

interface FeedbackState {
  visible: boolean;
  icon: string;
  text: string;
  side?: "left" | "right";
}

interface DoubleTapState {
  visible: boolean;
  side: "left" | "right" | null;
  accumulatedSeconds: number;
}

/** Duration to wait before resetting accumulated double-tap seconds */
const DOUBLE_TAP_RESET_DELAY = 600;

export const GestureOverlay = ({
  screenWidth,
  screenHeight,
  showControls,
  onToggleControls,
  onSkipForward,
  onSkipBackward,
  onSeekForward,
  onSeekBackward,
}: Props) => {
  const { settings } = useSettings();
  const lightHaptic = useHaptic("light");

  const [feedback, setFeedback] = useState<FeedbackState>({
    visible: false,
    icon: "",
    text: "",
  });
  const [fadeAnim] = useState(new Animated.Value(0));
  const isDraggingRef = useRef(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const lastUpdateTime = useRef(0);

  // Double-tap seek state
  const [doubleTap, setDoubleTap] = useState<DoubleTapState>({
    visible: false,
    side: null,
    accumulatedSeconds: 0,
  });
  const [doubleTapFadeAnim] = useState(new Animated.Value(0));
  const [rippleScaleAnim] = useState(new Animated.Value(0));
  const doubleTapResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const accumulatedSecondsRef = useRef(0);

  const showFeedback = useCallback(
    (
      icon: string,
      text: string,
      side?: "left" | "right",
      isDuringDrag = false,
    ) => {
      // Clear any existing timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      // Defer ALL state updates to avoid useInsertionEffect warning
      requestAnimationFrame(() => {
        setFeedback({ visible: true, icon, text, side });

        if (!isDuringDrag) {
          // For discrete actions (like skip), show normal animation
          Animated.sequence([
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.delay(1000),
            Animated.timing(fadeAnim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start(() => {
            requestAnimationFrame(() => {
              setFeedback((prev) => ({ ...prev, visible: false }));
            });
          });
        } else if (!isDraggingRef.current) {
          // For drag start, just fade in and stay visible
          isDraggingRef.current = true;
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
        // For drag updates, just update the state, don't restart animation
      });
    },
    [fadeAnim],
  );

  const hideDragFeedback = useCallback(() => {
    isDraggingRef.current = false;

    // Delay hiding slightly to avoid flicker
    hideTimeoutRef.current = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        requestAnimationFrame(() => {
          setFeedback((prev) => ({ ...prev, visible: false }));
        });
      });
    }, 100) as unknown as number;
  }, [fadeAnim]);

  const {
    startVolumeDrag,
    updateVolumeDrag,
    endVolumeDrag,
    startBrightnessDrag,
    updateBrightnessDrag,
    endBrightnessDrag,
  } = useVolumeAndBrightness({
    onVolumeChange: (volume: number) => {
      // Throttle feedback updates during dragging to reduce callback frequency
      const now = Date.now();
      if (now - lastUpdateTime.current < 50) return; // 50ms throttle
      lastUpdateTime.current = now;

      // Defer feedback update to avoid useInsertionEffect warning
      requestAnimationFrame(() => {
        showFeedback("volume-high", `${volume}%`, "right", true);
      });
    },
    onBrightnessChange: (brightness: number) => {
      // Throttle feedback updates during dragging to reduce callback frequency
      const now = Date.now();
      if (now - lastUpdateTime.current < 50) return; // 50ms throttle
      lastUpdateTime.current = now;

      // Defer feedback update to avoid useInsertionEffect warning
      requestAnimationFrame(() => {
        showFeedback("sunny", `${brightness}%`, "left", true);
      });
    },
  });

  const handleSkipForward = useCallback(() => {
    if (!settings.enableHorizontalSwipeSkip) return;
    lightHaptic();
    // Defer all actions to avoid useInsertionEffect warning
    requestAnimationFrame(() => {
      onSkipForward();
      showFeedback("play-forward", `+${settings.forwardSkipTime}s`);
    });
  }, [
    settings.enableHorizontalSwipeSkip,
    settings.forwardSkipTime,
    lightHaptic,
    onSkipForward,
    showFeedback,
  ]);

  const handleSkipBackward = useCallback(() => {
    if (!settings.enableHorizontalSwipeSkip) return;
    lightHaptic();
    // Defer all actions to avoid useInsertionEffect warning
    requestAnimationFrame(() => {
      onSkipBackward();
      showFeedback("play-back", `-${settings.rewindSkipTime}s`);
    });
  }, [
    settings.enableHorizontalSwipeSkip,
    settings.rewindSkipTime,
    lightHaptic,
    onSkipBackward,
    showFeedback,
  ]);

  const handleVerticalDragStart = useCallback(
    (side: "left" | "right", startY: number) => {
      if (side === "left" && settings.enableLeftSideBrightnessSwipe) {
        lightHaptic();
        // Defer drag start to avoid useInsertionEffect warning
        requestAnimationFrame(() => {
          startBrightnessDrag(startY);
        });
      } else if (side === "right" && settings.enableRightSideVolumeSwipe) {
        lightHaptic();
        // Defer drag start to avoid useInsertionEffect warning
        requestAnimationFrame(() => {
          startVolumeDrag(startY);
        });
      }
    },
    [
      settings.enableLeftSideBrightnessSwipe,
      settings.enableRightSideVolumeSwipe,
      lightHaptic,
      startBrightnessDrag,
      startVolumeDrag,
    ],
  );

  const handleVerticalDragMove = useCallback(
    (side: "left" | "right", deltaY: number) => {
      // Use requestAnimationFrame to defer drag move updates too
      requestAnimationFrame(() => {
        if (side === "left" && settings.enableLeftSideBrightnessSwipe) {
          updateBrightnessDrag(deltaY);
        } else if (side === "right" && settings.enableRightSideVolumeSwipe) {
          updateVolumeDrag(deltaY);
        }
      });
    },
    [
      settings.enableLeftSideBrightnessSwipe,
      settings.enableRightSideVolumeSwipe,
      updateBrightnessDrag,
      updateVolumeDrag,
    ],
  );

  const handleVerticalDragEnd = useCallback(
    (side: "left" | "right") => {
      // Defer drag end to avoid useInsertionEffect warning
      requestAnimationFrame(() => {
        if (side === "left") {
          endBrightnessDrag();
        } else {
          endVolumeDrag();
        }
        hideDragFeedback();
      });
    },
    [endBrightnessDrag, endVolumeDrag, hideDragFeedback],
  );

  const handleDoubleTap = useCallback(
    (zone: TapZone) => {
      if (zone === "center") return;

      const seekSeconds = settings.forwardSkipTime;
      lightHaptic();

      // Clear reset timeout - user is still tapping
      if (doubleTapResetTimeout.current) {
        clearTimeout(doubleTapResetTimeout.current);
        doubleTapResetTimeout.current = null;
      }

      // Accumulate seconds
      accumulatedSecondsRef.current += seekSeconds;
      const totalSeconds = accumulatedSecondsRef.current;

      // Perform the seek
      requestAnimationFrame(() => {
        if (zone === "right") {
          onSeekForward(seekSeconds);
        } else {
          onSeekBackward(seekSeconds);
        }
      });

      // Update visual state
      setDoubleTap({
        visible: true,
        side: zone === "left" ? "left" : "right",
        accumulatedSeconds: totalSeconds,
      });

      // Ripple animation: scale up then reset
      rippleScaleAnim.setValue(0.3);
      Animated.parallel([
        Animated.timing(doubleTapFadeAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(rippleScaleAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Schedule reset: fade out and reset accumulated seconds after delay
      doubleTapResetTimeout.current = setTimeout(() => {
        accumulatedSecondsRef.current = 0;
        Animated.timing(doubleTapFadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          requestAnimationFrame(() => {
            setDoubleTap({
              visible: false,
              side: null,
              accumulatedSeconds: 0,
            });
          });
        });
      }, DOUBLE_TAP_RESET_DELAY);
    },
    [
      settings.forwardSkipTime,
      lightHaptic,
      onSeekForward,
      onSeekBackward,
      doubleTapFadeAnim,
      rippleScaleAnim,
    ],
  );

  const { handleTouchStart, handleTouchMove, handleTouchEnd } =
    useGestureDetection({
      onSwipeLeft: handleSkipBackward,
      onSwipeRight: handleSkipForward,
      onVerticalDragStart: handleVerticalDragStart,
      onVerticalDragMove: handleVerticalDragMove,
      onVerticalDragEnd: handleVerticalDragEnd,
      onTap: onToggleControls,
      onDoubleTap: handleDoubleTap,
      screenWidth,
      screenHeight,
    });

  // If controls are visible, act as a transparent tap-to-dismiss overlay.
  // The dark scrim is now provided by a Reanimated Animated.View in Controls.tsx
  // so that it animates in/out in sync with the control fade animations.
  if (showControls) {
    return (
      <Pressable
        onPress={onToggleControls}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        }}
      />
    );
  }

  return (
    <>
      {/* Gesture detection area */}
      <Pressable
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: "absolute",
          width: screenWidth,
          height: screenHeight,
          backgroundColor: "transparent",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        }}
      />

      {/* Double-tap seek ripple feedback */}
      {doubleTap.visible && doubleTap.side && (
        <Animated.View
          pointerEvents='none'
          style={[
            styles.doubleTapZone,
            doubleTap.side === "left"
              ? styles.doubleTapLeft
              : styles.doubleTapRight,
            {
              width: screenWidth / 3,
              height: screenHeight,
              opacity: doubleTapFadeAnim,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.ripple,
              {
                transform: [{ scale: rippleScaleAnim }],
              },
            ]}
          />
          <View style={styles.doubleTapContent}>
            <Ionicons
              name={
                doubleTap.side === "right" ? "play-forward" : "play-back"
              }
              size={32}
              color='white'
            />
            <Text style={styles.doubleTapText}>
              {doubleTap.side === "right" ? "+" : "-"}
              {doubleTap.accumulatedSeconds}s
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Feedback overlay (swipe skip / volume / brightness) */}
      {feedback.visible && (
        <Animated.View
          style={{
            position: "absolute",
            top: "50%",
            left:
              feedback.side === "left"
                ? "20%"
                : feedback.side === "right"
                  ? "80%"
                  : "50%",
            transform: [
              { translateY: -25 },
              {
                translateX:
                  feedback.side === "right"
                    ? -50
                    : feedback.side === "left"
                      ? 0
                      : -50,
              },
            ],
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: 8,
            flexDirection: "row",
            alignItems: "center",
            opacity: fadeAnim,
            zIndex: 20,
          }}
        >
          <Ionicons
            name={feedback.icon as any}
            size={24}
            color='white'
            style={{ marginRight: 8 }}
          />
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            {feedback.text}
          </Text>
        </Animated.View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  doubleTapZone: {
    position: "absolute",
    top: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 20,
    overflow: "hidden",
  },
  doubleTapLeft: {
    left: 0,
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
  },
  doubleTapRight: {
    right: 0,
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
  },
  ripple: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  doubleTapContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  doubleTapText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
  },
});
