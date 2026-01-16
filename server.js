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

// WebSocket signaling server
const wss = new WebSocket.Server({ server });

// Room management
const rooms = new Map();

function generatePeerId() {
  return Math.random().toString(36).substring(2, 10);
}

function broadcastToRoom(roomId, message, excludePeerId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.forEach((client, peerId) => {
    if (peerId !== excludePeerId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function getRoomPeers(roomId, excludePeerId = null) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return Array.from(room.entries())
    .filter(([peerId]) => peerId !== excludePeerId)
    .map(([peerId, client]) => ({
      peerId,
      username: client.username || 'Anonymous'
    }));
}

wss.on('connection', (ws) => {
  const peerId = generatePeerId();
  let currentRoom = null;

  console.log(`Peer connected: ${peerId}`);

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      console.error('Invalid JSON:', data);
      return;
    }

    switch (message.type) {
      case 'join': {
        const { roomId, username } = message;
        currentRoom = roomId;
        ws.username = username || 'Anonymous';

        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Map());
        }

        const room = rooms.get(roomId);
        room.set(peerId, ws);

        // Send peer their ID and existing peers in the room
        ws.send(JSON.stringify({
          type: 'joined',
          peerId,
          roomId,
          peers: getRoomPeers(roomId, peerId)
        }));

        // Notify other peers
        broadcastToRoom(roomId, {
          type: 'peer-joined',
          peerId,
          username: ws.username
        }, peerId);

        console.log(`Peer ${peerId} (${ws.username}) joined room ${roomId}`);
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        // Relay WebRTC signaling messages to specific peer
        const { targetPeerId } = message;
        const room = rooms.get(currentRoom);
        if (room && room.has(targetPeerId)) {
          const targetWs = room.get(targetPeerId);
          if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({
              ...message,
              fromPeerId: peerId
            }));
          }
        }
        break;
      }

      case 'dice-roll': {
        // Broadcast dice roll to all peers in room (including sender for confirmation)
        broadcastToRoom(currentRoom, {
          type: 'dice-roll',
          peerId,
          username: ws.username,
          ...message
        });
        break;
      }

      case 'chat': {
        // Broadcast chat message to all peers
        broadcastToRoom(currentRoom, {
          type: 'chat',
          peerId,
          username: ws.username,
          message: message.message,
          timestamp: Date.now()
        });
        break;
      }

      default:
        console.log('Unknown message type:', message.type);
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.delete(peerId);

      // Notify other peers
      broadcastToRoom(currentRoom, {
        type: 'peer-left',
        peerId,
        username: ws.username
      });

      // Clean up empty rooms
      if (room.size === 0) {
        rooms.delete(currentRoom);
        console.log(`Room ${currentRoom} deleted (empty)`);
      }
    }
    console.log(`Peer disconnected: ${peerId}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for peer ${peerId}:`, error);
  });
});

server.listen(PORT, () => {
  console.log(`DiceBox server running on http://localhost:${PORT}`);
  console.log(`WebSocket signaling server ready`);
});
