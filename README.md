# DiceBox

A peer-to-peer dice rolling web application where friends can join a common room and roll dice together in real-time.

## Features

- **Room-based gameplay**: Create or join rooms using simple room codes
- **Host-based P2P**: First player becomes host, manages room state
- **Host migration**: If host leaves, next player automatically takes over
- **Multiple dice types**: d4, d6, d8, d10, d12, d20, d100
- **Roll multiple dice**: Roll up to 10 dice at once
- **Real-time sync**: See everyone's rolls instantly via WebRTC
- **Roll history**: Track all rolls from all players
- **No account required**: Just pick a name and join

## Tech Stack

- **Frontend**: Vanilla JavaScript with Web Components
- **Backend**: Minimal Node.js WebSocket signaling server (ICE broker only)
- **Communication**: WebRTC for peer-to-peer data channels
- **Styling**: CSS with custom properties

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Signaling Server                         │
│              (Minimal ICE Broker + Room Registry)           │
│                                                             │
│  Only tracks: roomId -> hostPeerId                          │
│  Only handles: ICE signaling, room queries, host claims     │
└─────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
        │ WebSocket          │ WebSocket          │ WebSocket
        │ (signaling)        │ (signaling)        │ (signaling)
        ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   HOST      │◄────►│   Peer B    │      │   Peer C    │
│  (Peer A)   │      │             │      │             │
│             │◄─────────────────────────►│             │
│ Room State: │      └─────────────┘      └─────────────┘
│ - Peer list │              ▲                    ▲
│ - History   │              │    WebRTC          │
│ - Join order│              └────────────────────┘
└─────────────┘
       │
       └──── All game state managed by HOST
             Broadcast via WebRTC data channels
```

### How It Works

1. **Server Role** (Minimal):
   - Assigns peer IDs to connecting clients
   - Tracks which peer is host for each room
   - Relays WebRTC signaling (offers, answers, ICE candidates)
   - That's it - no game logic, no state

2. **Host Role** (First player to create room):
   - Maintains authoritative room state (peer list, roll history)
   - Accepts new peer connections
   - Broadcasts state changes to all peers
   - Assigns join order for migration priority

3. **Client Role** (Players who join existing room):
   - Connects to host via WebRTC
   - Sends dice rolls to host for broadcast
   - Receives state updates from host
   - Tracks join order for potential migration

4. **Host Migration**:
   - When host leaves gracefully: sends state + next host ID to all peers
   - When host disconnects unexpectedly: peer with lowest join order claims host
   - New host registers with server via `claim-host` message
   - Other peers reconnect to new host

## Getting Started

### Prerequisites

- Node.js 16+
- npm

### Installation

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The server will start on `http://localhost:3000`

### Usage

1. Open `http://localhost:3000` in your browser
2. Enter your name
3. Enter a room code or use the auto-generated one
4. Share the room code with friends
5. Start rolling dice!

### Keyboard Shortcuts

- Press `R` to roll dice (when not in an input field)

## Project Structure

```
dicebox/
├── server.js                   # Minimal WebSocket ICE broker
├── package.json
├── public/
│   ├── index.html              # Main HTML page
│   ├── css/
│   │   └── styles.css          # Application styles
│   └── js/
│       ├── app.js              # Main application logic
│       ├── signaling-client.js # WebSocket client for signaling
│       ├── webrtc-manager.js   # WebRTC connection manager
│       ├── room-host.js        # Room state management (host side)
│       └── components/
│           ├── room-join.js    # Room join form
│           ├── room-view.js    # Main room interface
│           ├── dice-roller.js  # Dice rolling component
│           ├── dice-history.js # Roll history display
│           └── peer-list.js    # Connected players list
```

## P2P Message Protocol

### Host -> Peers
- `welcome` - Initial state sync when peer joins (peer list, roll history)
- `peer-joined` - New peer connected to room
- `peer-left` - Peer disconnected from room
- `dice-roll` - Broadcast dice roll result
- `host-leaving` - Host migration info (next host, state snapshot)

### Peers -> Host
- `introduce` - Peer sends username after connecting
- `roll-dice` - Peer requests dice roll broadcast

## Web Components

The UI is built entirely with native Web Components (Custom Elements):

- `<room-join>`: Login/join form
- `<room-view>`: Main room container (shows HOST badge when hosting)
- `<dice-roller>`: Dice selection and rolling interface
- `<dice-history>`: Chronological roll history
- `<peer-list>`: Connected players display

## License

MIT
