# DiceBox

A peer-to-peer dice rolling web application where friends can join a common room and roll dice together in real-time.

## Features

- **Room-based gameplay**: Create or join rooms using simple room codes
- **Multiple dice types**: d4, d6, d8, d10, d12, d20, d100
- **Roll multiple dice**: Roll up to 10 dice at once
- **Real-time sync**: See everyone's rolls instantly via WebRTC
- **Roll history**: Track all rolls from all players
- **No account required**: Just pick a name and join

## Tech Stack

- **Frontend**: Vanilla JavaScript with Web Components
- **Backend**: Node.js WebSocket signaling server
- **Communication**: WebRTC for peer-to-peer data channels
- **Styling**: CSS with custom properties

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────────┐
│   Browser   │◄──────────────────►│ Signaling Server│
│   (Peer A)  │                    │   (Node.js)     │
└──────┬──────┘                    └─────────────────┘
       │                                    ▲
       │ WebRTC DataChannel                 │
       │                                    │
       ▼                                    │
┌─────────────┐     WebSocket              │
│   Browser   │◄───────────────────────────┘
│   (Peer B)  │
└─────────────┘
```

The signaling server only handles:
- Room management (join/leave)
- WebRTC connection establishment (offer/answer/ICE candidates)
- Dice roll broadcasts (as fallback and for reliability)

Once peers are connected, they can communicate directly via WebRTC data channels.

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
├── server.js              # WebSocket signaling server
├── package.json
├── public/
│   ├── index.html         # Main HTML page
│   ├── css/
│   │   └── styles.css     # Application styles
│   └── js/
│       ├── app.js              # Main application logic
│       ├── signaling-client.js # WebSocket client
│       ├── webrtc-manager.js   # WebRTC connection manager
│       └── components/
│           ├── room-join.js    # Room join form
│           ├── room-view.js    # Main room interface
│           ├── dice-roller.js  # Dice rolling component
│           ├── dice-history.js # Roll history display
│           └── peer-list.js    # Connected players list
```

## Web Components

The UI is built entirely with native Web Components (Custom Elements):

- `<room-join>`: Login/join form
- `<room-view>`: Main room container
- `<dice-roller>`: Dice selection and rolling interface
- `<dice-history>`: Chronological roll history
- `<peer-list>`: Connected players display

## License

MIT
