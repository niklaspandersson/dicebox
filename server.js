const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Simple static file server
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
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

// Minimal room tracking: roomId -> { hostPeerId, hostWs }
const rooms = new Map();

// Peer connections: peerId -> { ws, roomId }
const peers = new Map();

function generatePeerId() {
  return Math.random().toString(36).substring(2, 10);
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

wss.on('connection', (ws) => {
  const peerId = generatePeerId();
  peers.set(peerId, { ws, roomId: null });

  console.log(`Peer connected: ${peerId}`);

  // Send peer their ID
  sendTo(ws, { type: 'peer-id', peerId });

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      console.error('Invalid JSON:', data);
      return;
    }

    const peer = peers.get(peerId);

    switch (message.type) {
      // Room discovery: check if room exists and get host info
      case 'query-room': {
        const { roomId } = message;
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

        // Check if room already has a host
        if (rooms.has(roomId)) {
          sendTo(ws, { type: 'register-host-failed', roomId, reason: 'Room already has a host' });
          return;
        }

        rooms.set(roomId, { hostPeerId: peerId, hostWs: ws });
        peer.roomId = roomId;

        sendTo(ws, { type: 'register-host-success', roomId });
        console.log(`Room ${roomId} created with host ${peerId}`);
        break;
      }

      // Claim host role (for migration)
      case 'claim-host': {
        const { roomId } = message;
        const room = rooms.get(roomId);

        // Allow claiming if room doesn't exist or has no active host
        if (!room || !peers.has(room.hostPeerId)) {
          rooms.set(roomId, { hostPeerId: peerId, hostWs: ws });
          peer.roomId = roomId;
          sendTo(ws, { type: 'claim-host-success', roomId });
          console.log(`Room ${roomId} host migrated to ${peerId}`);
        } else {
          sendTo(ws, { type: 'claim-host-failed', roomId, reason: 'Room already has active host' });
        }
        break;
      }

      // Join a room (connect to its host)
      case 'join-room': {
        const { roomId } = message;
        const room = rooms.get(roomId);

        if (!room) {
          sendTo(ws, { type: 'join-room-failed', roomId, reason: 'Room does not exist' });
          return;
        }

        peer.roomId = roomId;

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

        console.log(`Peer ${peerId} joining room ${roomId}`);
        break;
      }

      // WebRTC signaling - just relay between peers
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const { targetPeerId } = message;
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

          // If this peer was the host, remove the room
          if (room && room.hostPeerId === peerId) {
            rooms.delete(peer.roomId);
            console.log(`Room ${peer.roomId} closed (host left)`);
          }

          peer.roomId = null;
        }
        break;
      }

      default:
        console.log('Unknown message type:', message.type);
    }
  });

  ws.on('close', () => {
    const peer = peers.get(peerId);

    if (peer && peer.roomId) {
      const room = rooms.get(peer.roomId);

      // If this peer was the host, remove the room entry
      // (clients will handle migration via claim-host)
      if (room && room.hostPeerId === peerId) {
        rooms.delete(peer.roomId);
        console.log(`Room ${peer.roomId} host disconnected, awaiting migration`);
      }
    }

    peers.delete(peerId);
    console.log(`Peer disconnected: ${peerId}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for peer ${peerId}:`, error);
  });
});

server.listen(PORT, () => {
  console.log(`DiceBox server running on http://localhost:${PORT}`);
  console.log(`Minimal ICE broker ready (host-based rooms)`);
});
