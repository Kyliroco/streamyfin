import { atom, useAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { storage } from "../mmkv";

const SMART_DOWNLOADS_KEY = "smart_downloads_settings";

export interface SmartDownloadSeriesSettings {
  enabled: boolean;
  episodesAhead: number;
}

export type SmartDownloadMap = Record<string, SmartDownloadSeriesSettings>;

const loadSmartDownloadSettings = (): SmartDownloadMap => {
  try {
    const jsonValue = storage.getString(SMART_DOWNLOADS_KEY);
    return jsonValue ? JSON.parse(jsonValue) : {};
  } catch (error) {
    console.error("Failed to load smart download settings:", error);
    return {};
  }
};

const saveSmartDownloadSettings = (settings: SmartDownloadMap) => {
  try {
    storage.set(SMART_DOWNLOADS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save smart download settings:", error);
  }
};

export const smartDownloadSettingsAtom = atom<SmartDownloadMap>(
  loadSmartDownloadSettings(),
);

export const useSmartDownloadSettings = () => {
  const [settings, setSettings] = useAtom(smartDownloadSettingsAtom);

  const getSeriesSettings = useCallback(
    (seriesId: string): SmartDownloadSeriesSettings | undefined => {
      return settings[seriesId];
    },
    [settings],
  );

  const isEnabled = useCallback(
    (seriesId: string): boolean => {
      return settings[seriesId]?.enabled === true;
    },
    [settings],
  );

  const setSeriesSettings = useCallback(
    (seriesId: string, seriesSettings: SmartDownloadSeriesSettings) => {
      const newSettings = { ...settings, [seriesId]: seriesSettings };
      setSettings(newSettings);
      saveSmartDownloadSettings(newSettings);
    },
    [settings, setSettings],
  );

  const toggleSeries = useCallback(
    (seriesId: string, episodesAhead = 3) => {
      const current = settings[seriesId];
      if (current?.enabled) {
        const newSettings = { ...settings };
        delete newSettings[seriesId];
        setSettings(newSettings);
        saveSmartDownloadSettings(newSettings);
      } else {
        setSeriesSettings(seriesId, { enabled: true, episodesAhead });
      }
    },
    [settings, setSettings, setSeriesSettings],
  );

  const setEpisodesAhead = useCallback(
    (seriesId: string, episodesAhead: number) => {
      const current = settings[seriesId];
      if (current) {
        setSeriesSettings(seriesId, { ...current, episodesAhead });
      }
    },
    [settings, setSeriesSettings],
  );

  const enabledSeriesIds = useMemo(
    () =>
      Object.entries(settings)
        .filter(([, s]) => s.enabled)
        .map(([id]) => id),
    [settings],
  );

  return {
    settings,
    getSeriesSettings,
    isEnabled,
    setSeriesSettings,
    toggleSeries,
    setEpisodesAhead,
    enabledSeriesIds,
  };
};
