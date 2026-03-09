import { File, Paths } from "expo-file-system";
import { useNavigation } from "expo-router";
import type * as SharingType from "expo-sharing";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, ScrollView, TouchableOpacity, View } from "react-native";
import Collapsible from "react-native-collapsible";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import { FilterButton } from "@/components/filters/FilterButton";
import { Loader } from "@/components/Loader";
import {
  clearFileLogs,
  exportAllLogs,
  readAllFileLogs,
} from "@/utils/fileLogger";
import { LogLevel, useLog, writeErrorLog } from "@/utils/log";

// Conditionally import expo-sharing only on non-TV platforms
const Sharing = Platform.isTV
  ? null
  : (require("expo-sharing") as typeof SharingType);

type LogTab = "app" | "file";

export default function Page() {
  const navigation = useNavigation();
  const { logs } = useLog();
  const { t } = useTranslation();

  const orderFilterId = useId();
  const levelsFilterId = useId();

  const defaultLevels: LogLevel[] = ["INFO", "ERROR", "DEBUG", "WARN"];
  const codeBlockStyle = {
    backgroundColor: "#000",
    padding: 10,
    fontFamily: "monospace",
    maxHeight: 300,
  };

  const [loading, setLoading] = useState<boolean>(false);
  const [state, setState] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [levels, setLevels] = useState<LogLevel[]>(defaultLevels);
  const [activeTab, setActiveTab] = useState<LogTab>("app");
  const [fileLogs, setFileLogs] = useState<string>("");

  const _orderId = useId();
  const _levelsId = useId();
  const insets = useSafeAreaInsets();

  // Load file logs when switching to file tab
  useEffect(() => {
    if (activeTab === "file") {
      setFileLogs(readAllFileLogs());
    }
  }, [activeTab]);

  const filteredLogs = useMemo(
    () =>
      logs
        ?.filter((log) => levels.includes(log.level))
        ?.[
          // Already in asc order as they are recorded. just reverse for desc
          order === "desc" ? "reverse" : "concat"
        ]?.(),
    [logs, order, levels],
  );

  const shareAppLogs = useCallback(async () => {
    if (!Sharing) return;

    const logsFile = new File(Paths.document, "logs.txt");

    setLoading(true);
    try {
      logsFile.write(JSON.stringify(filteredLogs));
      await Sharing.shareAsync(logsFile.uri, {
        mimeType: "text/plain",
        UTI: "public.plain-text",
      });
    } catch (e: any) {
      writeErrorLog("Something went wrong attempting to export", e);
    } finally {
      setLoading(false);
    }
  }, [filteredLogs, Sharing]);

  const shareFileLogs = useCallback(async () => {
    if (!Sharing) return;

    setLoading(true);
    try {
      const uri = exportAllLogs();
      if (uri) {
        await Sharing.shareAsync(uri, {
          mimeType: "text/plain",
          UTI: "public.plain-text",
        });
      }
    } catch (e: any) {
      writeErrorLog("Something went wrong attempting to export file logs", e);
    } finally {
      setLoading(false);
    }
  }, [Sharing]);

  const handleClearFileLogs = useCallback(() => {
    clearFileLogs();
    setFileLogs("");
  }, []);

  useEffect(() => {
    if (Platform.isTV) return;

    navigation.setOptions({
      headerRight: () =>
        loading ? (
          <Loader />
        ) : (
          <View className='flex flex-row items-center space-x-3 px-2'>
            {activeTab === "file" && (
              <TouchableOpacity onPress={handleClearFileLogs}>
                <Text className='text-red-500'>Clear</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={activeTab === "app" ? shareAppLogs : shareFileLogs}
            >
              <Text>{t("home.settings.logs.export_logs")}</Text>
            </TouchableOpacity>
          </View>
        ),
    });
  }, [shareAppLogs, shareFileLogs, loading, activeTab, handleClearFileLogs]);

  return (
    <View
      className='flex-1'
      style={{
        paddingTop: insets.top + 48,
      }}
    >
      {/* Tab selector */}
      <View className='flex flex-row px-4 py-2 space-x-2'>
        <TouchableOpacity
          onPress={() => setActiveTab("app")}
          className={`px-4 py-2 rounded-full ${
            activeTab === "app" ? "bg-purple-600" : "bg-neutral-800"
          }`}
        >
          <Text
            className={
              activeTab === "app" ? "text-white font-bold" : "text-neutral-400"
            }
          >
            App Logs
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab("file")}
          className={`px-4 py-2 rounded-full ${
            activeTab === "file" ? "bg-purple-600" : "bg-neutral-800"
          }`}
        >
          <Text
            className={
              activeTab === "file" ? "text-white font-bold" : "text-neutral-400"
            }
          >
            File Logs
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            if (activeTab === "file") {
              setFileLogs(readAllFileLogs());
            }
          }}
          className='px-3 py-2 rounded-full bg-neutral-800'
        >
          <Text className='text-neutral-400'>↻</Text>
        </TouchableOpacity>
      </View>

      {activeTab === "app" ? (
        <>
          <View className='flex flex-row justify-end py-2 px-4 space-x-2'>
            <FilterButton
              id={orderFilterId}
              queryKey='log'
              queryFn={async () => ["asc", "desc"]}
              set={(values) => setOrder(values[0])}
              values={[order]}
              title={t("library.filters.sort_order")}
              renderItemLabel={(order) => t(`library.filters.${order}`)}
              disableSearch={true}
            />
            <FilterButton
              id={levelsFilterId}
              queryKey='log'
              queryFn={async () => defaultLevels}
              set={setLevels}
              values={levels}
              title={t("home.settings.logs.level")}
              renderItemLabel={(level) => level}
              disableSearch={true}
              multiple={true}
            />
          </View>
          <ScrollView className='pb-4 px-4'>
            <View className='flex flex-col space-y-2'>
              {filteredLogs?.map((log, index) => (
                <View className='bg-neutral-900 rounded-xl p-3' key={index}>
                  <TouchableOpacity
                    disabled={!log.data}
                    onPress={() =>
                      setState((v) => ({
                        ...v,
                        [log.timestamp]: !v[log.timestamp],
                      }))
                    }
                  >
                    <View className='flex flex-row justify-between'>
                      <Text
                        className={`mb-1
                        ${log.level === "INFO" && "text-blue-500"}
                        ${log.level === "ERROR" && "text-red-500"}
                        ${log.level === "DEBUG" && "text-purple-500"}
                      `}
                      >
                        {log.level}
                      </Text>

                      <Text className='text-xs'>
                        {new Date(log.timestamp).toLocaleString()}
                      </Text>
                    </View>
                    <Text selectable className='text-xs'>
                      {log.message}
                    </Text>
                  </TouchableOpacity>

                  {log.data && (
                    <>
                      {!state[log.timestamp] && (
                        <Text className='text-xs mt-0.5'>
                          {t("home.settings.logs.click_for_more_info")}
                        </Text>
                      )}
                      <Collapsible collapsed={!state[log.timestamp]}>
                        <View className='mt-2 flex flex-col space-y-2'>
                          <ScrollView
                            className='rounded-xl'
                            style={codeBlockStyle}
                          >
                            <Text>{JSON.stringify(log.data, null, 2)}</Text>
                          </ScrollView>
                        </View>
                      </Collapsible>
                    </>
                  )}
                </View>
              ))}
              {filteredLogs?.length === 0 && (
                <Text className='opacity-50'>
                  {t("home.settings.logs.no_logs_available")}
                </Text>
              )}
            </View>
          </ScrollView>
        </>
      ) : (
        <ScrollView className='pb-4 px-4'>
          <View className='bg-neutral-900 rounded-xl p-3'>
            {fileLogs ? (
              <Text
                selectable
                style={{ fontFamily: "monospace", fontSize: 11, color: "#ccc" }}
              >
                {fileLogs}
              </Text>
            ) : (
              <Text className='opacity-50'>No file logs available</Text>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
