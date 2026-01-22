const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// TURN server configuration via environment variables
// For coturn with time-limited credentials:
//   TURN_URL=turn:turn.example.com:3478
//   TURN_SECRET=your-shared-secret
//   TURN_TTL=86400 (optional, default 24 hours)
//
// For static credentials:
//   TURN_URL=turn:turn.example.com:3478
//   TURN_USERNAME=username
//   TURN_CREDENTIAL=password
//
// Multiple TURN URLs can be comma-separated:
//   TURN_URL=turn:turn1.example.com:3478,turns:turn1.example.com:443
const TURN_CONFIG = {
  urls: process.env.TURN_URL ? process.env.TURN_URL.split(',').map(u => u.trim()) : null,
  secret: process.env.TURN_SECRET || null,
  username: process.env.TURN_USERNAME || null,
  credential: process.env.TURN_CREDENTIAL || null,
  ttl: parseInt(process.env.TURN_TTL, 10) || 86400, // 24 hours default
};

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Rate limiting configuration
const RATE_LIMIT = {
  windowMs: 1000,           // 1 second window
  maxMessages: 50,          // Max messages per window
  maxConnectionsPerIp: 10,  // Max concurrent connections per IP
};

// Track connections per IP for rate limiting
const connectionsByIp = new Map();  // ip -> Set of ws connections
const messageRates = new Map();     // peerId -> { count, windowStart }

/**
 * Generate TURN credentials
 * Supports two modes:
 * 1. Time-limited credentials using HMAC (for coturn with --use-auth-secret)
 * 2. Static credentials (username/password)
 *
 * For time-limited credentials (coturn):
 * - Username format: "timestamp:random" where timestamp is expiry time
 * - Credential: HMAC-SHA1(secret, username)
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

// Simple static file server with API endpoints
const server = http.createServer((req, res) => {
  // CORS headers for API endpoints
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Get TURN credentials
  if (req.url === '/api/turn-credentials' && req.method === 'GET') {
    const credentials = generateTurnCredentials();

    if (!credentials) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TURN not configured' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(credentials));
    return;
  }

  // API: Health check
  if (req.url === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      peers: peers.size,
      turnConfigured: !!TURN_CONFIG.urls
    }));
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket signaling server - MINIMAL ICE BROKER
const wss = new WebSocket.Server({ server });

// Room tracking: roomId -> { hostPeerId, hostWs, members: Set<peerId>, cleanupTimer }
const rooms = new Map();

// Peer connections: peerId -> { ws, roomId, ip }
const peers = new Map();

// Grace period before deleting a room when host disconnects (allows reconnection/migration)
const ROOM_CLEANUP_DELAY = 30000; // 30 seconds

// Generate cryptographically secure peer ID
function generatePeerId() {
  return crypto.randomBytes(16).toString('hex');
}

// Validate room ID format
// Accepts: dice emoji (⚀⚁⚂⚃⚄⚅) or alphanumeric with hyphens/underscores
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
  const peer = peers.get(peerId);
  if (peer) {
    sendTo(peer.ws, message);
  }
}

function sendError(ws, errorType, reason) {
  sendTo(ws, { type: 'error', errorType, reason });
}

// Schedule room cleanup after host disconnects (allows time for migration or reconnection)
function scheduleRoomCleanup(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Clear any existing cleanup timer
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
  }

  room.cleanupTimer = setTimeout(() => {
    const currentRoom = rooms.get(roomId);
    // Only delete if room still has no host
    if (currentRoom && !currentRoom.hostPeerId) {
      // Notify remaining members the room is closing
      for (const memberId of currentRoom.members) {
        sendToPeer(memberId, { type: 'room-closed', roomId, reason: 'Host did not return' });
      }
      rooms.delete(roomId);
      console.log(`Room ${roomId} deleted after cleanup timeout (no host claimed)`);
    }
  }, ROOM_CLEANUP_DELAY);
}

wss.on('connection', (ws, req) => {
  const ip = getClientIp(req);

  // Check connection limit
  if (!checkConnectionLimit(ip)) {
    sendTo(ws, { type: 'error', errorType: 'rate-limit', reason: 'Too many connections' });
    ws.close();
    return;
  }

  const peerId = generatePeerId();
  peers.set(peerId, { ws, roomId: null, ip });
  trackConnection(ip, ws);

  console.log(`Peer connected: ${peerId.substring(0, 8)}...`);

  // Send peer their ID
  sendTo(ws, { type: 'peer-id', peerId });

  ws.on('message', (data) => {
    // Check rate limit
    if (!checkRateLimit(peerId)) {
      sendError(ws, 'rate-limit', 'Too many messages');
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

    const peer = peers.get(peerId);

    switch (message.type) {
      // Room discovery: check if room exists and get host info
      case 'query-room': {
        const { roomId } = message;

        if (!isValidRoomId(roomId)) {
          sendTo(ws, { type: 'room-info', roomId: null, exists: false, error: 'Invalid room ID' });
          return;
        }

        const room = rooms.get(roomId);

        if (room) {
          sendTo(ws, {
            type: 'room-info',
            roomId,
            exists: true,
            hostPeerId: room.hostPeerId
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

      // Register as host for a room
      case 'register-host': {
        const { roomId } = message;

        if (!isValidRoomId(roomId)) {
          sendTo(ws, { type: 'register-host-failed', roomId, reason: 'Invalid room ID format' });
          return;
        }

        // Check if room already has an active host
        const existingRoom = rooms.get(roomId);
        if (existingRoom && peers.has(existingRoom.hostPeerId)) {
          sendTo(ws, { type: 'register-host-failed', roomId, reason: 'Room already has a host' });
          return;
        }

        // Clear any pending cleanup timer if room exists
        if (existingRoom && existingRoom.cleanupTimer) {
          clearTimeout(existingRoom.cleanupTimer);
        }

        rooms.set(roomId, {
          hostPeerId: peerId,
          hostWs: ws,
          members: new Set(),
          cleanupTimer: null
        });
        peer.roomId = roomId;

        sendTo(ws, { type: 'register-host-success', roomId });
        console.log(`Room ${roomId} created with host ${peerId.substring(0, 8)}...`);
        break;
      }

      // Claim host role (for migration)
      case 'claim-host': {
        const { roomId } = message;

        if (!isValidRoomId(roomId)) {
          sendTo(ws, { type: 'claim-host-failed', roomId, reason: 'Invalid room ID format' });
          return;
        }

        const room = rooms.get(roomId);

        // Allow claiming if room doesn't exist or has no active host
        if (!room || !peers.has(room.hostPeerId)) {
          // Clear any pending cleanup timer
          if (room && room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
          }

          // Preserve members list if room exists, otherwise create new
          const members = room ? room.members : new Set();
          rooms.set(roomId, {
            hostPeerId: peerId,
            hostWs: ws,
            members,
            cleanupTimer: null
          });
          peer.roomId = roomId;
          sendTo(ws, { type: 'claim-host-success', roomId });
          console.log(`Room ${roomId} host migrated to ${peerId.substring(0, 8)}...`);
        } else {
          sendTo(ws, { type: 'claim-host-failed', roomId, reason: 'Room already has active host' });
        }
        break;
      }

      // Join a room (connect to its host)
      case 'join-room': {
        const { roomId } = message;

        if (!isValidRoomId(roomId)) {
          sendTo(ws, { type: 'join-room-failed', roomId, reason: 'Invalid room ID format' });
          return;
        }

        const room = rooms.get(roomId);

        if (!room) {
          sendTo(ws, { type: 'join-room-failed', roomId, reason: 'Room does not exist' });
          return;
        }

        // Check if host is still connected
        if (!peers.has(room.hostPeerId)) {
          sendTo(ws, { type: 'join-room-failed', roomId, reason: 'Room host is disconnected' });
          return;
        }

        peer.roomId = roomId;
        room.members.add(peerId);

        // Tell the peer who the host is so they can initiate WebRTC
        sendTo(ws, {
          type: 'join-room-success',
          roomId,
          hostPeerId: room.hostPeerId
        });

        // Notify host that a peer wants to connect
        sendTo(room.hostWs, {
          type: 'peer-connecting',
          peerId
        });

        console.log(`Peer ${peerId.substring(0, 8)}... joining room ${roomId}`);
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
        if (!peers.has(targetPeerId)) {
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
        if (peer.roomId) {
          const room = rooms.get(peer.roomId);
          const roomId = peer.roomId;

          if (room) {
            if (room.hostPeerId === peerId) {
              // Host is leaving - notify all members and start cleanup timer
              for (const memberId of room.members) {
                sendToPeer(memberId, { type: 'host-disconnected', roomId });
              }
              room.hostPeerId = null;
              room.hostWs = null;
              scheduleRoomCleanup(roomId);
              console.log(`Room ${roomId} host left, notified ${room.members.size} members`);
            } else {
              // Member is leaving - just remove from members set
              room.members.delete(peerId);
            }
          }

          peer.roomId = null;
        }
        break;
      }

      default:
        // Silently ignore unknown message types (don't log to prevent log spam)
        break;
    }
  });

  ws.on('close', () => {
    const peer = peers.get(peerId);

    if (peer) {
      untrackConnection(peer.ip, ws);

      if (peer.roomId) {
        const room = rooms.get(peer.roomId);
        const roomId = peer.roomId;

        if (room) {
          if (room.hostPeerId === peerId) {
            // Host disconnected - notify all members and start cleanup timer
            for (const memberId of room.members) {
              sendToPeer(memberId, { type: 'host-disconnected', roomId });
            }
            room.hostPeerId = null;
            room.hostWs = null;
            scheduleRoomCleanup(roomId);
            console.log(`Room ${roomId} host disconnected, notified ${room.members.size} members, cleanup in ${ROOM_CLEANUP_DELAY / 1000}s`);
          } else {
            // Member disconnected - just remove from members set
            room.members.delete(peerId);
          }
        }
      }
    }

    messageRates.delete(peerId);
    peers.delete(peerId);
    console.log(`Peer disconnected: ${peerId.substring(0, 8)}...`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for peer ${peerId.substring(0, 8)}...:`, error.message);
  });
});

// Cleanup stale rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [peerId, rateData] of messageRates) {
    if (now - rateData.windowStart > RATE_LIMIT.windowMs * 10) {
      messageRates.delete(peerId);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`DiceBox server running on http://localhost:${PORT}`);
  console.log(`Minimal ICE broker ready (host-based rooms)`);

  if (TURN_CONFIG.urls) {
    const mode = TURN_CONFIG.secret ? 'time-limited' : 'static';
    console.log(`TURN servers configured (${mode} credentials): ${TURN_CONFIG.urls.join(', ')}`);
    console.log(`TURN credentials endpoint: /api/turn-credentials`);
  } else {
    console.log('TURN not configured (STUN only). Set TURN_URL environment variable to enable.');
  }
});
