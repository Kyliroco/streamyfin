import type { Api } from "@jellyfin/sdk";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client";
import { getTvShowsApi } from "@jellyfin/sdk/lib/utils/api";
import { useCallback, useRef } from "react";
import { useDownload } from "@/providers/DownloadProvider";
import { getAllDownloadedItems } from "@/providers/Downloads/database";
import { apiAtom, userAtom } from "@/providers/JellyfinProvider";
import { useSmartDownloadSettings } from "@/utils/atoms/smartDownloads";
import { useSettings } from "@/utils/atoms/settings";
import { getDefaultPlaySettings } from "@/utils/jellyfin/getDefaultPlaySettings";
import { getDownloadUrl } from "@/utils/jellyfin/media/getDownloadUrl";
import { useAtomValue } from "jotai";

/**
 * Fetches all episodes for a series, sorted by season and episode number.
 * This includes episodes across all seasons.
 */
const fetchAllSeriesEpisodes = async (
  api: Api,
  userId: string,
  seriesId: string,
): Promise<BaseItemDto[]> => {
  const res = await getTvShowsApi(api).getEpisodes({
    seriesId,
    userId,
    enableUserData: true,
    fields: ["MediaSources", "MediaStreams"],
  });

  const episodes = res.data.Items || [];
  return episodes.sort(
    (a, b) =>
      (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) ||
      (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0),
  );
};

/**
 * Finds the index of the current episode in the sorted episode list.
 * Uses the episode ID for exact matching.
 */
const findCurrentEpisodeIndex = (
  episodes: BaseItemDto[],
  currentEpisodeId: string,
): number => {
  return episodes.findIndex((ep) => ep.Id === currentEpisodeId);
};

/**
 * Gets the next N unwatched episodes starting from the episode after the current one,
 * spanning across seasons.
 */
const getNextEpisodesToDownload = (
  allEpisodes: BaseItemDto[],
  currentIndex: number,
  count: number,
): BaseItemDto[] => {
  const nextEpisodes: BaseItemDto[] = [];
  for (let i = currentIndex + 1; i < allEpisodes.length && nextEpisodes.length < count; i++) {
    nextEpisodes.push(allEpisodes[i]);
  }
  return nextEpisodes;
};

/**
 * Gets watched episodes that can be cleaned up.
 * An episode is eligible for cleanup if:
 * 1. It has been watched (Played = true or PlayedPercentage > 90)
 * 2. There are at least 3 downloaded episodes ahead of it that are NOT watched
 */
const getEpisodesEligibleForCleanup = (
  allEpisodes: BaseItemDto[],
  downloadedEpisodeIds: Set<string>,
): string[] => {
  const MIN_EPISODES_AHEAD = 3;
  const idsToDelete: string[] = [];

  // Get all downloaded episodes in order
  const downloadedInOrder = allEpisodes.filter(
    (ep) => ep.Id && downloadedEpisodeIds.has(ep.Id),
  );

  for (let i = 0; i < downloadedInOrder.length; i++) {
    const episode = downloadedInOrder[i];
    if (!episode.Id) continue;

    const isWatched =
      episode.UserData?.Played === true ||
      (episode.UserData?.PlayedPercentage ?? 0) > 90;

    if (!isWatched) continue;

    // Count how many downloaded episodes are ahead of this one (in the full series order)
    const episodeFullIndex = allEpisodes.findIndex(
      (ep) => ep.Id === episode.Id,
    );
    let downloadedAhead = 0;

    for (let j = episodeFullIndex + 1; j < allEpisodes.length; j++) {
      const futureEp = allEpisodes[j];
      if (futureEp.Id && downloadedEpisodeIds.has(futureEp.Id)) {
        downloadedAhead++;
      }
    }

    if (downloadedAhead >= MIN_EPISODES_AHEAD) {
      idsToDelete.push(episode.Id);
    }
  }

  return idsToDelete;
};

/**
 * Hook for managing smart downloads.
 * Call `processSmartDownloads` after an episode is marked as played.
 */
export const useSmartDownloads = () => {
  const api = useAtomValue(apiAtom);
  const user = useAtomValue(userAtom);
  const { settings: appSettings } = useSettings();
  const { settings: smartSettings, isEnabled } = useSmartDownloadSettings();
  const { startBackgroundDownload, deleteFile, downloadedItems, processes } =
    useDownload();

  // Prevent concurrent processing
  const processingRef = useRef<Set<string>>(new Set());

  /**
   * Process smart downloads for a specific episode that was just watched.
   * This will:
   * 1. Check if smart downloads are enabled for this series
   * 2. Determine which episodes to download next (including cross-season)
   * 3. Auto-delete watched episodes if enough episodes are buffered ahead
   * 4. Trigger downloads for missing episodes
   */
  const processSmartDownloads = useCallback(
    async (watchedEpisode: BaseItemDto) => {
      const seriesId = watchedEpisode.SeriesId;
      const episodeId = watchedEpisode.Id;

      if (!seriesId || !episodeId || !api || !user?.Id) {
        return;
      }

      if (!isEnabled(seriesId)) {
        return;
      }

      // Prevent concurrent processing for the same series
      if (processingRef.current.has(seriesId)) {
        return;
      }
      processingRef.current.add(seriesId);

      try {
        const seriesSettings = smartSettings[seriesId];
        if (!seriesSettings) return;

        const { episodesAhead } = seriesSettings;

        // 1. Fetch all episodes in the series (across all seasons)
        const allEpisodes = await fetchAllSeriesEpisodes(
          api,
          user.Id,
          seriesId,
        );

        if (allEpisodes.length === 0) return;

        // 2. Find where we are in the series
        const currentIndex = findCurrentEpisodeIndex(allEpisodes, episodeId);
        if (currentIndex === -1) return;

        // 3. Determine which episodes should be downloaded ahead
        const episodesToDownload = getNextEpisodesToDownload(
          allEpisodes,
          currentIndex,
          episodesAhead,
        );

        // 4. Get currently downloaded episode IDs
        const currentDownloads = getAllDownloadedItems();
        const downloadedIds = new Set(
          currentDownloads
            .filter((d) => d.item.SeriesId === seriesId)
            .map((d) => d.item.Id)
            .filter((id): id is string => !!id),
        );

        // Also track episodes currently being downloaded
        const downloadingIds = new Set(
          processes
            .filter(
              (p) =>
                p.item.SeriesId === seriesId &&
                (p.status === "downloading" ||
                  p.status === "pending" ||
                  p.status === "queued"),
            )
            .map((p) => p.itemId),
        );

        // 5. Download episodes that are not already downloaded or in progress
        for (const episode of episodesToDownload) {
          if (!episode.Id) continue;
          if (downloadedIds.has(episode.Id)) continue;
          if (downloadingIds.has(episode.Id)) continue;

          try {
            const playSettings = getDefaultPlaySettings(
              episode,
              appSettings,
            );

            if (!playSettings.mediaSource?.Id) continue;

            const downloadDetails = await getDownloadUrl({
              api,
              item: episode,
              userId: user.Id,
              mediaSource: playSettings.mediaSource,
              maxBitrate:
                playSettings.bitrate,
              audioStreamIndex: playSettings.audioIndex ?? -1,
              subtitleStreamIndex: playSettings.subtitleIndex ?? -1,
              deviceId: api.deviceInfo.id,
              audioMode: appSettings?.audioTranscodeMode,
            });

            if (!downloadDetails?.url || !downloadDetails.mediaSource) continue;

            await startBackgroundDownload(
              downloadDetails.url,
              episode,
              downloadDetails.mediaSource,
              playSettings.bitrate,
              playSettings.audioIndex,
              playSettings.subtitleIndex,
            );

            console.log(
              `[SMART_DOWNLOAD] Queued download: S${episode.ParentIndexNumber}E${episode.IndexNumber} - ${episode.Name}`,
            );
          } catch (error) {
            console.error(
              `[SMART_DOWNLOAD] Failed to download S${episode.ParentIndexNumber}E${episode.IndexNumber}:`,
              error,
            );
          }
        }

        // 6. Clean up watched episodes (only if 3+ episodes downloaded ahead)
        // Re-fetch downloaded items since we may have just added some
        const updatedDownloads = getAllDownloadedItems();
        const updatedDownloadedIds = new Set(
          updatedDownloads
            .filter((d) => d.item.SeriesId === seriesId)
            .map((d) => d.item.Id)
            .filter((id): id is string => !!id),
        );

        const idsToDelete = getEpisodesEligibleForCleanup(
          allEpisodes,
          updatedDownloadedIds,
        );

        for (const id of idsToDelete) {
          try {
            await deleteFile(id);
            console.log(
              `[SMART_DOWNLOAD] Cleaned up watched episode: ${id}`,
            );
          } catch (error) {
            console.error(
              `[SMART_DOWNLOAD] Failed to delete episode ${id}:`,
              error,
            );
          }
        }
      } catch (error) {
        console.error("[SMART_DOWNLOAD] Error processing smart downloads:", error);
      } finally {
        processingRef.current.delete(seriesId);
      }
    },
    [
      api,
      user?.Id,
      smartSettings,
      isEnabled,
      appSettings,
      startBackgroundDownload,
      deleteFile,
      processes,
    ],
  );

  return {
    processSmartDownloads,
  };
};
