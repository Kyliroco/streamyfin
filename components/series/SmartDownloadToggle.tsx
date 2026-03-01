import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { FC } from "react";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { Button } from "@/components/Button";
import { Text } from "@/components/common/Text";
import { RoundButton } from "@/components/RoundButton";
import { useSmartDownloadSettings } from "@/utils/atoms/smartDownloads";

interface Props {
  seriesId: string;
}

const EPISODES_AHEAD_OPTIONS = [1, 2, 3, 5, 10];

export const SmartDownloadToggle: FC<Props> = ({ seriesId }) => {
  const { isEnabled, getSeriesSettings, toggleSeries, setEpisodesAhead } =
    useSmartDownloadSettings();

  const enabled = isEnabled(seriesId);
  const currentSettings = getSeriesSettings(seriesId);
  const [selectedCount, setSelectedCount] = useState(
    currentSettings?.episodesAhead ?? 3,
  );

  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const handleButtonPress = useCallback(() => {
    if (enabled) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.present();
    }
  }, [enabled]);

  const handleToggle = useCallback(() => {
    toggleSeries(seriesId, selectedCount);
    bottomSheetRef.current?.dismiss();
  }, [seriesId, selectedCount, toggleSeries]);

  const handleSave = useCallback(() => {
    if (!enabled) {
      toggleSeries(seriesId, selectedCount);
    } else {
      setEpisodesAhead(seriesId, selectedCount);
    }
    bottomSheetRef.current?.dismiss();
  }, [enabled, seriesId, selectedCount, toggleSeries, setEpisodesAhead]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
      />
    ),
    [],
  );

  return (
    <View>
      <RoundButton size="large" onPress={handleButtonPress}>
        <Ionicons
          name={enabled ? "flash" : "flash-outline"}
          size={22}
          color={enabled ? "#9334E9" : "white"}
        />
      </RoundButton>
      <BottomSheetModal
        ref={bottomSheetRef}
        enableDynamicSizing
        handleIndicatorStyle={{ backgroundColor: "white" }}
        backgroundStyle={{ backgroundColor: "#171717" }}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        enableDismissOnClose
      >
        <BottomSheetView>
          <View className="flex flex-col space-y-4 px-4 pb-8 pt-2">
            <View>
              <Text className="font-bold text-2xl text-neutral-100">
                Smart Downloads
              </Text>
              <Text className="text-neutral-400 text-sm mt-1">
                {enabled
                  ? "Smart downloads are enabled for this series. Episodes will be automatically downloaded ahead and watched episodes cleaned up."
                  : "Enable smart downloads to automatically download upcoming episodes and clean up watched ones."}
              </Text>
            </View>

            <View>
              <Text className="text-neutral-300 mb-2">Episodes ahead</Text>
              <View className="flex flex-row flex-wrap gap-2">
                {EPISODES_AHEAD_OPTIONS.map((count) => (
                  <Pressable
                    key={count}
                    onPress={() => setSelectedCount(count)}
                    className={`px-4 py-2 rounded-full ${
                      selectedCount === count
                        ? "bg-purple-600"
                        : "bg-neutral-800"
                    }`}
                  >
                    <Text
                      className={
                        selectedCount === count
                          ? "text-white font-bold"
                          : "text-neutral-300"
                      }
                    >
                      {count}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View className="flex flex-col space-y-2">
              <Button onPress={handleSave} color="purple">
                {enabled ? "Update" : "Enable"}
              </Button>
              {enabled && (
                <Button onPress={handleToggle} color="black">
                  Disable
                </Button>
              )}
            </View>
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
};
