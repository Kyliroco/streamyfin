import type { Api } from "@jellyfin/sdk";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client";
import { getTvShowsApi } from "@jellyfin/sdk/lib/utils/api";
import { useAtomValue } from "jotai";
import { useCallback, useRef } from "react";
import { useDownload } from "@/providers/DownloadProvider";
import { getAllDownloadedItems } from "@/providers/Downloads/database";
import { calculateTotalDownloadedSize } from "@/providers/Downloads/fileOperations";
import { apiAtom, userAtom } from "@/providers/JellyfinProvider";
import { useSettings } from "@/utils/atoms/settings";
import { useSmartDownloadSettings } from "@/utils/atoms/smartDownloads";
import { getDefaultPlaySettings } from "@/utils/jellyfin/getDefaultPlaySettings";
import { getDownloadUrl } from "@/utils/jellyfin/media/getDownloadUrl";

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
 * Gets the next N episodes starting from the episode after the current one,
 * spanning across seasons.
 */
const getNextEpisodesToDownload = (
  allEpisodes: BaseItemDto[],
  currentIndex: number,
  count: number,
): BaseItemDto[] => {
  const nextEpisodes: BaseItemDto[] = [];
  for (
    let i = currentIndex + 1;
    i < allEpisodes.length && nextEpisodes.length < count;
    i++
  ) {
    nextEpisodes.push(allEpisodes[i]);
  }
  return nextEpisodes;
};

/**
 * Gets watched episodes eligible for cleanup.
 * An episode is eligible for deletion when:
 * - It has been watched (Played = true or PlayedPercentage > 90)
 * - The user has WATCHED at least `watchedBeforeDelete` episodes AFTER it
 *   (in series order, regardless of whether those later episodes are downloaded)
 *
 * Example with watchedBeforeDelete=3:
 *   E1(watched, downloaded) E2(watched) E3(watched) E4(watched) E5(not watched)
 *   → E1 can be deleted because 3 episodes after it (E2, E3, E4) have been watched
 */
const getEpisodesEligibleForCleanup = (
  allEpisodes: BaseItemDto[],
  downloadedEpisodeIds: Set<string>,
  watchedBeforeDelete: number,
): string[] => {
  const idsToDelete: string[] = [];

  // Only consider downloaded episodes
  const downloadedInOrder = allEpisodes.filter(
    (ep) => ep.Id && downloadedEpisodeIds.has(ep.Id),
  );

  for (const episode of downloadedInOrder) {
    if (!episode.Id) continue;

    const isWatched =
      episode.UserData?.Played === true ||
      (episode.UserData?.PlayedPercentage ?? 0) > 90;

    if (!isWatched) continue;

    // Count how many episodes AFTER this one have been watched (in the full series order)
    const episodeFullIndex = allEpisodes.findIndex(
      (ep) => ep.Id === episode.Id,
    );
    let watchedAfter = 0;

    for (let j = episodeFullIndex + 1; j < allEpisodes.length; j++) {
      const futureEp = allEpisodes[j];
      const futureWatched =
        futureEp.UserData?.Played === true ||
        (futureEp.UserData?.PlayedPercentage ?? 0) > 90;

      if (futureWatched) {
        watchedAfter++;
      }
    }

    if (watchedAfter >= watchedBeforeDelete) {
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
  const { startBackgroundDownload, deleteFile, processes } = useDownload();

  // Prevent concurrent processing
  const processingRef = useRef<Set<string>>(new Set());

  /**
   * Process smart downloads for a specific episode that was just watched.
   * This will:
   * 1. Check if smart downloads are enabled globally and for this series
   * 2. Determine which episodes to download next (including cross-season)
   * 3. Respect the max download size limit
   * 4. Auto-delete watched episodes once N episodes after them have been watched
   * 5. Trigger downloads for missing episodes
   */
  const processSmartDownloads = useCallback(
    async (watchedEpisode: BaseItemDto) => {
      const seriesId = watchedEpisode.SeriesId;
      const episodeId = watchedEpisode.Id;

      if (!seriesId || !episodeId || !api || !user?.Id) {
        return;
      }

      // Check global toggle
      if (!appSettings.smartDownloadEnabled) {
        return;
      }

      // Check per-series toggle
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
        const watchedBeforeDelete =
          appSettings.smartDownloadWatchedEpisodesBeforeDelete;
        const maxSizeBytes = appSettings.smartDownloadMaxSizeGB * 1024 * 1024 * 1024;

        // 1. Fetch all episodes in the series (across all seasons)
        const allEpisodes = await fetchAllSeriesEpisodes(
          api,
          user.Id,
          seriesId,
        );

        if (allEpisodes.length === 0) return;

        // 2. Find where we are in the series
        const currentIndex = allEpisodes.findIndex(
          (ep) => ep.Id === episodeId,
        );
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

        // 5. Check total download size before downloading new episodes
        const currentTotalSize = calculateTotalDownloadedSize();

        // 6. Download episodes that are not already downloaded or in progress
        let accumulatedSize = currentTotalSize;
        for (const episode of episodesToDownload) {
          if (!episode.Id) continue;
          if (downloadedIds.has(episode.Id)) continue;
          if (downloadingIds.has(episode.Id)) continue;

          // Check if we'd exceed the max size limit
          if (accumulatedSize >= maxSizeBytes) {
            console.log(
              `[SMART_DOWNLOAD] Skipping download: max size limit reached (${appSettings.smartDownloadMaxSizeGB} GB)`,
            );
            break;
          }

          try {
            const playSettings = getDefaultPlaySettings(episode, appSettings);

            if (!playSettings.mediaSource?.Id) continue;

            const downloadDetails = await getDownloadUrl({
              api,
              item: episode,
              userId: user.Id,
              mediaSource: playSettings.mediaSource,
              maxBitrate: playSettings.bitrate,
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

            // Estimate size from media source for tracking
            const estimatedSize = episode.MediaSources?.[0]?.Size ?? 0;
            accumulatedSize += estimatedSize;

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

        // 7. Clean up watched episodes where N episodes after them have been watched
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
          watchedBeforeDelete,
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
        console.error(
          "[SMART_DOWNLOAD] Error processing smart downloads:",
          error,
        );
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
