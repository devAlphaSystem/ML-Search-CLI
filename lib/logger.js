import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let logStream = null;
let enabled = false;
let logFilePath = null;

export function initLogger(outputDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").substring(0, 19);
  logFilePath = path.join(outputDir || path.join(__dirname, ".."), `ml-search_${ts}.log`);
  logStream = fs.createWriteStream(logFilePath, { flags: "a", encoding: "utf-8" });
  enabled = true;
  log("LOGGER", `Log file created: ${logFilePath}`);
  log("LOGGER", `Node ${process.version} | Platform: ${process.platform} ${process.arch}`);
  log("LOGGER", `CWD: ${process.cwd()}`);
  log("LOGGER", `Args: ${process.argv.join(" ")}`);
  return logFilePath;
}

export function getLogFilePath() {
  return logFilePath;
}

export function isLogging() {
  return enabled;
}

export function log(tag, message, data) {
  if (!enabled || !logStream) return;
  const ts = new Date().toISOString();
  let line = `[${ts}] [${tag}] ${message}`;
  if (data !== undefined) {
    let serialized;
    try {
      if (typeof data === "string") {
        serialized = data;
      } else if (data instanceof Map) {
        serialized = JSON.stringify(Object.fromEntries(data), null, 2);
      } else if (data instanceof Error) {
        serialized = `${data.message}\n${data.stack}`;
      } else if (Buffer.isBuffer(data)) {
        serialized = `<Buffer ${data.length} bytes>`;
      } else {
        serialized = JSON.stringify(data, null, 2);
      }
    } catch {
      serialized = String(data);
    }
    line += `\n${serialized}`;
  }
  logStream.write(line + "\n");
}

export function closeLogger() {
  if (logStream) {
    log("LOGGER", "Closing log file.");
    logStream.end();
    logStream = null;
    enabled = false;
  }
}
