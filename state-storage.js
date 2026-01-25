/**
 * State Storage Module
 *
 * Provides storage for rooms, peers, and sessions.
 * Uses Redis when REDIS_HOST is configured, falls back to in-memory storage otherwise.
 *
 * Note: WebSocket objects cannot be stored in Redis, so they are kept in local Maps.
 * This module handles only the serializable state data.
 */

const { createClient } = require('redis');
const { logger } = require('./logger.js');

// Configuration
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const SESSION_EXPIRY_SECONDS = 5 * 60; // 5 minutes

// Redis key prefixes
const KEYS = {
  room: (roomId) => `dicebox:room:${roomId}`,
  roomMembers: (roomId) => `dicebox:room:${roomId}:members`,
  peer: (peerId) => `dicebox:peer:${peerId}`,
  session: (token) => `dicebox:session:${token}`,
};

/**
 * In-memory storage implementation (fallback when Redis is not configured)
 */
class MemoryStorage {
  constructor() {
    this.rooms = new Map();
    this.peers = new Map();
    this.sessions = new Map();
  }

  async connect() {
    logger.info('Using in-memory state storage');
    return true;
  }

  async disconnect() {
    // Nothing to do
  }

  // Room operations
  async getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  async setRoom(roomId, data) {
    const existing = this.rooms.get(roomId) || { members: new Set() };
    this.rooms.set(roomId, { ...existing, ...data, members: existing.members });
  }

  async deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  async getRoomMembers(roomId) {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.members) : [];
  }

  async addRoomMember(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.members.add(peerId);
    }
  }

  async removeRoomMember(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.members.delete(peerId);
    }
  }

  async getRoomCount() {
    return this.rooms.size;
  }

  async getAllRoomIds() {
    return Array.from(this.rooms.keys());
  }

  // Peer operations
  async getPeer(peerId) {
    return this.peers.get(peerId) || null;
  }

  async setPeer(peerId, data) {
    this.peers.set(peerId, data);
  }

  async deletePeer(peerId) {
    this.peers.delete(peerId);
  }

  async hasPeer(peerId) {
    return this.peers.has(peerId);
  }

  async getPeerCount() {
    return this.peers.size;
  }

  // Session operations
  async getSession(token) {
    const session = this.sessions.get(token);
    if (!session) return null;

    // Check if session has expired
    const now = Date.now();
    if (now - session.lastSeen > SESSION_EXPIRY_SECONDS * 1000) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  async setSession(token, data) {
    this.sessions.set(token, data);
  }

  async updateSessionLastSeen(token) {
    const session = this.sessions.get(token);
    if (session) {
      session.lastSeen = Date.now();
    }
  }

  async updateSessionRoom(token, roomId) {
    const session = this.sessions.get(token);
    if (session) {
      session.roomId = roomId;
    }
  }

  async deleteSession(token) {
    this.sessions.delete(token);
  }

  async cleanupExpiredSessions() {
    const now = Date.now();
    const expired = [];

    for (const [token, session] of this.sessions) {
      if (now - session.lastSeen > SESSION_EXPIRY_SECONDS * 1000) {
        expired.push({ token, session });
        this.sessions.delete(token);
      }
    }

    return expired;
  }
}

/**
 * Redis storage implementation
 */
class RedisStorage {
  constructor() {
    this.client = null;
  }

  async connect() {
    // Build Redis URL with optional authentication
    const authPart = REDIS_PASSWORD ? `:${REDIS_PASSWORD}@` : '';
    const url = `redis://${authPart}${REDIS_HOST}:${REDIS_PORT}`;

    logger.info({
      host: REDIS_HOST,
      port: REDIS_PORT,
      authenticated: !!REDIS_PASSWORD
    }, 'Connecting to Redis');

    this.client = createClient({ url });

    this.client.on('error', (err) => {
      logger.error({ error: err.message }, 'Redis client error');
    });

    this.client.on('reconnecting', () => {
      logger.warn('Redis client reconnecting');
    });

    await this.client.connect();
    logger.info('Connected to Redis');
    return true;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
    }
  }

  // Room operations
  async getRoom(roomId) {
    const data = await this.client.hGetAll(KEYS.room(roomId));
    if (!data || Object.keys(data).length === 0) return null;
    return {
      hostPeerId: data.hostPeerId || null,
      createdAt: data.createdAt ? parseInt(data.createdAt, 10) : Date.now(),
    };
  }

  async setRoom(roomId, data) {
    const key = KEYS.room(roomId);
    const hashData = {};

    if (data.hostPeerId !== undefined) {
      hashData.hostPeerId = data.hostPeerId || '';
    }
    if (data.createdAt !== undefined) {
      hashData.createdAt = String(data.createdAt);
    }

    if (Object.keys(hashData).length > 0) {
      await this.client.hSet(key, hashData);
    }
  }

  async deleteRoom(roomId) {
    await this.client.del(KEYS.room(roomId));
    await this.client.del(KEYS.roomMembers(roomId));
  }

  async getRoomMembers(roomId) {
    return await this.client.sMembers(KEYS.roomMembers(roomId));
  }

  async addRoomMember(roomId, peerId) {
    await this.client.sAdd(KEYS.roomMembers(roomId), peerId);
  }

  async removeRoomMember(roomId, peerId) {
    await this.client.sRem(KEYS.roomMembers(roomId), peerId);
  }

  async getRoomCount() {
    const keys = await this.client.keys('dicebox:room:*');
    // Filter out member keys
    return keys.filter(k => !k.includes(':members')).length;
  }

  async getAllRoomIds() {
    const keys = await this.client.keys('dicebox:room:*');
    return keys
      .filter(k => !k.includes(':members'))
      .map(k => k.replace('dicebox:room:', ''));
  }

  // Peer operations
  async getPeer(peerId) {
    const data = await this.client.hGetAll(KEYS.peer(peerId));
    if (!data || Object.keys(data).length === 0) return null;
    return {
      roomId: data.roomId || null,
      ip: data.ip || 'unknown',
      sessionToken: data.sessionToken || null,
    };
  }

  async setPeer(peerId, data) {
    const key = KEYS.peer(peerId);
    const hashData = {
      roomId: data.roomId || '',
      ip: data.ip || 'unknown',
      sessionToken: data.sessionToken || '',
    };
    await this.client.hSet(key, hashData);
  }

  async deletePeer(peerId) {
    await this.client.del(KEYS.peer(peerId));
  }

  async hasPeer(peerId) {
    return await this.client.exists(KEYS.peer(peerId)) === 1;
  }

  async getPeerCount() {
    const keys = await this.client.keys('dicebox:peer:*');
    return keys.length;
  }

  // Session operations
  async getSession(token) {
    const data = await this.client.hGetAll(KEYS.session(token));
    if (!data || Object.keys(data).length === 0) return null;
    return {
      peerId: data.peerId,
      roomId: data.roomId || null,
      lastSeen: parseInt(data.lastSeen, 10),
    };
  }

  async setSession(token, data) {
    const key = KEYS.session(token);
    const hashData = {
      peerId: data.peerId,
      roomId: data.roomId || '',
      lastSeen: String(data.lastSeen),
    };
    await this.client.hSet(key, hashData);
    // Set TTL for automatic expiry
    await this.client.expire(key, SESSION_EXPIRY_SECONDS);
  }

  async updateSessionLastSeen(token) {
    const key = KEYS.session(token);
    const exists = await this.client.exists(key);
    if (exists) {
      await this.client.hSet(key, 'lastSeen', String(Date.now()));
      // Refresh TTL
      await this.client.expire(key, SESSION_EXPIRY_SECONDS);
    }
  }

  async updateSessionRoom(token, roomId) {
    const key = KEYS.session(token);
    const exists = await this.client.exists(key);
    if (exists) {
      await this.client.hSet(key, 'roomId', roomId || '');
    }
  }

  async deleteSession(token) {
    await this.client.del(KEYS.session(token));
  }

  async cleanupExpiredSessions() {
    // Redis handles expiry automatically via TTL
    // This method is only needed for memory storage
    return [];
  }
}

/**
 * Create and return the appropriate storage instance
 */
function createStorage() {
  if (REDIS_HOST) {
    return new RedisStorage();
  }
  return new MemoryStorage();
}

module.exports = {
  createStorage,
  MemoryStorage,
  RedisStorage,
  SESSION_EXPIRY_SECONDS,
};
