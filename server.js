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

// Peer connections: peerId -> { ws, roomId, ip, sessionToken }
const peers = new Map();

// Session management: sessionToken -> { peerId, roomId, lastSeen }
// Sessions allow peers to reconnect with the same identity after brief disconnects
const sessions = new Map();

// Session configuration
const SESSION_EXPIRY = 5 * 60 * 1000; // 5 minutes
const SESSION_CLEANUP_INTERVAL = 60 * 1000; // Check for expired sessions every minute
const HEARTBEAT_INTERVAL = 30 * 1000; // Client should send heartbeat every 30s

// Grace period before deleting a room when host disconnects (allows reconnection/migration)
const ROOM_CLEANUP_DELAY = 30000; // 30 seconds

// Generate cryptographically secure peer ID
function generatePeerId() {
  return crypto.randomBytes(16).toString('hex');
}

// Validate session token format (UUID-like or 32 hex chars)
function isValidSessionToken(token) {
  if (typeof token !== 'string') return false;
  // Accept UUID format or 32+ hex chars
  return /^[a-f0-9-]{32,36}$/i.test(token);
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

// Update session's roomId when peer joins/leaves a room
function updateSessionRoom(sessionToken, roomId) {
  const session = sessions.get(sessionToken);
  if (session) {
    session.roomId = roomId;
  }
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

  trackConnection(ip, ws);

  // Peer ID is assigned after hello message (may restore from session)
  let peerId = null;
  let sessionToken = null;

  ws.on('message', (data) => {
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
      const existingSession = sessions.get(sessionToken);
      const now = Date.now();

      if (existingSession && (now - existingSession.lastSeen) < SESSION_EXPIRY) {
        // Restore existing session
        peerId = existingSession.peerId;
        const previousRoomId = existingSession.roomId;

        // Update session
        existingSession.lastSeen = now;

        // Check if old peer connection exists and close it
        const oldPeer = peers.get(peerId);
        if (oldPeer && oldPeer.ws !== ws) {
          oldPeer.ws.close();
        }

        // Register peer with restored ID
        peers.set(peerId, { ws, roomId: previousRoomId, ip, sessionToken });

        console.log(`Session restored: ${peerId.substring(0, 8)}... (token: ${sessionToken.substring(0, 8)}...)`);

        // Send peer their restored ID and room info
        sendTo(ws, {
          type: 'peer-id',
          peerId,
          restored: true,
          roomId: previousRoomId
        });

        // If peer was in a room, restore room membership
        if (previousRoomId) {
          const room = rooms.get(previousRoomId);
          if (room) {
            // Re-add to members if they were a member
            if (!room.members.has(peerId) && room.hostPeerId !== peerId) {
              room.members.add(peerId);
            }
            // If they were the host and room is waiting for host, restore
            if (!room.hostPeerId) {
              room.hostPeerId = peerId;
              room.hostWs = ws;
              if (room.cleanupTimer) {
                clearTimeout(room.cleanupTimer);
                room.cleanupTimer = null;
              }
              console.log(`Host restored for room ${previousRoomId}`);
              // Notify members that host is back
              for (const memberId of room.members) {
                sendToPeer(memberId, { type: 'host-reconnected', roomId: previousRoomId, hostPeerId: peerId });
              }
            }
          }
        }
      } else {
        // Create new session
        peerId = generatePeerId();
        sessions.set(sessionToken, { peerId, roomId: null, lastSeen: now });
        peers.set(peerId, { ws, roomId: null, ip, sessionToken });

        console.log(`New session: ${peerId.substring(0, 8)}... (token: ${sessionToken.substring(0, 8)}...)`);

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
      const session = sessions.get(sessionToken);
      if (session) {
        session.lastSeen = Date.now();
      }
    }

    // Handle heartbeat message
    if (message.type === 'heartbeat') {
      sendTo(ws, { type: 'heartbeat-ack' });
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
        updateSessionRoom(sessionToken, roomId);

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
          updateSessionRoom(sessionToken, roomId);
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
        updateSessionRoom(sessionToken, roomId);

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
          updateSessionRoom(sessionToken, null);
        }
        break;
      }

      default:
        // Silently ignore unknown message types (don't log to prevent log spam)
        break;
    }
  });

  ws.on('close', () => {
    if (!peerId) {
      // Connection closed before hello was received
      untrackConnection(ip, ws);
      return;
    }

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
            // Member disconnected - keep in members set for potential reconnection
            // They will be removed when session expires
            console.log(`Member ${peerId.substring(0, 8)}... disconnected from room ${roomId}, session kept for reconnection`);
          }
        }
      }

      // Keep session alive for reconnection - don't delete it
      // Session will be cleaned up by periodic cleanup if not reconnected
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

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;

  for (const [token, session] of sessions) {
    if (now - session.lastSeen > SESSION_EXPIRY) {
      // Clean up any room membership for this session
      if (session.roomId) {
        const room = rooms.get(session.roomId);
        if (room) {
          room.members.delete(session.peerId);
        }
      }
      sessions.delete(token);
      expiredCount++;
    }
  }

  if (expiredCount > 0) {
    console.log(`Cleaned up ${expiredCount} expired session(s)`);
  }
}, SESSION_CLEANUP_INTERVAL);

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
