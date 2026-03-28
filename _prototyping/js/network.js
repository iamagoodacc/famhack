// P2P networking using PeerJS
// Host is authoritative: runs game simulation, broadcasts state to clients.
// Clients send their input to host and receive game state back.

class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = []; // host: connections to clients; client: [connection to host]
        this.isHost = false;
        this.roomCode = '';
        this.playerName = 'Player';
        this.playerSlot = -1; // which player index this client is

        // Lobby state (host tracks all players)
        this.players = []; // [{name, slot, connId}]

        // Callbacks
        this.onPlayersChanged = null;
        this.onGameStart = null;
        this.onGameState = null;  // client receives game state
        this.onPlayerInput = null; // host receives player input
        this.onDisconnect = null;
        this.onError = null;
        this.onRoundOver = null;
        this.onGameOver = null;

        this.PREFIX = 'tanktrouble-';
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 5; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    // HOST: Create a room
    hostGame(playerName, callback) {
        this.isHost = true;
        this.playerName = playerName;
        this.roomCode = this.generateRoomCode();
        const peerId = this.PREFIX + this.roomCode;

        this.peer = new Peer(peerId);

        this.peer.on('open', () => {
            // Add host as player 0
            this.players = [{ name: playerName, slot: 0, connId: null }];
            this.playerSlot = 0;
            if (callback) callback(null, this.roomCode);
            if (this.onPlayersChanged) this.onPlayersChanged(this.players);
        });

        this.peer.on('connection', (conn) => {
            if (this.players.length >= 4) {
                conn.on('open', () => {
                    conn.send({ type: 'error', message: 'Room is full' });
                    setTimeout(() => conn.close(), 500);
                });
                return;
            }

            conn.on('open', () => {
                // Wait for join message with player name
            });

            conn.on('data', (data) => {
                if (data.type === 'join') {
                    const slot = this.getNextSlot();
                    const player = { name: data.name, slot: slot, connId: conn.peer };
                    this.players.push(player);
                    this.connections.push(conn);

                    // Tell the new client their slot and current players
                    conn.send({ type: 'joined', slot: slot, players: this.players });

                    // Tell all other clients about updated players
                    this.broadcastPlayers();
                    if (this.onPlayersChanged) this.onPlayersChanged(this.players);
                } else if (data.type === 'input') {
                    if (this.onPlayerInput) this.onPlayerInput(data.slot, data.input);
                }
            });

            conn.on('close', () => {
                this.removeConnection(conn);
            });

            conn.on('error', () => {
                this.removeConnection(conn);
            });
        });

        this.peer.on('error', (err) => {
            if (callback) callback(err.message);
            if (this.onError) this.onError(err.message);
        });
    }

    getNextSlot() {
        const taken = new Set(this.players.map(p => p.slot));
        for (let i = 0; i < 4; i++) {
            if (!taken.has(i)) return i;
        }
        return -1;
    }

    removeConnection(conn) {
        this.connections = this.connections.filter(c => c !== conn);
        const idx = this.players.findIndex(p => p.connId === conn.peer);
        if (idx > -1) {
            this.players.splice(idx, 1);
            this.broadcastPlayers();
            if (this.onPlayersChanged) this.onPlayersChanged(this.players);
        }
    }

    broadcastPlayers() {
        for (const conn of this.connections) {
            try {
                conn.send({ type: 'players', players: this.players });
            } catch (e) { /* ignore */ }
        }
    }

    // HOST: Start the game - tell all clients
    startOnlineGame(mazeSize) {
        // Generate maze seed so all clients produce the same maze
        const seed = Math.floor(Math.random() * 1000000);
        const startMsg = {
            type: 'gameStart',
            playerCount: this.players.length,
            players: this.players,
            mazeSize: mazeSize,
            seed: seed
        };

        for (const conn of this.connections) {
            try { conn.send(startMsg); } catch (e) { /* ignore */ }
        }

        if (this.onGameStart) this.onGameStart(startMsg);
    }

    // HOST: Broadcast game state to all clients
    broadcastState(state) {
        for (const conn of this.connections) {
            try { conn.send({ type: 'state', state: state }); } catch (e) { /* ignore */ }
        }
    }

    // HOST: Broadcast round/game over
    broadcastRoundOver(detail, scores, playerCount, names) {
        const msg = { type: 'roundOver', detail, scores, playerCount, names };
        for (const conn of this.connections) {
            try { conn.send(msg); } catch (e) { /* ignore */ }
        }
        if (this.onRoundOver) this.onRoundOver(detail, scores, playerCount, names);
    }

    broadcastGameOver(detail) {
        const msg = { type: 'gameOver', detail };
        for (const conn of this.connections) {
            try { conn.send(msg); } catch (e) { /* ignore */ }
        }
        if (this.onGameOver) this.onGameOver(detail);
    }

    // HOST: Broadcast next round
    broadcastNextRound(seed) {
        const msg = { type: 'nextRound', seed };
        for (const conn of this.connections) {
            try { conn.send(msg); } catch (e) { /* ignore */ }
        }
    }

    // CLIENT: Join a room
    joinGame(roomCode, playerName, callback) {
        this.isHost = false;
        this.playerName = playerName;
        this.roomCode = roomCode.toUpperCase();
        const hostId = this.PREFIX + this.roomCode;

        this.peer = new Peer();

        this.peer.on('open', () => {
            const conn = this.peer.connect(hostId, { reliable: true });
            this.connections = [conn];

            conn.on('open', () => {
                conn.send({ type: 'join', name: playerName });
            });

            conn.on('data', (data) => {
                if (data.type === 'joined') {
                    this.playerSlot = data.slot;
                    this.players = data.players;
                    if (callback) callback(null, data.slot);
                    if (this.onPlayersChanged) this.onPlayersChanged(this.players);
                } else if (data.type === 'players') {
                    this.players = data.players;
                    if (this.onPlayersChanged) this.onPlayersChanged(this.players);
                } else if (data.type === 'gameStart') {
                    if (this.onGameStart) this.onGameStart(data);
                } else if (data.type === 'state') {
                    if (this.onGameState) this.onGameState(data.state);
                } else if (data.type === 'roundOver') {
                    if (this.onRoundOver) this.onRoundOver(data.detail, data.scores, data.playerCount, data.names);
                } else if (data.type === 'gameOver') {
                    if (this.onGameOver) this.onGameOver(data.detail);
                } else if (data.type === 'nextRound') {
                    if (this.onGameStart) this.onGameStart({ type: 'nextRound', seed: data.seed });
                } else if (data.type === 'error') {
                    if (callback) callback(data.message);
                }
            });

            conn.on('close', () => {
                if (this.onDisconnect) this.onDisconnect();
            });

            conn.on('error', (err) => {
                if (callback) callback(err.message || 'Connection error');
            });
        });

        this.peer.on('error', (err) => {
            if (callback) callback('Could not connect: ' + (err.message || err.type));
        });
    }

    // CLIENT: Send input to host
    sendInput(input) {
        if (this.connections.length > 0 && this.connections[0].open) {
            try {
                this.connections[0].send({
                    type: 'input',
                    slot: this.playerSlot,
                    input: input
                });
            } catch (e) { /* ignore */ }
        }
    }

    destroy() {
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connections = [];
        this.players = [];
    }
}
