# Mesh Topology Refactoring Plan

## Overview

Refactor from star topology (host-based) to full mesh topology where all peers connect directly to each other. This eliminates host migration complexity and provides better fault tolerance.

**Key insight**: Dice rolling generates minimal data (~10KB/min per peer). Even with 10 participants, each peer only sends ~90KB/min outbound - trivial bandwidth. Mesh scales well for typical group sizes.

**Connection math:**
| Peers | Connections | Outbound/peer |
|-------|-------------|---------------|
| 4     | 6           | 30 KB/min     |
| 8     | 28          | 70 KB/min     |
| 10    | 45          | 90 KB/min     |
| 15    | 105         | 140 KB/min    |

---

## Phase 1: Simplify Message Types

**File: `public/js/message-router.js`**

Remove host/client distinction. New message types:

```javascript
export const MSG = {
  // Peer discovery & sync
  HELLO: 'hello',           // New peer announces itself with username
  WELCOME: 'welcome',       // Any peer responds with current state

  // Peer lifecycle (broadcast to all)
  PEER_JOINED: 'peer-joined',
  PEER_LEFT: 'peer-left',

  // Dice actions (broadcast to all)
  DICE_ROLL: 'dice-roll',   // Anyone can broadcast a roll
  DICE_GRAB: 'dice-grab',   // Peer grabbed a dice set
  DICE_DROP: 'dice-drop',   // Peer dropped a dice set
};
```

**Changes:**
- Remove `INTRODUCE` (replaced by `HELLO`)
- Remove `ROLL_DICE` (client->host) - just use `DICE_ROLL` for everyone
- Remove `GRAB_DICE`/`DROP_DICE` request messages - broadcast directly
- Remove `DICE_CONFIG` - config is now immutable
- Remove `HOST_LEAVING` - no more host migration
- Remove `DICE_HELD` - replace with `DICE_GRAB`/`DICE_DROP`

**Remove host/client handler distinction:**
```javascript
// Before
onHostMessage(type, handler)
onClientMessage(type, handler)

// After - single handler registry
onMessage(type, handler)
```

---

## Phase 2: Replace RoomHost with MeshState

**Delete: `public/js/room-host.js`**

**Create: `public/js/mesh-state.js`**

```javascript
export class MeshState extends EventTarget {
  constructor() {
    super();
    this.peers = new Map();      // peerId -> { username, connectedAt }
    this.rollHistory = [];       // Last N rolls
    this.diceConfig = null;      // Immutable, set at room creation
    this.holders = new Map();    // setId -> { peerId, username }
  }

  // State operations
  addPeer(peerId, username) { ... }
  removePeer(peerId) { ... }
  addRoll(roll) { ... }

  // Holder operations (local authority - first-come-first-served)
  tryGrab(setId, peerId, username) {
    if (this.holders.has(setId)) return false;
    this.holders.set(setId, { peerId, username });
    return true;
  }
  drop(setId, peerId) {
    const holder = this.holders.get(setId);
    if (holder?.peerId === peerId) {
      this.holders.delete(setId);
      return true;
    }
    return false;
  }
  clearAllHolders() { ... }

  // State snapshot for sync
  getSnapshot() {
    return {
      peers: Array.from(this.peers.entries()),
      rollHistory: this.rollHistory.slice(0, 50),
      diceConfig: this.diceConfig,
      holders: Array.from(this.holders.entries())
    };
  }

  loadSnapshot(snapshot) { ... }
}
```

---

## Phase 3: Update RoomManager for Mesh

**File: `public/js/room-manager.js`**

**Changes:**
- Remove `isHost` flag - all peers are equal
- Remove `hostPeerId` - no host concept
- Remove `myJoinOrder` - not needed for migration
- Add `connectedPeers` Set to track WebRTC connections
- Change `createRoom` to just initialize local state
- Change `joinRoom` to query room then connect to ALL peers

```javascript
export class RoomManager extends EventTarget {
  constructor() {
    super();
    this.roomId = null;
    this.username = null;
    this.meshState = new MeshState();
    this.connectedPeers = new Set();  // Active WebRTC connections
  }

  createRoom(roomId, username, myPeerId, serverConnected, diceConfig) {
    this.roomId = roomId;
    this.username = username;
    this.meshState.clear();
    this.meshState.setDiceConfig(diceConfig);
    this.meshState.addPeer(myPeerId, username);  // Add self

    if (serverConnected) {
      signalingClient.registerRoom(roomId);  // Not "host", just first peer
    }
  }

  joinRoom(roomId, username, serverConnected) {
    // Query room to get list of ALL peers, not just host
    signalingClient.queryRoom(roomId);
    // On response, connect to each peer via WebRTC
  }

  handleRoomInfo({ roomId, exists, peerIds }) {
    if (exists) {
      // Connect to EVERY peer in the room
      for (const peerId of peerIds) {
        webrtcManager.connectToPeer(peerId);
      }
    }
  }
}
```

---

## Phase 4: Update Server for Mesh

**File: `server.js`**

**Changes to room storage:**
```javascript
// Before: rooms stored hostPeerId
rooms.set(roomId, { hostPeerId, createdAt })

// After: rooms store all peer IDs
rooms.set(roomId, {
  peerIds: Set<string>,  // All peers in room
  diceConfig: object,    // Immutable config
  createdAt: number
})
```

**New/modified message handlers:**
- `register-room` (was `register-host`) - First peer registers room with config
- `join-room` - Add peer to room's peerIds set
- `leave-room` - Remove peer from set, close room if empty
- `query-room` - Return ALL peerIds, not just host

**Remove:**
- `claim-host` handler - no host migration
- Host disconnection logic - any peer leaving just removes them from set
- 30-second cleanup timer - room closes when last peer leaves

---

## Phase 5: Update App.js for Mesh

**File: `public/js/app.js`**

**Remove:**
- All `hostHandle*` methods
- All `clientHandle*` methods
- `handleHostLeavingMsg`
- `handleBecameHost`
- Host migration event handlers
- `this.migrationManager` usage

**Add unified handlers:**
```javascript
setupMessageHandlers() {
  this.messageRouter
    .onMessage(MSG.HELLO, (peerId, msg) => this.handleHello(peerId, msg))
    .onMessage(MSG.WELCOME, (peerId, msg) => this.handleWelcome(peerId, msg))
    .onMessage(MSG.PEER_JOINED, (peerId, msg) => this.handlePeerJoined(peerId, msg))
    .onMessage(MSG.PEER_LEFT, (peerId, msg) => this.handlePeerLeft(peerId, msg))
    .onMessage(MSG.DICE_ROLL, (peerId, msg) => this.handleDiceRoll(peerId, msg))
    .onMessage(MSG.DICE_GRAB, (peerId, msg) => this.handleDiceGrab(peerId, msg))
    .onMessage(MSG.DICE_DROP, (peerId, msg) => this.handleDiceDrop(peerId, msg));
}
```

**Connection flow (mesh):**
```javascript
// When WebRTC channel opens to ANY peer
onChannelOpen(peerId) {
  // Send HELLO to introduce ourselves
  this.messageRouter.sendToPeer(peerId, {
    type: MSG.HELLO,
    username: this.roomManager.username
  });

  // If we're new, request state from this peer
  if (!this.hasReceivedState) {
    this.messageRouter.sendToPeer(peerId, { type: 'request-state' });
  }
}

// When we receive HELLO
handleHello(peerId, { username }) {
  this.meshState.addPeer(peerId, username);
  this.peerList.addPeer(peerId, username, 'connected');

  // Broadcast to other peers that someone joined
  this.broadcast({ type: MSG.PEER_JOINED, peerId, username }, peerId);

  // Send current state if they need it
  // (Handled by request-state message)
}
```

**Dice roll flow (mesh):**
```javascript
handleLocalDiceRoll({ rollResults, total }) {
  const rollId = this.generateRollId();
  const roll = {
    setResults: this.buildSetResults(rollResults),
    total,
    rollId,
    timestamp: Date.now(),
    rollerPeerId: this.myPeerId,
    rollerUsername: this.username
  };

  // Add to local state
  this.meshState.addRoll(roll);
  this.meshState.clearAllHolders();

  // Broadcast to ALL peers
  this.broadcast({ type: MSG.DICE_ROLL, ...roll });

  // Update UI
  this.diceHistory.addRoll(roll);
  this.updateDiceRollerState();
}

handleDiceRoll(fromPeerId, roll) {
  // Deduplicate (in case we sent it)
  if (this.meshState.hasRoll(roll.rollId)) return;

  this.meshState.addRoll(roll);
  this.meshState.clearAllHolders();

  this.diceRoller.showRoll(roll.rollResults);
  this.diceHistory.addRoll(roll);
  this.updateDiceRollerState();
}
```

---

## Phase 6: Update WebRTC Manager

**File: `public/js/webrtc-manager.js`**

**Add:**
```javascript
// Broadcast to all connected peers
broadcast(message, excludePeerId = null) {
  for (const [peerId, conn] of this.connections) {
    if (peerId !== excludePeerId && conn.channel?.readyState === 'open') {
      conn.channel.send(JSON.stringify(message));
    }
  }
}

// Get list of connected peer IDs
getConnectedPeerIds() {
  return Array.from(this.connections.keys())
    .filter(id => this.connections.get(id).channel?.readyState === 'open');
}
```

---

## Phase 7: Delete Unused Files

**Delete:**
- `public/js/host-migration-manager.js` (114 lines)
- `public/js/room-host.js` (210 lines)

**Total removal: ~324 lines**

---

## Phase 8: Update Signaling Client

**File: `public/js/signaling-client.js`**

**Rename/simplify:**
- `registerHost` -> `registerRoom`
- `claimHost` -> Remove entirely

**Modify events:**
- `host-disconnected` -> `peer-disconnected` (server notifies when any peer leaves)
- Remove `claim-host-success`/`claim-host-failed`

---

## Implementation Order

1. **Server changes** - Update room storage and handlers
2. **Create MeshState** - New state management class
3. **Update message types** - Simplify MSG enum
4. **Update RoomManager** - Remove host concept
5. **Update App.js** - Unified message handlers
6. **Update WebRTC Manager** - Add broadcast helper
7. **Update Signaling Client** - Simplified protocol
8. **Delete old files** - Remove host-migration-manager.js, room-host.js
9. **Update room-view.js** - Remove host badge logic
10. **Testing** - Verify multi-peer scenarios

---

## Migration Notes

### Backward Compatibility
This is a breaking change. Old clients won't work with new server. Consider:
- Version the protocol
- Or just deploy as breaking change (acceptable for early-stage app)

### Race Conditions

**Dice grab conflicts:**
- Two peers grab same set simultaneously
- Solution: First-write-wins with timestamp. If conflict detected, later grab is rejected and UI reverts.

**Roll while grabbing:**
- Peer A grabs set, Peer B rolls before receiving grab message
- Solution: Include holder info in roll message. Receivers update holder state atomically.

### State Consistency

With mesh, eventual consistency is acceptable because:
1. Dice rolls are commutative (order doesn't affect game state)
2. Config is immutable (no conflicts possible)
3. Grab/drop are idempotent (grabbing already-held set = no-op)

---

## Estimated Impact

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Core JS lines | ~2100 | ~1700 | -400 (~19%) |
| Message types | 11 | 7 | -4 |
| Connection complexity | O(n) star | O(n²) mesh | Fine for typical group sizes |
| Single point of failure | Yes (host) | No | Improved |
| Migration code | 114 lines | 0 | -100% |

**Scaling notes:** Mesh works well up to ~15-20 peers. Beyond that, consider SFU (Selective Forwarding Unit) architecture. For a dice app, this limit is rarely a concern.

---

## Files Changed Summary

| File | Action | Notes |
|------|--------|-------|
| `server.js` | Modify | Room storage, remove host logic |
| `message-router.js` | Modify | Simplify message types |
| `mesh-state.js` | Create | Replace room-host.js |
| `room-manager.js` | Modify | Remove host concept |
| `app.js` | Modify | Unified handlers |
| `webrtc-manager.js` | Modify | Add broadcast |
| `signaling-client.js` | Modify | Simplify protocol |
| `room-host.js` | Delete | Replaced by mesh-state |
| `host-migration-manager.js` | Delete | Not needed |
| `room-view.js` | Modify | Remove host badge |
| `index.html` | Modify | Remove settings button |
