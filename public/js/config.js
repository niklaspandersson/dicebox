/**
 * Application configuration
 *
 * Backend host can be configured at build time via VITE_BACKEND_HOST
 * If not set, requests are made to the same host as the frontend (root-relative)
 *
 * Examples:
 *   VITE_BACKEND_HOST=api.example.com         -> wss://api.example.com, https://api.example.com/api/...
 *   VITE_BACKEND_HOST=localhost:3000          -> ws://localhost:3000, http://localhost:3000/api/...
 *   VITE_BACKEND_HOST=http://localhost:3000   -> ws://localhost:3000, http://localhost:3000/api/...
 *   VITE_BACKEND_HOST=https://api.example.com -> wss://api.example.com, https://api.example.com/api/...
 *   (not set)                                 -> same host as frontend (root-relative)
 */

// Backend host from build-time environment variable
// When set, this is the host (and optional port) for WebSocket and API requests
// Can include protocol (http://, https://) for explicit control
const BACKEND_HOST = import.meta.env.VITE_BACKEND_HOST || null;

// Parse the backend host to extract protocol and host
function parseBackendHost() {
  if (!BACKEND_HOST) return null;

  // Check if protocol is explicitly specified
  const match = BACKEND_HOST.match(/^(https?):\/\/(.+)$/i);
  if (match) {
    const protocol = match[1].toLowerCase();
    const host = match[2].replace(/\/+$/, "");
    const isSecure = protocol === "https" || protocol === "wss";
    return { host, isSecure };
  }

  // No protocol specified - will infer from frontend
  const host = BACKEND_HOST.replace(/\/+$/, "");
  return { host, isSecure: null };
}

const parsedBackend = parseBackendHost();

/**
 * Get the WebSocket URL for the signaling server
 * @returns {string} WebSocket URL (e.g., "wss://api.example.com" or "wss://current-host")
 */
export function getWebSocketUrl() {
  if (parsedBackend) {
    // Use configured backend host
    // If protocol was explicit, use it; otherwise infer from frontend
    const isSecure =
      parsedBackend.isSecure ?? window.location.protocol === "https:";
    const protocol = isSecure ? "wss:" : "ws:";
    return `${protocol}//${parsedBackend.host}`;
  }
  // Default: same host as frontend
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

/**
 * Get the base URL for API requests
 * @returns {string} API base URL (e.g., "https://api.example.com" or "" for root-relative)
 */
export function getApiBaseUrl() {
  if (parsedBackend) {
    // Use configured backend host
    // If protocol was explicit, use it; otherwise infer from frontend
    const isSecure =
      parsedBackend.isSecure ?? window.location.protocol === "https:";
    const protocol = isSecure ? "https:" : "http:";
    return `${protocol}//${parsedBackend.host}`;
  }
  // Default: root-relative (empty string)
  return "";
}

/**
 * Check if a custom backend host is configured
 * @returns {boolean}
 */
export function hasCustomBackendHost() {
  return !!BACKEND_HOST;
}
