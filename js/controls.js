const DEFAULT_BINDINGS = [
    {
        name: 'Player 1',
        forward: 'KeyW',
        backward: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        shoot: 'Space'
    },
    {
        name: 'Player 2',
        forward: 'ArrowUp',
        backward: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        shoot: 'Enter'
    },
    {
        name: 'Player 3',
        forward: 'KeyI',
        backward: 'KeyK',
        left: 'KeyJ',
        right: 'KeyL',
        shoot: 'KeyO'
    },
    {
        name: 'Player 4',
        forward: 'Numpad8',
        backward: 'Numpad5',
        left: 'Numpad4',
        right: 'Numpad6',
        shoot: 'Numpad0'
    }
];

const ACTION_LABELS = {
    forward: 'Forward',
    backward: 'Backward',
    left: 'Turn Left',
    right: 'Turn Right',
    shoot: 'Shoot'
};

class ControlsManager {
    constructor() {
        this.bindings = this.loadBindings();
        this.keysDown = new Set();
        this.listeningButton = null;
        this.listeningPlayer = -1;
        this.listeningAction = '';

        this.setupKeyListeners();
    }

    loadBindings() {
        const saved = localStorage.getItem('tankTroubleBindings');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                // fall through
            }
        }
        return JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    }

    saveBindings() {
        localStorage.setItem('tankTroubleBindings', JSON.stringify(this.bindings));
    }

    resetBindings() {
        this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
        this.saveBindings();
    }

    setupKeyListeners() {
        window.addEventListener('keydown', (e) => {
            if (this.listeningButton) {
                e.preventDefault();
                e.stopPropagation();
                this.bindings[this.listeningPlayer][this.listeningAction] = e.code;
                this.listeningButton.textContent = this.getKeyDisplayName(e.code);
                this.listeningButton.classList.remove('listening');
                this.listeningButton = null;
                this.saveBindings();
                return;
            }

            this.keysDown.add(e.code);

            // Prevent arrow key scrolling
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keysDown.delete(e.code);
        });

        // Clear keys on blur to prevent stuck keys
        window.addEventListener('blur', () => {
            this.keysDown.clear();
        });
    }

    applyInputToTank(playerIndex, tank) {
        const binding = this.bindings[playerIndex];
        if (!binding) return;

        tank.input.forward = this.keysDown.has(binding.forward);
        tank.input.backward = this.keysDown.has(binding.backward);
        tank.input.left = this.keysDown.has(binding.left);
        tank.input.right = this.keysDown.has(binding.right);

        if (this.keysDown.has(binding.shoot)) {
            tank.input.shoot = true;
        }
    }

    renderControlsUI(container) {
        container.innerHTML = '';

        for (let i = 0; i < 4; i++) {
            const binding = this.bindings[i];
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-controls';
            playerDiv.style.borderColor = PLAYER_COLORS[i];

            const nameRow = document.createElement('div');
            nameRow.className = 'control-row';
            const nameLabel = document.createElement('span');
            nameLabel.textContent = 'Name';
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'name-input';
            nameInput.value = binding.name;
            nameInput.maxLength = 12;
            nameInput.style.borderColor = PLAYER_COLORS[i];
            nameInput.style.color = PLAYER_COLORS[i];
            nameInput.addEventListener('change', () => {
                const val = nameInput.value.trim();
                this.bindings[i].name = val || `Player ${i + 1}`;
                nameInput.value = this.bindings[i].name;
                this.saveBindings();
            });
            nameRow.appendChild(nameLabel);
            nameRow.appendChild(nameInput);

            const title = document.createElement('h3');
            title.textContent = binding.name;
            title.style.color = PLAYER_COLORS[i];
            playerDiv.appendChild(title);
            playerDiv.appendChild(nameRow);

            for (const action of ['forward', 'backward', 'left', 'right', 'shoot']) {
                const row = document.createElement('div');
                row.className = 'control-row';

                const label = document.createElement('span');
                label.textContent = ACTION_LABELS[action];

                const btn = document.createElement('button');
                btn.className = 'key-bind';
                btn.textContent = this.getKeyDisplayName(binding[action]);
                btn.addEventListener('click', () => {
                    // Cancel previous listening
                    if (this.listeningButton) {
                        this.listeningButton.classList.remove('listening');
                        this.listeningButton.textContent = this.getKeyDisplayName(
                            this.bindings[this.listeningPlayer][this.listeningAction]
                        );
                    }

                    this.listeningButton = btn;
                    this.listeningPlayer = i;
                    this.listeningAction = action;
                    btn.textContent = 'Press a key...';
                    btn.classList.add('listening');
                });

                row.appendChild(label);
                row.appendChild(btn);
                playerDiv.appendChild(row);
            }

            container.appendChild(playerDiv);
        }
    }

    getKeyDisplayName(code) {
        const names = {
            'Space': 'Space',
            'Enter': 'Enter',
            'ShiftLeft': 'L-Shift',
            'ShiftRight': 'R-Shift',
            'ControlLeft': 'L-Ctrl',
            'ControlRight': 'R-Ctrl',
            'AltLeft': 'L-Alt',
            'AltRight': 'R-Alt',
            'ArrowUp': '\u2191',
            'ArrowDown': '\u2193',
            'ArrowLeft': '\u2190',
            'ArrowRight': '\u2192',
            'Backspace': 'Bksp',
            'Tab': 'Tab',
            'CapsLock': 'Caps',
            'Escape': 'Esc',
            'Delete': 'Del',
            'Insert': 'Ins',
            'Home': 'Home',
            'End': 'End',
            'PageUp': 'PgUp',
            'PageDown': 'PgDn',
            'Numpad0': 'Num0',
            'Numpad1': 'Num1',
            'Numpad2': 'Num2',
            'Numpad3': 'Num3',
            'Numpad4': 'Num4',
            'Numpad5': 'Num5',
            'Numpad6': 'Num6',
            'Numpad7': 'Num7',
            'Numpad8': 'Num8',
            'Numpad9': 'Num9',
            'NumpadAdd': 'Num+',
            'NumpadSubtract': 'Num-',
            'NumpadMultiply': 'Num*',
            'NumpadDivide': 'Num/',
            'NumpadEnter': 'NumEnter',
            'NumpadDecimal': 'Num.',
        };

        if (names[code]) return names[code];
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code.startsWith('F') && code.length <= 3) return code;
        return code;
    }
}

const PLAYER_COLORS = ['#e94560', '#4ecdc4', '#f5a623', '#a855f7'];
const AI_COLOR = '#6b7280';

function getPlayerNames(controlsManager) {
    return controlsManager.bindings.map(b => b.name);
}
