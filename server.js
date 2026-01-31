const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const WebSocket = require('ws');
const { createStorage, SESSION_EXPIRY_SECONDS } = require('./state-storage.js');
const { logger, truncatePeerId } = require('./logger.js');

const PORT = process.env.PORT || 3000;
const app = express();

// CORS configuration via environment variable
// CORS_ALLOWED_ORIGINS can be a comma-separated list of allowed origins
// Example: CORS_ALLOWED_ORIGINS=https://example.com,https://app.example.com
// If not set, CORS headers are not added (same-origin requests only)
const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : null;

// CORS middleware
if (CORS_ALLOWED_ORIGINS) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });
  logger.info({ origins: CORS_ALLOWED_ORIGINS }, 'CORS enabled for origins');
}

// TURN server configuration via environment variables
const TURN_CONFIG = {
  urls: process.env.TURN_URL ? process.env.TURN_URL.split(',').map(u => u.trim()) : null,
  secret: process.env.TURN_SECRET || null,
  username: process.env.TURN_USERNAME || null,
  credential: process.env.TURN_CREDENTIAL || null,
  ttl: parseInt(process.env.TURN_TTL, 10) || 86400,
};

// Rate limiting configuration
const RATE_LIMIT = {
  windowMs: 1000,
  maxMessages: 50,
  maxConnectionsPerIp: 10,
  maxMessageSize: 64 * 1024, // 64KB - more than enough for signaling messages
};

// Local maps for WebSocket references (cannot be stored in Redis)
const wsConnections = new Map();  // peerId -> ws

// Track connections per IP for rate limiting (local per instance)
const connectionsByIp = new Map();  // ip -> Set of ws connections
const messageRates = new Map();     // peerId -> { count, windowStart }

// State storage (Redis or in-memory)
let storage;

/**
 * Generate TURN credentials
 */
function generateTurnCredentials() {
  if (!TURN_CONFIG.urls) {
    return null;
  }

  // Static credentials mode
  if (TURN_CONFIG.username && TURN_CONFIG.credential) {
    return {
      servers: TURN_CONFIG.urls.map(url => ({
        urls: url,
        username: TURN_CONFIG.username,
        credential: TURN_CONFIG.credential
      })),
      ttl: TURN_CONFIG.ttl
    };
  }

  // Time-limited credentials mode (coturn with --use-auth-secret)
  if (TURN_CONFIG.secret) {
    const timestamp = Math.floor(Date.now() / 1000) + TURN_CONFIG.ttl;
    const username = `${timestamp}:dicebox`;
    const credential = crypto
      .createHmac('sha1', TURN_CONFIG.secret)
      .update(username)
      .digest('base64');

    return {
      servers: TURN_CONFIG.urls.map(url => ({
        urls: url,
        username,
        credential
      })),
      ttl: TURN_CONFIG.ttl
    };
  }

  return null;
}

// API: Get TURN credentials
app.get('/api/turn-credentials', (req, res) => {
  const credentials = generateTurnCredentials();

  if (!credentials) {
    return res.status(404).json({ error: 'TURN not configured' });
  }

  res.json(credentials);
});

// API: Health check
app.get('/api/health', async (req, res) => {
  try {
    const roomCount = await storage.getRoomCount();
    const peerCount = await storage.getPeerCount();
    res.json({
      status: 'ok',
      rooms: roomCount,
      peers: peerCount,
      turnConfigured: !!TURN_CONFIG.urls
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Static file serving with cache headers
// HTML files: ETag enabled, no caching
// All other files: Cache forever (immutable)
const staticDir = process.env.STATIC_DIR || 'dist';
const staticPath = path.resolve(__dirname, staticDir);

// Cache header middleware
app.use((req, res, next) => {
  const ext = path.extname(req.path);
  if (ext === '.html' || req.path === '/' || req.path.endsWith('/')) {
    // HTML files: use ETag for validation, but don't cache
    res.set('Cache-Control', 'no-cache');
  } else if (ext) {
    // All other static assets: cache forever (1 year, immutable)
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// Serve static files with ETag enabled
app.use(express.static(staticPath, {
  etag: true,
  index: 'index.html',
}));

// Create HTTP server from Express app
const server = http.createServer(app);

// WebSocket signaling server - MESH TOPOLOGY
const wss = new WebSocket.Server({
  server,
  maxPayload: RATE_LIMIT.maxMessageSize,
});

// Generate cryptographically secure peer ID
function generatePeerId() {
  return crypto.randomBytes(16).toString('hex');
}

// Validate session token format (UUID-like or 32 hex chars)
function isValidSessionToken(token) {
  if (typeof token !== 'string') return false;
  return /^[a-f0-9-]{32,36}$/i.test(token);
}

// Validate room ID format
function isValidRoomId(roomId) {
  if (typeof roomId !== 'string') return false;

  // Dice emoji format: 4-10 dice faces
  const dicePattern = /^[⚀⚁⚂⚃⚄⚅]{4,10}$/;
  if (dicePattern.test(roomId)) return true;

  // Legacy alphanumeric format: 4-32 chars
  return roomId.length >= 4 &&
         roomId.length <= 32 &&
         /^[a-zA-Z0-9-_]+$/.test(roomId);
}

// Validate peer ID format (32 hex chars)
function isValidPeerId(peerId) {
  return typeof peerId === 'string' &&
         peerId.length === 32 &&
         /^[a-f0-9]+$/.test(peerId);
}

// Check rate limit for a peer
function checkRateLimit(peerId) {
  const now = Date.now();
  let rateData = messageRates.get(peerId);

  if (!rateData || now - rateData.windowStart > RATE_LIMIT.windowMs) {
    rateData = { count: 0, windowStart: now };
    messageRates.set(peerId, rateData);
  }

  rateData.count++;
  return rateData.count <= RATE_LIMIT.maxMessages;
}

// Get client IP from request
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket?.remoteAddress ||
         'unknown';
}

// Check connection limit per IP
function checkConnectionLimit(ip) {
  const connections = connectionsByIp.get(ip);
  return !connections || connections.size < RATE_LIMIT.maxConnectionsPerIp;
}

// Track connection for an IP
function trackConnection(ip, ws) {
  if (!connectionsByIp.has(ip)) {
    connectionsByIp.set(ip, new Set());
  }
  connectionsByIp.get(ip).add(ws);
}

// Remove connection tracking for an IP
function untrackConnection(ip, ws) {
  const connections = connectionsByIp.get(ip);
  if (connections) {
    connections.delete(ws);
    if (connections.size === 0) {
      connectionsByIp.delete(ip);
    }
  }
}

function sendTo(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendToPeer(peerId, message) {
  const ws = wsConnections.get(peerId);
  if (ws) {
    sendTo(ws, message);
  }
}

function sendError(ws, errorType, reason) {
  sendTo(ws, { type: 'error', errorType, reason });
}

/**
 * Get all connected peer IDs in a room
 */
async function getConnectedRoomPeers(roomId) {
  const members = await storage.getRoomMembers(roomId);
  const connected = [];
  for (const peerId of members) {
    if (wsConnections.has(peerId)) {
      connected.push(peerId);
    }
  }
  return connected;
}

/**
 * Notify all peers in a room about an event
 */
async function notifyRoom(roomId, message, excludePeerId = null) {
  const members = await storage.getRoomMembers(roomId);
  for (const peerId of members) {
    if (peerId !== excludePeerId) {
      sendToPeer(peerId, message);
    }
  }
}

/**
 * Check if room should be deleted (no connected peers)
 */
async function checkRoomEmpty(roomId) {
  const connected = await getConnectedRoomPeers(roomId);
  if (connected.length === 0) {
    await storage.deleteRoom(roomId);
    logger.info({ roomId }, 'Room deleted (no connected peers)');
    return true;
  }
  return false;
}

wss.on('connection', (ws, req) => {
  const ip = getClientIp(req);

  // Check connection limit
  if (!checkConnectionLimit(ip)) {
    sendTo(ws, { type: 'error', errorType: 'rate-limit', reason: 'Too many connections' });
    ws.close();
    return;
  }

  trackConnection(ip, ws);

  // Peer ID is assigned after hello message (may restore from session)
  let peerId = null;
  let sessionToken = null;

  ws.on('message', async (data) => {
    // Check message size (defense in depth - maxPayload should catch this first)
    if (data.length > RATE_LIMIT.maxMessageSize) {
      sendError(ws, 'message-too-large', 'Message exceeds maximum size');
      return;
    }

    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      sendError(ws, 'invalid-json', 'Invalid JSON message');
      return;
    }

    // Validate message has a type
    if (!message || typeof message.type !== 'string') {
      sendError(ws, 'invalid-message', 'Message must have a type');
      return;
    }

    // First message must be 'hello' with session token
    if (!peerId) {
      if (message.type !== 'hello') {
        sendError(ws, 'protocol-error', 'First message must be hello');
        return;
      }

      sessionToken = message.sessionToken;
      if (!isValidSessionToken(sessionToken)) {
        sendError(ws, 'invalid-session', 'Invalid session token format');
        ws.close();
        return;
      }

      // Check for existing session
      const existingSession = await storage.getSession(sessionToken);
      const now = Date.now();

      if (existingSession && (now - existingSession.lastSeen) < SESSION_EXPIRY_SECONDS * 1000) {
        // Restore existing session
        peerId = existingSession.peerId;
        const previousRoomId = existingSession.roomId;

        // Update session
        await storage.updateSessionLastSeen(sessionToken);

        // Check if old peer connection exists and close it
        const oldWs = wsConnections.get(peerId);
        if (oldWs && oldWs !== ws) {
          oldWs.close();
        }

        // Register peer with restored ID
        wsConnections.set(peerId, ws);
        await storage.setPeer(peerId, { roomId: previousRoomId, ip, sessionToken });

        logger.info({ peerId: truncatePeerId(peerId), restored: true }, 'Session restored');

        // Send peer their restored ID and room info
        sendTo(ws, {
          type: 'peer-id',
          peerId,
          restored: true,
          roomId: previousRoomId
        });

        // If peer was in a room, ensure they're still a member
        if (previousRoomId) {
          const room = await storage.getRoom(previousRoomId);
          if (room) {
            await storage.addRoomMember(previousRoomId, peerId);

            // Notify other peers that this peer reconnected
            notifyRoom(previousRoomId, {
              type: 'peer-reconnected',
              peerId,
              roomId: previousRoomId
            }, peerId);
          }
        }
      } else {
        // Create new session
        peerId = generatePeerId();
        await storage.setSession(sessionToken, { peerId, roomId: null, lastSeen: now });
        wsConnections.set(peerId, ws);
        await storage.setPeer(peerId, { roomId: null, ip, sessionToken });

        logger.info({ peerId: truncatePeerId(peerId), restored: false }, 'New session created');

        sendTo(ws, { type: 'peer-id', peerId, restored: false });
      }
      return;
    }

    // Check rate limit (after peerId is assigned)
    if (!checkRateLimit(peerId)) {
      sendError(ws, 'rate-limit', 'Too many messages');
      return;
    }

    // Update session lastSeen on any message (acts as heartbeat)
    if (sessionToken) {
      await storage.updateSessionLastSeen(sessionToken);
    }

    // Handle heartbeat message
    if (message.type === 'heartbeat') {
      sendTo(ws, { type: 'heartbeat-ack' });
      return;
    }

    const peer = await storage.getPeer(peerId);

    switch (message.type) {
      // Room discovery: check if room exists and get ALL peer IDs
      case 'query-room': {
        const { roomId } = message;

        if (!isValidRoomId(roomId)) {
          sendTo(ws, { type: 'room-info', roomId: null, exists: false, error: 'Invalid room ID' });
          return;
        }

        const room = await storage.getRoom(roomId);

        if (room) {
          const peerIds = await getConnectedRoomPeers(roomId);
          sendTo(ws, {
            type: 'room-info',
            roomId,
            exists: true,
            peerIds,
            diceConfig: room.diceConfig
          });
        } else {
          sendTo(ws, {
            type: 'room-info',
            roomId,
            exists: false
          });
        }
        break;
      }

      // Create a new room (first peer registers it with dice config)
      case 'create-room': {
        const { roomId, diceConfig } = message;

        if (!isValidRoomId(roomId)) {
          sendTo(ws, { type: 'create-room-failed', roomId, reason: 'Invalid room ID format' });
          return;
        }

        // Check if room already exists
        const existingRoom = await storage.getRoom(roomId);
        if (existingRoom) {
          const connectedPeers = await getConnectedRoomPeers(roomId);
          if (connectedPeers.length > 0) {
            sendTo(ws, { type: 'create-room-failed', roomId, reason: 'Room already exists' });
            return;
          }
          // Room exists but empty, delete it first
          await storage.deleteRoom(roomId);
        }

        // Create room with dice config
        await storage.setRoom(roomId, {
          createdAt: Date.now(),
          diceConfig: diceConfig || { diceSets: [{ id: 'set-1', count: 2, color: '#ffffff' }] }
        });

        // Add creator as first member
        await storage.addRoomMember(roomId, peerId);
        await storage.setPeer(peerId, { ...peer, roomId });
        await storage.updateSessionRoom(sessionToken, roomId);

        sendTo(ws, { type: 'create-room-success', roomId });
        logger.info({ roomId, peerId: truncatePeerId(peerId) }, 'Room created');
        break;
      }

      // Join a room - returns ALL peer IDs to connect to
      case 'join-room': {
        const { roomId } = message;

        if (!isValidRoomId(roomId)) {
          sendTo(ws, { type: 'join-room-failed', roomId, reason: 'Invalid room ID format' });
          return;
        }

        const room = await storage.getRoom(roomId);

        if (!room) {
          sendTo(ws, { type: 'join-room-failed', roomId, reason: 'Room does not exist' });
          return;
        }

        // Get all connected peers in the room
        const peerIds = await getConnectedRoomPeers(roomId);

        if (peerIds.length === 0) {
          sendTo(ws, { type: 'join-room-failed', roomId, reason: 'Room is empty' });
          return;
        }

        // Add new peer to room
        await storage.addRoomMember(roomId, peerId);
        await storage.setPeer(peerId, { ...peer, roomId });
        await storage.updateSessionRoom(sessionToken, roomId);

        // Tell the peer about all existing peers so they can connect to each
        sendTo(ws, {
          type: 'join-room-success',
          roomId,
          peerIds,
          diceConfig: room.diceConfig
        });

        // Notify existing peers that someone is joining
        for (const existingPeerId of peerIds) {
          sendToPeer(existingPeerId, {
            type: 'peer-joining',
            peerId,
            roomId
          });
        }

        logger.info({ roomId, peerId: truncatePeerId(peerId), existingPeers: peerIds.length }, 'Peer joining room');
        break;
      }

      // WebRTC signaling - just relay between peers
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const { targetPeerId } = message;

        if (!isValidPeerId(targetPeerId)) {
          sendError(ws, 'invalid-peer', 'Invalid target peer ID');
          return;
        }

        // Verify target peer exists
        if (!await storage.hasPeer(targetPeerId)) {
          sendError(ws, 'peer-not-found', 'Target peer not found');
          return;
        }

        sendToPeer(targetPeerId, {
          ...message,
          fromPeerId: peerId
        });
        break;
      }

      // Leave room
      case 'leave-room': {
        if (peer && peer.roomId) {
          const roomId = peer.roomId;

          // Remove peer from room
          await storage.removeRoomMember(roomId, peerId);
          await storage.setPeer(peerId, { ...peer, roomId: null });
          await storage.updateSessionRoom(sessionToken, null);

          // Notify other peers
          notifyRoom(roomId, {
            type: 'peer-left',
            peerId,
            roomId
          });

          logger.info({ roomId, peerId: truncatePeerId(peerId) }, 'Peer left room');

          // Check if room is now empty
          await checkRoomEmpty(roomId);
        }
        break;
      }

      default:
        // Silently ignore unknown message types
        break;
    }
  });

  ws.on('close', async () => {
    if (!peerId) {
      untrackConnection(ip, ws);
      return;
    }

    const peer = await storage.getPeer(peerId);

    if (peer) {
      untrackConnection(peer.ip, ws);

      if (peer.roomId) {
        const roomId = peer.roomId;

        // Notify other peers about disconnection
        notifyRoom(roomId, {
          type: 'peer-disconnected',
          peerId,
          roomId
        }, peerId);

        logger.info({ roomId, peerId: truncatePeerId(peerId) }, 'Peer disconnected from room');

        // Don't remove from room immediately - allow reconnection
        // Cleanup will happen via session expiry
      }
    }

    messageRates.delete(peerId);
    wsConnections.delete(peerId);
    await storage.deletePeer(peerId);
    logger.debug({ peerId: truncatePeerId(peerId) }, 'Peer disconnected');
  });

  ws.on('error', (error) => {
    logger.error({ peerId: truncatePeerId(peerId), error: error.message }, 'WebSocket error');
  });
});

// Cleanup stale rate limit entries periodically
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [peerId, rateData] of messageRates) {
    if (now - rateData.windowStart > RATE_LIMIT.windowMs * 10) {
      messageRates.delete(peerId);
    }
  }
}, 60000);

// Cleanup expired sessions periodically
const sessionCleanupInterval = setInterval(async () => {
  try {
    const expired = await storage.cleanupExpiredSessions();

    // Clean up room membership for expired sessions
    for (const { session } of expired) {
      if (session.roomId) {
        await storage.removeRoomMember(session.roomId, session.peerId);
        // Check if room is now empty
        await checkRoomEmpty(session.roomId);
      }
    }

    if (expired.length > 0) {
      logger.info({ count: expired.length }, 'Cleaned up expired sessions');
    }
  } catch (err) {
    logger.error({ error: err.message }, 'Error cleaning up sessions');
  }
}, 60000);

// Graceful shutdown handling
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received, closing gracefully');

  // Clear cleanup intervals to prevent operations on closing resources
  clearInterval(rateLimitCleanupInterval);
  clearInterval(sessionCleanupInterval);

  // Stop accepting new WebSocket connections
  wss.close(() => {
    logger.info('WebSocket server closed');
  });

  // Close all existing WebSocket connections
  const connectionCount = wsConnections.size;
  const closePromises = [];
  for (const ws of wsConnections.values()) {
    closePromises.push(new Promise((resolve) => {
      ws.close(1001, 'Server shutting down');
      ws.once('close', resolve);
      // Force close after timeout
      setTimeout(resolve, 1000);
    }));
  }

  await Promise.all(closePromises);
  logger.info({ count: connectionCount }, 'WebSocket connections closed');

  // Close HTTP server and wait for completion
  await new Promise((resolve) => {
    server.close(() => {
      logger.info('HTTP server closed');
      resolve();
    });
  });

  // Disconnect from storage (Redis) if initialized
  if (storage) {
    try {
      await storage.disconnect();
      logger.info('Storage disconnected');
    } catch (err) {
      logger.error({ error: err.message }, 'Error disconnecting storage');
    }
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// Register signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
async function start() {
  storage = createStorage();
  await storage.connect();

  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'DiceBox server started');
    logger.info('Mesh topology signaling server ready');

    if (TURN_CONFIG.urls) {
      const mode = TURN_CONFIG.secret ? 'time-limited' : 'static';
      logger.info({ mode, servers: TURN_CONFIG.urls }, 'TURN servers configured');
    } else {
      logger.info('TURN not configured (STUN only)');
    }
  });
}

start().catch(err => {
  logger.fatal({ error: err.message }, 'Failed to start server');
  process.exit(1);
});
