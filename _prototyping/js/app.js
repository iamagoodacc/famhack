// Main application - ties everything together
(function () {
    const controlsManager = new ControlsManager();
    const canvas = document.getElementById('game-canvas');
    let game = null;
    let network = null;

    // Screen navigation
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }

    function hideOverlays() {
        document.querySelectorAll('.overlay').forEach(o => o.classList.remove('active'));
    }

    // PvP setup state
    let pvpPlayerCount = 2;
    let pvpMazeSize = 'medium';

    // PvE setup state
    let pvePlayerCount = 1;
    let pveMazeSize = 'medium';

    // Online setup state
    let onlineMazeSize = 'medium';

    // Main menu
    document.getElementById('btn-pvp').addEventListener('click', () => showScreen('pvp-setup'));
    document.getElementById('btn-pve').addEventListener('click', () => showScreen('pve-setup'));
    document.getElementById('btn-online').addEventListener('click', () => {
        // Pre-fill name from P1 binding
        document.getElementById('online-name').value = controlsManager.bindings[0].name;
        showScreen('online-setup');
    });
    document.getElementById('btn-controls').addEventListener('click', () => {
        controlsManager.renderControlsUI(document.getElementById('controls-container'));
        showScreen('controls-setup');
    });

    // Back buttons
    document.querySelectorAll('.btn-back').forEach(btn => {
        btn.addEventListener('click', () => showScreen('main-menu'));
    });

    // PvP player count
    document.querySelectorAll('.count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            pvpPlayerCount = parseInt(btn.dataset.count);
        });
    });

    // PvP maze size
    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            pvpMazeSize = btn.dataset.size;
        });
    });

    // PvE player count
    document.querySelectorAll('.count-btn-pve').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.count-btn-pve').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            pvePlayerCount = parseInt(btn.dataset.count);
        });
    });

    // PvE maze size
    document.querySelectorAll('.size-btn-pve').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.size-btn-pve').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            pveMazeSize = btn.dataset.size;
        });
    });

    // Online maze size
    document.querySelectorAll('.size-btn-online').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.size-btn-online').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            onlineMazeSize = btn.dataset.size;
        });
    });

    function startGame(mode, playerCount, mazeSize) {
        hideOverlays();
        showScreen('game-screen');
        game = new Game(canvas, controlsManager);
        // setTimeout ensures the browser has laid out the game-screen before we measure
        setTimeout(() => {
            game.start(mode, playerCount, mazeSize);
        }, 50);
    }

    // Start PvP
    document.getElementById('btn-start-pvp').addEventListener('click', () => {
        startGame('pvp', pvpPlayerCount, pvpMazeSize);
    });

    // Start PvE
    document.getElementById('btn-start-pve').addEventListener('click', () => {
        startGame('pve', pvePlayerCount, pveMazeSize);
    });

    // ==================== ONLINE MULTIPLAYER ====================

    function renderLobbyPlayers(players, containerId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        for (const p of players) {
            const div = document.createElement('div');
            div.className = 'lobby-player';
            const dot = document.createElement('div');
            dot.className = 'lobby-player-dot';
            dot.style.background = PLAYER_COLORS[p.slot];
            const name = document.createElement('span');
            name.textContent = p.name;
            name.style.color = PLAYER_COLORS[p.slot];
            div.appendChild(dot);
            div.appendChild(name);
            container.appendChild(div);
        }
    }

    // Host game
    document.getElementById('btn-host').addEventListener('click', () => {
        const playerName = document.getElementById('online-name').value.trim() || 'Host';
        if (network) network.destroy();
        network = new NetworkManager();

        document.getElementById('lobby-status').textContent = 'Creating room...';
        document.getElementById('lobby-room-code').textContent = '';
        document.getElementById('lobby-players').innerHTML = '';
        document.getElementById('btn-lobby-start').disabled = true;
        showScreen('online-lobby');

        network.onPlayersChanged = (players) => {
            renderLobbyPlayers(players, 'lobby-players');
            document.getElementById('btn-lobby-start').disabled = players.length < 2;
            document.getElementById('lobby-status').textContent =
                `${players.length}/4 players - Share the room code!`;
        };

        network.onRoundOver = (detail, scores, playerCount, names) => {
            showRoundOver(detail, scores, playerCount, names);
        };

        network.hostGame(playerName, (err, roomCode) => {
            if (err) {
                document.getElementById('lobby-status').textContent = 'Error: ' + err;
                return;
            }
            document.getElementById('lobby-room-code').textContent = roomCode;
            document.getElementById('lobby-status').textContent =
                '1/4 players - Share the room code!';
        });
    });

    // Start online game (host only)
    document.getElementById('btn-lobby-start').addEventListener('click', () => {
        if (!network || !network.isHost) return;
        network.startOnlineGame(onlineMazeSize);
    });

    // Cancel hosting
    document.getElementById('btn-lobby-cancel').addEventListener('click', () => {
        if (network) { network.destroy(); network = null; }
        showScreen('online-setup');
    });

    // Show join screen
    document.getElementById('btn-join-show').addEventListener('click', () => {
        document.getElementById('join-status').textContent = '';
        document.getElementById('join-code').value = '';
        showScreen('online-join');
    });

    // Join game
    document.getElementById('btn-join-connect').addEventListener('click', () => {
        const code = document.getElementById('join-code').value.trim().toUpperCase();
        if (!code || code.length < 3) {
            document.getElementById('join-status').textContent = 'Enter a valid room code';
            return;
        }

        const playerName = document.getElementById('online-name').value.trim() || 'Player';
        if (network) network.destroy();
        network = new NetworkManager();

        document.getElementById('join-status').textContent = 'Connecting...';

        network.onPlayersChanged = (players) => {
            renderLobbyPlayers(players, 'waiting-players');
            document.getElementById('waiting-status').textContent =
                `${players.length}/4 players - Waiting for host to start...`;
        };

        network.onGameStart = (data) => {
            startOnlineGame(data);
        };

        network.onGameState = (state) => {
            if (game && game instanceof OnlineGame) {
                game.remoteState = state;
            }
        };

        network.onRoundOver = (detail, scores, playerCount, names) => {
            if (game) game.running = false;
            showRoundOver(detail, scores, playerCount, names);
        };

        network.onGameOver = (detail) => {
            if (game) game.running = false;
            showGameOver(detail);
        };

        network.onDisconnect = () => {
            if (game) game.stop();
            hideOverlays();
            showScreen('main-menu');
            alert('Disconnected from host');
        };

        network.joinGame(code, playerName, (err, slot) => {
            if (err) {
                document.getElementById('join-status').textContent = 'Error: ' + err;
                return;
            }
            showScreen('online-waiting');
        });
    });

    // Leave waiting room
    document.getElementById('btn-waiting-cancel').addEventListener('click', () => {
        if (network) { network.destroy(); network = null; }
        showScreen('online-setup');
    });

    function startOnlineGame(data) {
        hideOverlays();
        showScreen('game-screen');

        game = new OnlineGame(canvas, controlsManager, network);

        if (network.isHost) {
            // Host sets up callbacks for receiving remote input
            network.onPlayerInput = (slot, input) => {
                if (game && game instanceof OnlineGame) {
                    game.remoteInputs[slot] = input;
                }
            };

            network.onGameState = null; // host doesn't receive state

            network.onRoundOver = (detail, scores, playerCount, names) => {
                if (game) game.running = false;
                showRoundOver(detail, scores, playerCount, names);
            };
        }

        setTimeout(() => {
            game.start('pvp', data.playerCount || network.players.length,
                        data.mazeSize || onlineMazeSize, data.seed);
        }, 50);
    }

    // Host game start callback
    function setupHostGameStartCallback() {
        if (network && network.isHost) {
            network.onGameStart = (data) => {
                startOnlineGame(data);
            };
        }
    }

    // Re-setup after host button
    const origHostClick = document.getElementById('btn-host');
    const origOnClick = origHostClick._origHandler;
    // The host callback is set inside btn-host click, so we hook onGameStart after hostGame
    const origBtnLobbyStart = document.getElementById('btn-lobby-start');
    origBtnLobbyStart.addEventListener('click', () => {
        // Setup the callback right before starting
        if (network && network.isHost) {
            network.onGameStart = (data) => {
                startOnlineGame(data);
            };
        }
    }, true); // capture phase, runs before the other handler

    // ==================== END ONLINE ====================

    // Pause / Resume
    document.getElementById('btn-pause').addEventListener('click', () => {
        if (game && game.running) {
            game.pause();
            document.getElementById('pause-overlay').classList.add('active');
        }
    });

    document.getElementById('btn-resume').addEventListener('click', () => {
        document.getElementById('pause-overlay').classList.remove('active');
        if (game) game.resume();
    });

    // Escape key for pause
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
            const pauseOverlay = document.getElementById('pause-overlay');
            if (pauseOverlay.classList.contains('active')) {
                pauseOverlay.classList.remove('active');
                if (game) game.resume();
            } else if (game && game.running && !game.paused) {
                game.pause();
                pauseOverlay.classList.add('active');
            }
        }
    });

    // Quit buttons
    function quitToMenu() {
        hideOverlays();
        if (game) {
            game.stop();
            game = null;
        }
        if (network) {
            network.destroy();
            network = null;
        }
        showScreen('main-menu');
    }

    document.getElementById('btn-quit').addEventListener('click', quitToMenu);
    document.getElementById('btn-quit-round').addEventListener('click', quitToMenu);
    document.getElementById('btn-quit-gameover').addEventListener('click', quitToMenu);

    // Next round (PvP / Online)
    document.getElementById('btn-next-round').addEventListener('click', () => {
        hideOverlays();
        if (game) {
            if (game instanceof OnlineGame && network && network.isHost) {
                const seed = Math.floor(Math.random() * 1000000);
                network.broadcastNextRound(seed);
                game.setupRound(seed);
                game.running = true;
                game.lastTime = performance.now();
                requestAnimationFrame(game.boundLoop);
            } else if (!(game instanceof OnlineGame)) {
                game.nextRound();
            }
        }
    });

    // Retry (PvE)
    document.getElementById('btn-retry').addEventListener('click', () => {
        hideOverlays();
        if (game) {
            game.retry();
        }
    });

    // Reset controls
    document.getElementById('btn-reset-controls').addEventListener('click', () => {
        controlsManager.resetBindings();
        controlsManager.renderControlsUI(document.getElementById('controls-container'));
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        if (game && game.running) {
            game.renderer.resize();
            const size = MAZE_SIZES[game.mazeSize];
            const maxW = canvas.width - 40;
            const maxH = canvas.height - 40;
            game.cellSize = Math.floor(Math.min(maxW / size.cols, maxH / size.rows));
            game.cellSize = Math.max(game.cellSize, 40);
            game.offsetX = Math.floor((canvas.width - size.cols * game.cellSize) / 2);
            game.offsetY = Math.floor((canvas.height - size.rows * game.cellSize) / 2);
            game.walls = game.maze.getWallSegments(game.cellSize, game.offsetX, game.offsetY);
        }
    });
})();
