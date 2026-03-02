import { useCallback, useRef } from "react";
import type { GestureResponderEvent } from "react-native";

export type TapZone = "left" | "center" | "right";

export interface SwipeGestureOptions {
  minDistance?: number;
  maxDuration?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onVerticalDragStart?: (side: "left" | "right", initialY: number) => void;
  onVerticalDragMove?: (
    side: "left" | "right",
    deltaY: number,
    currentY: number,
  ) => void;
  onVerticalDragEnd?: (side: "left" | "right") => void;
  onTap?: () => void;
  onDoubleTap?: (zone: TapZone) => void;
  screenWidth?: number;
  screenHeight?: number;
}

/** Maximum delay between taps to count as a double-tap (ms) */
const DOUBLE_TAP_DELAY = 300;

export const useGestureDetection = ({
  minDistance = 50,
  maxDuration = 800,
  onSwipeLeft,
  onSwipeRight,
  onVerticalDragStart,
  onVerticalDragMove,
  onVerticalDragEnd,
  onTap,
  onDoubleTap,
  screenWidth = 400,
  screenHeight = 800,
}: SwipeGestureOptions = {}) => {
  const touchStartTime = useRef(0);
  const touchStartPosition = useRef({ x: 0, y: 0 });
  const lastTouchPosition = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragSide = useRef<"left" | "right" | null>(null);
  const hasMovedEnough = useRef(false);
  const gestureType = useRef<"none" | "horizontal" | "vertical">("none");
  const shouldIgnoreTouch = useRef(false);

  // Double-tap state
  const lastTapTime = useRef(0);
  const lastTapZone = useRef<TapZone | null>(null);
  const singleTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getTapZone = useCallback(
    (x: number): TapZone => {
      const third = screenWidth / 3;
      if (x < third) return "left";
      if (x > third * 2) return "right";
      return "center";
    },
    [screenWidth],
  );

  const handleTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      const startY = event.nativeEvent.pageY;

      // Define exclusion zones (15% from top and bottom)
      const topExclusionZone = screenHeight * 0.15;
      const bottomExclusionZone = screenHeight * 0.85;

      // Check if touch started in exclusion zones
      if (startY < topExclusionZone || startY > bottomExclusionZone) {
        shouldIgnoreTouch.current = true;
        return;
      }

      shouldIgnoreTouch.current = false;
      touchStartTime.current = Date.now();
      touchStartPosition.current = {
        x: event.nativeEvent.pageX,
        y: startY,
      };
      lastTouchPosition.current = {
        x: event.nativeEvent.pageX,
        y: startY,
      };
      isDragging.current = false;
      dragSide.current = null;
      hasMovedEnough.current = false;
      gestureType.current = "none";
    },
    [screenHeight],
  );

  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      // Ignore touch if it started in exclusion zone
      if (shouldIgnoreTouch.current) {
        return;
      }

      const currentPosition = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      };

      const deltaX = currentPosition.x - touchStartPosition.current.x;
      const deltaY = currentPosition.y - touchStartPosition.current.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Lower threshold for starting gestures - make it more sensitive
      if (!hasMovedEnough.current && totalDistance > 8) {
        hasMovedEnough.current = true;

        // Determine gesture type based on initial movement direction
        if (absY > absX && absY > 5) {
          // Vertical gesture - start drag immediately
          gestureType.current = "vertical";
          const side =
            touchStartPosition.current.x < screenWidth / 2 ? "left" : "right";
          isDragging.current = true;
          dragSide.current = side;
          onVerticalDragStart?.(side, touchStartPosition.current.y);
        } else if (absX > absY && absX > 10) {
          // Horizontal gesture - mark for discrete swipe
          gestureType.current = "horizontal";
        }
      }

      // Continue vertical drag if already dragging
      if (
        isDragging.current &&
        dragSide.current &&
        gestureType.current === "vertical"
      ) {
        const deltaFromStart = currentPosition.y - touchStartPosition.current.y;
        onVerticalDragMove?.(
          dragSide.current,
          deltaFromStart,
          currentPosition.y,
        );
      }

      lastTouchPosition.current = currentPosition;
    },
    [onVerticalDragStart, onVerticalDragMove, screenWidth],
  );

  const handleTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      // Ignore touch if it started in exclusion zone
      if (shouldIgnoreTouch.current) {
        shouldIgnoreTouch.current = false;
        return;
      }

      const touchEndTime = Date.now();
      const touchEndPosition = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      };

      const touchDuration = touchEndTime - touchStartTime.current;
      const deltaX = touchEndPosition.x - touchStartPosition.current.x;
      const deltaY = touchEndPosition.y - touchStartPosition.current.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // End vertical drag if we were dragging
      if (
        isDragging.current &&
        dragSide.current &&
        gestureType.current === "vertical"
      ) {
        onVerticalDragEnd?.(dragSide.current);
        isDragging.current = false;
        dragSide.current = null;
        hasMovedEnough.current = false;
        gestureType.current = "none";
        return;
      }

      // Check if gesture is too long for discrete actions
      if (touchDuration > maxDuration) {
        hasMovedEnough.current = false;
        gestureType.current = "none";
        return;
      }

      // Handle discrete horizontal swipes (for skip) only if it was marked as horizontal
      if (
        gestureType.current === "horizontal" &&
        hasMovedEnough.current &&
        absX > absY &&
        totalDistance > minDistance
      ) {
        if (deltaX > 0) {
          onSwipeRight?.();
        } else {
          onSwipeLeft?.();
        }
      } else if (
        !hasMovedEnough.current &&
        touchDuration < 300 &&
        totalDistance < 10
      ) {
        // It's a tap - check for double-tap on side zones
        const tapX = touchStartPosition.current.x;
        const zone = getTapZone(tapX);
        const now = Date.now();
        const timeSinceLastTap = now - lastTapTime.current;

        if (
          timeSinceLastTap < DOUBLE_TAP_DELAY &&
          lastTapZone.current === zone &&
          zone !== "center"
        ) {
          // Double-tap detected on a side zone
          if (singleTapTimeout.current) {
            clearTimeout(singleTapTimeout.current);
            singleTapTimeout.current = null;
          }
          lastTapTime.current = now;
          lastTapZone.current = zone;
          onDoubleTap?.(zone);
        } else {
          lastTapTime.current = now;
          lastTapZone.current = zone;

          if (zone === "center") {
            // Center zone: immediate single tap, no double-tap delay
            onTap?.();
          } else {
            // Side zones: delay single tap to wait for potential double-tap
            if (singleTapTimeout.current) {
              clearTimeout(singleTapTimeout.current);
            }
            singleTapTimeout.current = setTimeout(() => {
              singleTapTimeout.current = null;
              onTap?.();
            }, DOUBLE_TAP_DELAY);
          }
        }
      }

      hasMovedEnough.current = false;
      gestureType.current = "none";
    },
    [
      maxDuration,
      minDistance,
      onSwipeLeft,
      onSwipeRight,
      onVerticalDragEnd,
      onTap,
      onDoubleTap,
      getTapZone,
    ],
  );

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
};
