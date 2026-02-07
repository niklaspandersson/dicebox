/**
 * Client-side error reporter
 *
 * Captures uncaught exceptions and unhandled promise rejections,
 * then sends them to the server for centralized logging via Pino.
 *
 * Also exposes reportError() for manually reporting caught errors.
 */

import { getApiBaseUrl } from "../config.js";

const REPORT_URL = `${getApiBaseUrl()}/api/client-errors`;
const BATCH_INTERVAL = 5000; // flush every 5 seconds
const MAX_QUEUE_SIZE = 20; // drop oldest if queue exceeds this
const MAX_ERRORS_PER_MINUTE = 30; // client-side rate limit

let queue = [];
let flushTimer = null;
let errorCount = 0;
let errorWindowStart = Date.now();

function resetRateWindow() {
  errorCount = 0;
  errorWindowStart = Date.now();
}

function isRateLimited() {
  if (Date.now() - errorWindowStart > 60000) {
    resetRateWindow();
  }
  return errorCount >= MAX_ERRORS_PER_MINUTE;
}

function enqueue(entry) {
  if (isRateLimited()) return;
  errorCount++;

  queue.push(entry);
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
  }

  if (!flushTimer) {
    flushTimer = setTimeout(flush, BATCH_INTERVAL);
  }
}

function flush() {
  flushTimer = null;
  if (queue.length === 0) return;

  const batch = queue;
  queue = [];

  // Fire-and-forget — we don't retry failed error reports
  try {
    const body = JSON.stringify({ errors: batch });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(REPORT_URL, body);
    } else {
      fetch(REPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Reporting itself failed — nothing we can do
  }
}

function buildEntry(level, message, extra) {
  return {
    level,
    message: String(message).slice(0, 1024),
    timestamp: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    ...extra,
  };
}

/**
 * Manually report a caught error.
 * @param {Error|string} error
 * @param {Object} [context] - additional key/value pairs to include
 */
export function reportError(error, context) {
  const message =
    error instanceof Error ? error.message : String(error);
  const stack =
    error instanceof Error ? error.stack?.slice(0, 2048) : undefined;

  enqueue(buildEntry("error", message, { stack, ...context }));
}

/**
 * Install global error handlers. Call once at app startup.
 */
export function initErrorReporter() {
  window.addEventListener("error", (event) => {
    enqueue(
      buildEntry("error", event.message, {
        stack: event.error?.stack?.slice(0, 2048),
        source: event.filename
          ? `${event.filename}:${event.lineno}:${event.colno}`
          : undefined,
      }),
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "unhandled promise rejection");
    const stack =
      reason instanceof Error ? reason.stack?.slice(0, 2048) : undefined;

    enqueue(buildEntry("error", message, { stack, type: "unhandledrejection" }));
  });

  // Flush any remaining errors when the page is unloading
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });
}
