import { File, Paths } from "expo-file-system";
import type { LogLevel } from "./log";

const LOG_DIR_NAME = "streamyfin-logs";
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_LOG_FILES = 3;

let logFile: File | null = null;
let originalConsole: {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
  info: typeof console.info;
} | null = null;
let isInitialized = false;

function getLogDirectory(): string {
  return `${Paths.document}/${LOG_DIR_NAME}`;
}

function getLogFileName(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  return `streamyfin-${date}.log`;
}

function ensureLogDirectory(): void {
  try {
    const dir = new File(getLogDirectory());
    if (!dir.exists) {
      const directory = new (require("expo-file-system").Directory)(
        Paths.document,
        LOG_DIR_NAME,
      );
      if (!directory.exists) {
        directory.create();
      }
    }
  } catch (_e) {
    // Directory may already exist
  }
}

function getOrCreateLogFile(): File | null {
  try {
    ensureLogDirectory();
    const filePath = `${getLogDirectory()}/${getLogFileName()}`;
    const file = new File(filePath);

    // Rotate if too large
    if (file.exists && file.size > MAX_LOG_SIZE_BYTES) {
      rotateLogFiles();
    }

    return file;
  } catch (e) {
    originalConsole?.error("[FileLogger] Failed to create log file:", e);
    return null;
  }
}

function rotateLogFiles(): void {
  try {
    const { Directory } = require("expo-file-system");
    const dir = new Directory(Paths.document, LOG_DIR_NAME);
    if (!dir.exists) return;

    const files = dir.list();
    const logFiles = files
      .filter(
        (f: string) => typeof f === "string" && f.endsWith(".log"),
      )
      .sort()
      .reverse();

    // Delete oldest files beyond MAX_LOG_FILES
    for (let i = MAX_LOG_FILES - 1; i < logFiles.length; i++) {
      try {
        const oldFile = new File(getLogDirectory(), logFiles[i]);
        if (oldFile.exists) {
          oldFile.delete();
        }
      } catch (_e) {
        // Ignore deletion errors
      }
    }

    // Force new file for current session
    logFile = null;
  } catch (e) {
    originalConsole?.error("[FileLogger] Failed to rotate logs:", e);
  }
}

function formatLogEntry(
  level: string,
  message: string,
  args: unknown[],
): string {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${level}] ${message}`;

  if (args.length > 0) {
    for (const arg of args) {
      if (arg === undefined) continue;
      try {
        if (arg instanceof Error) {
          line += ` | ${arg.name}: ${arg.message}`;
          if (arg.stack) {
            line += `\n  Stack: ${arg.stack}`;
          }
        } else if (typeof arg === "object") {
          line += ` | ${JSON.stringify(arg, null, 0)}`;
        } else {
          line += ` | ${String(arg)}`;
        }
      } catch (_e) {
        line += " | [unserializable]";
      }
    }
  }

  return `${line}\n`;
}

function writeToFile(entry: string): void {
  try {
    if (!logFile) {
      logFile = getOrCreateLogFile();
    }
    if (!logFile) return;

    // Append to existing content
    if (logFile.exists) {
      const existing = logFile.text();
      logFile.write(existing + entry);
    } else {
      logFile.write(entry);
    }
  } catch (e) {
    // Silently fail - we don't want logging to crash the app
    originalConsole?.error("[FileLogger] Write failed:", e);
  }
}

/**
 * Write a structured log entry to the persistent log file.
 * Use this for important app events (not for intercepted console output).
 */
export function writeFileLog(
  level: LogLevel,
  message: string,
  data?: unknown,
): void {
  const args = data !== undefined ? [data] : [];
  writeToFile(formatLogEntry(level, message, args));
}

/**
 * Initialize the persistent file logger.
 * - Intercepts console.log/warn/error/info to write to file
 * - Sets up global error handlers for uncaught exceptions
 * - Should be called ONCE at app startup (before any other code runs)
 */
export function initFileLogger(): void {
  if (isInitialized) return;
  isInitialized = true;

  // Save original console methods
  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  // Intercept console methods
  console.log = (...args: unknown[]) => {
    originalConsole?.log(...args);
    writeToFile(formatLogEntry("LOG", String(args[0] ?? ""), args.slice(1)));
  };

  console.info = (...args: unknown[]) => {
    originalConsole?.info(...args);
    writeToFile(formatLogEntry("INFO", String(args[0] ?? ""), args.slice(1)));
  };

  console.warn = (...args: unknown[]) => {
    originalConsole?.warn(...args);
    writeToFile(formatLogEntry("WARN", String(args[0] ?? ""), args.slice(1)));
  };

  console.error = (...args: unknown[]) => {
    originalConsole?.error(...args);
    writeToFile(formatLogEntry("ERROR", String(args[0] ?? ""), args.slice(1)));
  };

  // Capture unhandled JS exceptions
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    const prefix = isFatal ? "FATAL CRASH" : "UNCAUGHT EXCEPTION";
    writeToFile(
      formatLogEntry("CRASH", `${prefix}: ${error.message}`, [error]),
    );
    // Call original handler
    originalHandler?.(error, isFatal);
  });

  // Capture unhandled promise rejections
  const originalRejectionTracking = (globalThis as any)
    .__unhandledRejectionTracking;
  if (typeof (globalThis as any).addEventListener === "function") {
    (globalThis as any).addEventListener(
      "unhandledrejection",
      (event: any) => {
        writeToFile(
          formatLogEntry("CRASH", "Unhandled Promise Rejection", [
            event?.reason,
          ]),
        );
      },
    );
  }

  // Write startup marker
  writeToFile(
    formatLogEntry("INFO", "=== App session started ===", []),
  );
}

/**
 * Read the content of all log files, newest first.
 */
export function readAllFileLogs(): string {
  try {
    const { Directory } = require("expo-file-system");
    const dir = new Directory(Paths.document, LOG_DIR_NAME);
    if (!dir.exists) return "";

    const files = dir.list();
    const logFiles = files
      .filter(
        (f: string) => typeof f === "string" && f.endsWith(".log"),
      )
      .sort()
      .reverse();

    let combined = "";
    for (const fileName of logFiles) {
      try {
        const file = new File(getLogDirectory(), fileName);
        if (file.exists) {
          combined += `\n--- ${fileName} ---\n`;
          combined += file.text();
        }
      } catch (_e) {
        // Skip unreadable files
      }
    }

    return combined;
  } catch (_e) {
    return "[Failed to read log files]";
  }
}

/**
 * Get the URI of the current log file for sharing.
 */
export function getCurrentLogFileUri(): string | null {
  try {
    const file = getOrCreateLogFile();
    return file?.uri ?? null;
  } catch (_e) {
    return null;
  }
}

/**
 * Export all logs to a single file and return its URI for sharing.
 */
export function exportAllLogs(): string | null {
  try {
    const content = readAllFileLogs();
    const exportFile = new File(Paths.document, "streamyfin-logs-export.txt");
    exportFile.write(content);
    return exportFile.uri;
  } catch (_e) {
    return null;
  }
}

/**
 * Clear all persistent log files.
 */
export function clearFileLogs(): void {
  try {
    const { Directory } = require("expo-file-system");
    const dir = new Directory(Paths.document, LOG_DIR_NAME);
    if (dir.exists) {
      dir.delete();
    }
    logFile = null;
  } catch (_e) {
    // Ignore
  }
}
