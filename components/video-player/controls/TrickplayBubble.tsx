import type { FC } from "react";
import { Image, View } from "react-native";
import { Text } from "@/components/common/Text";
import { CONTROLS_CONSTANTS } from "./constants";

interface TrickplayBubbleProps {
  trickPlayUrl: {
    x: number;
    y: number;
    url: string;
  } | null;
  trickplayInfo: {
    aspectRatio?: number;
    data: {
      TileWidth?: number;
      TileHeight?: number;
    };
  } | null;
  time: {
    hours: number;
    minutes: number;
    seconds: number;
  };
}

/**
 * IMPORTANT: This component always renders the SAME tree structure (View > View > Image + Text)
 * regardless of whether trickplay data is available. This prevents React from removing/inserting
 * child views, which would cause RetryableMountingLayerException when the slider library's
 * Reanimated animations have pending layout updates targeting removed view tags.
 */
export const TrickplayBubble: FC<TrickplayBubbleProps> = ({
  trickPlayUrl,
  trickplayInfo,
  time,
}) => {
  const isVisible = !!(trickPlayUrl && trickplayInfo);

  const tileWidth = CONTROLS_CONSTANTS.TILE_WIDTH;
  const aspectRatio = trickplayInfo?.aspectRatio ?? 1;
  const tileHeight = tileWidth / aspectRatio;

  const x = trickPlayUrl?.x ?? 0;
  const y = trickPlayUrl?.y ?? 0;
  const url = trickPlayUrl?.url;

  return (
    <View
      style={{
        position: "absolute",
        left: -62,
        bottom: 0,
        paddingTop: 30,
        paddingBottom: 5,
        width: tileWidth * 1.5,
        justifyContent: "center",
        alignItems: "center",
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? "auto" : "none",
      }}
    >
      <View
        style={{
          width: tileWidth,
          height: tileHeight,
          alignSelf: "center",
          transform: [{ scale: 1.4 }],
          borderRadius: 5,
          overflow: "hidden",
        }}
        className='bg-neutral-800'
      >
        <Image
          style={{
            width: tileWidth * (trickplayInfo?.data.TileWidth ?? 1),
            height:
              (tileWidth / aspectRatio) *
              (trickplayInfo?.data.TileHeight ?? 1),
            transform: [
              { translateX: -x * tileWidth },
              { translateY: -y * tileHeight },
            ],
          }}
          source={url ? { uri: url } : undefined}
          resizeMode='cover'
        />
      </View>
      <Text
        style={{
          marginTop: 30,
          fontSize: 16,
        }}
      >
        {`${time.hours > 0 ? `${time.hours}:` : ""}${
          time.minutes < 10 ? `0${time.minutes}` : time.minutes
        }:${time.seconds < 10 ? `0${time.seconds}` : time.seconds}`}
      </Text>
    </View>
  );
};
