const firebaseConfig = {
  apiKey: "AIzaSyDwcgtD_WKhml0vGt1ii9tByNPHwgBzNK4",
  authDomain: "lobito-impostor-e2ab8.firebaseapp.com",
  databaseURL: "https://lobito-impostor-e2ab8-default-rtdb.firebaseio.com",
  projectId: "lobito-impostor-e2ab8",
  storageBucket: "lobito-impostor-e2ab8.firebasestorage.app",
  messagingSenderId: "948913846005",
  appId: "1:948913846005:web:033b835c10dd2db432f7bc"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const app = {
    roomId: null, playerId: null, nickname: null, isHost: false, players: {}, gameData: null, 
    words: [], joined: false,
    backgrounds: ['./assets/fondo1.webp', './assets/fondo2.webp', './assets/fondo3.webp', './assets/Ondas doradas de luz resplandeciente.webp'],

    init() { 
        this.handlePreloader();
        try {
            const storedId = localStorage.getItem('playerId');
            if (storedId) this.playerId = storedId;
            else { this.playerId = 'p_' + Math.random().toString(36).substr(2, 9); localStorage.setItem('playerId', this.playerId); }
        } catch(e) { this.playerId = 'p_' + Math.random().toString(36).substr(2, 9); }

        this.setRandomBackground();
        this.syncWordsFromFirebase(); 
        initMatrixRain(); 

        try { 
            const stored = localStorage.getItem('nickname'); 
            const input = document.getElementById('input-nickname'); 
            if (input && stored) input.value = stored; 
            
            const storedRoom = localStorage.getItem('lastRoom');
            const inputRoom = document.getElementById('input-room-code');
            if (inputRoom && storedRoom) inputRoom.value = storedRoom;
        } catch(e) {}

        try {
            const cb = document.getElementById('check-impostor-word');
            const lb = document.getElementById('label-impostor');
            const sync = () => { if (!cb || !lb) return; if (cb.checked) lb.classList.add('checked'); else lb.classList.remove('checked'); };
            if (cb) {
                cb.tabIndex = 0;
                cb.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cb.checked = !cb.checked; playSound('click'); sync(); } });
                cb.addEventListener('change', sync);
                sync();
            }
        } catch(e){}

        try {
            this.cleanupEmptyRooms();
            db.ref('rooms').on('child_changed', snap => {
                const r = snap.val(); if (!r) return;
                const players = r.players || {};
                const playerIds = Object.keys(players);
                const anyOnline = playerIds.some(pid => players[pid] && players[pid].online === true);
                
                if (playerIds.length === 0) {
                    if (snap.key !== this.roomId) {
                        db.ref('rooms/' + snap.key).remove().catch(e => {});
                    }
                }
            });
        } catch(e) { console.warn('cleanup scheduler failed', e); }

        try {
            const lastRoom = localStorage.getItem('lastRoom');
            const storedNick = localStorage.getItem('nickname');
            const explicitLeave = localStorage.getItem('explicitLeave');
            if (explicitLeave) { localStorage.removeItem('explicitLeave'); localStorage.removeItem('lastRoom'); }
            else if (lastRoom) {
                db.ref('rooms/' + lastRoom).once('value', s => {
                    if (s.exists()) {
                        const room = s.val();
                        if (room.players && room.players[this.playerId]) {
                            if (!this.nickname && storedNick) this.nickname = storedNick;
                            this.roomId = lastRoom;
                            this.showScreen('screen-lobby');
                            this.joinRoomProcess();
                        } else {
                            localStorage.removeItem('lastRoom');
                        }
                    } else {
                        localStorage.removeItem('lastRoom');
                    }
                });
            }
        } catch(e) {}
    },

    strSimilarity(a, b) {
        if(!a || !b) return 0;
        a = a.toLowerCase(); b = b.toLowerCase();
        const setA = new Set(a.replace(/\s+/g, ''));
        const setB = new Set(b.replace(/\s+/g, ''));
        let common = 0; setA.forEach(ch => { if(setB.has(ch)) common++; });
        return common / ((setA.size + setB.size) / 2);
    },

    getImpostorVariant(pair, pool) {
        const target = (pair.palabra || '').toLowerCase();
        const candidates = pool.map(p => p.impostor).filter(x => x && x.toLowerCase() !== (pair.impostor || '').toLowerCase());
        for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
        for (const c of candidates) {
            const sim = this.strSimilarity(target, c.toLowerCase());
            if (sim >= 0.18 && sim <= 0.6) return c;
        }
        let base = pair.impostor || pair.palabra || '??';
        const vowels = ['a','e','i','o','u','á','é','í','ó','ú'];
        let variant = base;
        for (let i=0;i<base.length-1;i++) {
            if (!vowels.includes(base[i].toLowerCase()) && !vowels.includes(base[i+1].toLowerCase())) {
                const arr = base.split(''); const t = arr[i]; arr[i]=arr[i+1]; arr[i+1]=t; variant = arr.join(''); break;
            }
        }
        if (this.strSimilarity(target, variant.toLowerCase()) > 0.75 || variant === base) {
            let changed = base.split('');
            for (let i=0;i<changed.length;i++) { const lc = changed[i].toLowerCase(); if (vowels.includes(lc)) { const repl = vowels[Math.floor(Math.random()*vowels.length)]; changed[i] = (changed[i] === lc) ? repl : repl.toUpperCase(); break; } }
            variant = changed.join('');
        }
        if (this.strSimilarity(target, variant.toLowerCase()) > 0.85) variant = base + 'o';
        return variant;
    },

    toggleImpostorGuide() {
        try {
            const cb = document.getElementById('check-impostor-word'); const lb = document.getElementById('label-impostor');
            if (!cb) return; cb.checked = !cb.checked; playSound('click'); if (lb) { if (cb.checked) lb.classList.add('checked'); else lb.classList.remove('checked'); }
        } catch(e) { console.warn(e); }
    },

    async generateUniqueRoomId() {
        let id = null;
        for (let i=0;i<10;i++) {
            id = Math.random().toString(36).substr(2, 4).toUpperCase();
            const snap = await db.ref('rooms/' + id).once('value');
            if (!snap.exists()) return id;
        }
        return 'R' + Date.now().toString(36).substr(4).toUpperCase();
    },

    setRandomBackground() {
        const bg = this.backgrounds[Math.floor(Math.random() * this.backgrounds.length)];
        const bgElement = document.getElementById('bgImage');
        if (bgElement) bgElement.style.backgroundImage = `url('${bg}')`;
    },

    async syncWordsFromFirebase() {
        db.ref('words').on('value', s => {
            const data = s.val();
            if (data) { this.words = Array.isArray(data) ? data : Object.values(data); }
            else {
                console.warn('No words found in Firebase.');
                this.words = [];
                this.populateCategories();
                return;
            }
            this.populateCategories();
        });
    },

    populateCategories() {
        const select = document.getElementById('select-category'); if (!select) return;
        const cats = [...new Set(this.words.map(w => w.categoria))].filter(c => c);
        let html = '<option value="Todo">🌐 Todas las categorías</option>';
        cats.forEach(c => html += `<option value="${c}">${c}</option>`);
        select.innerHTML = html;
    },

    copyAIPrompt() {
        const p = `Genera un listado de 30 pares de palabras para "Impostor" en formato CSV simple (Punto y coma). Palabra Agente ; Palabra Impostor ; Categoría ; Dificultad (Fácil, Medio o Difícil). Sin encabezados.`;
        navigator.clipboard.writeText(p).then(() => alert("¡Prompt copiado!"));
    },

    async cleanSyntheticWords() {
        if (!this.isHost) return alert('Solo el Host puede limpiar palabras.');
        if (!confirm('Eliminar palabras sintéticas?')) return;
        try {
            const snap = await db.ref('words').once('value');
            const data = snap.val();
            if (!data) return alert('No hay palabras');
            const arr = Array.isArray(data) ? data : Object.values(data);
            const filtered = arr.filter(w => {
                const a = (w.palabra || '').toString(); const b = (w.impostor || '').toString();
                if (/\d/.test(a) || /\d/.test(b)) return false;
                return true;
            });
            await db.ref('words').set(filtered);
            alert(`Limpieza completada.`);
        } catch (e) { console.error(e); }
    },

    async loadWordsManual() {
        const txt = prompt("Pega el CSV (Separado por ;):");
        if (!txt) return;
        const added = [];
        txt.trim().split('\n').forEach(line => {
            const parts = line.split(';').map(p => p.trim());
            if (parts.length >= 2 && !this.words.some(w => w.palabra.toLowerCase() === parts[0].toLowerCase())) {
                added.push({ palabra: parts[0], impostor: parts[1], categoria: parts[2] || "General", dificultad: parts[3] || "Medio" });
            }
        });
        if (added.length > 0) { await db.ref('words').set([...this.words, ...added]); alert(`¡Éxito! Se añadieron ${added.length} palabras.`); }
    },

    async createRoom() {
        this.nickname = document.getElementById('input-nickname').value.trim(); if (!this.nickname) return alert("Nombre!");
        this.cleanupEmptyRooms();
        this.roomId = await this.generateUniqueRoomId(); this.isHost = true;
        this.showScreen('screen-lobby');
        localStorage.setItem('nickname', this.nickname);
        localStorage.setItem('lastRoom', this.roomId);
        db.ref('rooms/' + this.roomId).set({ status: 'lobby', hostId: this.playerId, usedPairs: null }).then(() => this.joinRoomProcess());
    },

    joinRoom() {
        this.nickname = document.getElementById('input-nickname').value.trim();
        this.roomId = document.getElementById('input-room-code').value.trim().toUpperCase();
        if (!this.nickname || !this.roomId) return alert("Faltan datos");
        
        db.ref('rooms/' + this.roomId).once('value', s => {
            if (!s.exists()) { alert("La sala no existe"); return; }
            const roomData = s.val();
            if (!roomData.players || Object.keys(roomData.players).length === 0) {
                db.ref('rooms/' + this.roomId).remove();
                alert("La sala estaba vacía y ha sido eliminada.");
                return;
            }
            this.cleanupEmptyRooms();
            this.showScreen('screen-lobby');
            this.joinRoomProcess();
        });
    },

    clearIdentity() {
        try {
            localStorage.removeItem('nickname');
            localStorage.removeItem('lastRoom');
            localStorage.removeItem('playerId');
            localStorage.setItem('explicitLeave','1');
            if (this.joined && this.roomId) {
                this.removePlayerAndMaybeRoom(this.roomId, this.playerId).then(() => { 
                    location.reload();
                });
                return;
            }
            location.reload();
        } catch(e) { location.reload(); }
    },

    joinRoomProcess() {
        const ref = db.ref('rooms/' + this.roomId + '/players/' + this.playerId);
        ref.once('value', s => {
            const sc = (s.val() && s.val().score) || 0;
            const existingJoined = (s.val() && s.val().joinedAt) ? s.val().joinedAt : Date.now();
            ref.update({ name: this.nickname, online: true, score: sc, joinedAt: existingJoined }).then(() => {
                localStorage.setItem('nickname', this.nickname);
                localStorage.setItem('lastRoom', this.roomId);
                this.joined = true; this.listenToRoom();
            });
        });
        ref.onDisconnect().update({ online: false });
        document.getElementById('player-identity-banner').style.display = 'flex';
        document.getElementById('banner-name').innerHTML = `<span class="role">AGENTE:</span><span class="name">${this.nickname.toUpperCase()}</span>`;
    },

    async removePlayerAndMaybeRoom(roomId, playerId) {
        try {
            await db.ref('rooms/' + roomId + '/players/' + playerId).remove();
            const snap = await db.ref('rooms/' + roomId + '/players').once('value');
            if (!snap.exists()) {
                await db.ref('rooms/' + roomId).remove();
            }
        } catch(e) {}
    },

    listenToRoom() {
        db.ref('rooms/' + this.roomId).on('value', s => {
            const data = s.val(); if (!data) return;
            const playersInRoom = data.players || {};
            if (this.joined && !playersInRoom[this.playerId]) { location.reload(); return; }
            this.players = playersInRoom; this.gameState = data.status; this.gameData = data.gameData;
            this.isHost = (data.hostId === this.playerId);
            const hostName = playersInRoom[data.hostId]?.name || "HOST";
            const hNL = document.getElementById('host-nickname-lobby'); if(hNL) hNL.innerText = hostName;
            const hNR = document.getElementById('host-nickname-results'); if(hNR) hNR.innerText = hostName.toUpperCase();

            if (this.gameData) {
                const isI = this.playerId === this.gameData.impostorId;
                document.getElementById('reminder-role').innerText = isI ? "IMPOSTOR" : "AGENTE";
                // Aseguramos que se use category o el nombre del campo en español como fallback
                const cat = this.gameData.category || this.gameData.categoria || "General";
                document.getElementById('reminder-category').innerText = cat.toUpperCase();
                document.getElementById('reminder-word').innerText = isI ? this.gameData.impostorWord : this.gameData.word;
            }
            
            if (this.gameState === 'playing') {
                const onlinePlayers = Object.values(playersInRoom).filter(p => p && p.online === true);
                if (onlinePlayers.length > 0 && onlinePlayers.every(p => p.revealed)) {
                    const latestReveal = Math.max(...onlinePlayers.map(p => p.revealedAt || 0));
                    if (Date.now() - latestReveal <= 20000 && !this._autoDebateTimer) {
                        this._autoDebateTimer = setTimeout(() => {
                            if (this.isHost && this.gameState === 'playing') db.ref('rooms/' + this.roomId).update({ status: 'debate' });
                            this._autoDebateTimer = null;
                        }, 5000);
                    }
                }
            } else {
                if (this._autoDebateTimer) { clearTimeout(this._autoDebateTimer); this._autoDebateTimer = null; }
            }

            this.updateLobby();
            if (this.gameState === 'lobby') { this.showScreen('screen-lobby'); document.getElementById('role-card').classList.remove('flipped'); }
            if (this.gameState === 'playing') this.startReveal(data.gameData);
            if (this.gameState === 'debate') this.handleDebate(data.gameData);
            if (this.gameState === 'voting') this.startVoting(data.gameData);
            if (this.gameState === 'results') this.showResults(data.results, data.gameData);
            
            this.manageBots(data.gameData);
            
            document.getElementById('display-room-code').innerText = this.roomId;
            document.getElementById('host-controls').style.display = this.isHost ? 'block' : 'none';
            document.getElementById('guest-waiting').style.display = !this.isHost ? 'block' : 'none';
            const hbc = document.getElementById('host-bottom-controls'); if (hbc) hbc.style.display = this.isHost ? 'block' : 'none';
        });
    },

    updateLobby() {
        const list = document.getElementById('lobby-players-list'); list.innerHTML = '';
        const ids = Object.keys(this.players).sort((a,b) => (this.players[b].score || 0) - (this.players[a].score || 0));
        const rankLabels = ['🥇', '🥈', '🥉'];
        ids.forEach((id, i) => {
            const p = this.players[id]; const div = document.createElement('div'); div.className = 'player-tag' + (id === this.playerId ? ' is-me' : '');
            const medal = i < 3 ? `<span>${rankLabels[i]}</span>` : `<span style="color:#555; font-size:0.7rem;">${i+1}°</span>`;
            let k = (this.isHost && id !== this.playerId) ? `<span onclick="app.kickPlayer('${id}')" style="margin-left:10px; color:var(--accent-red); cursor:pointer;">×</span>` : '';
            div.innerHTML = `${medal} ${p.name} <span class="score-badge">${p.score || 0} pts</span>${k}`; list.appendChild(div);
        });
        document.getElementById('player-count').innerText = ids.length;
    },

    updateMiniScores(elementId) {
        const list = document.getElementById(elementId); if (!list) return;
        list.innerHTML = '';
        const ids = Object.keys(this.players).sort((a,b) => (this.players[b].score || 0) - (this.players[a].score || 0));
        ids.forEach(id => {
            const p = this.players[id];
            const div = document.createElement('div');
            div.style.cssText = `background: rgba(255,255,255,0.03); padding: 4px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); font-size: 0.6rem; font-weight: 700; color: ${id === this.playerId ? 'var(--accent-green)' : 'rgba(255,255,255,0.6)'}`;
            div.innerHTML = `${p.name} <span style="color:var(--accent-gold);">${p.score || 0}</span>`;
            list.appendChild(div);
        });
    },

    kickPlayer(id) { if (confirm(`Expulsar?`)) this.removePlayerAndMaybeRoom(this.roomId, id); },
    
    addBots() {
        const names = ["Agente Alfa 🤖", "Agente Beta 🤖", "Infiltrado X 🤖", "Sombra 🤖", "Protocolo 0 🤖"];
        const count = 2; // Añadir 2 bots
        for(let i=0; i<count; i++) {
            const botId = 'bot_' + Math.random().toString(36).substr(2, 5);
            const name = names[Math.floor(Math.random()*names.length)] + " " + (i+1);
            db.ref('rooms/' + this.roomId + '/players/' + botId).set({ name, online: true, score: 0, isBot: true, joinedAt: Date.now() + (i*100) });
        }
        playSound('reveal');
    },

    manageBots(gd) {
        if (!this.isHost || !gd) return;
        const bots = Object.keys(this.players).filter(id => this.players[id].isBot);
        if (bots.length === 0) return;

        bots.forEach(bid => {
            const p = this.players[bid];
            // 1. Revelar carta
            if (this.gameState === 'playing' && !p.revealed) {
                if (!this['_bot_rev_' + bid]) {
                    this['_bot_rev_' + bid] = setTimeout(() => {
                        db.ref('rooms/' + this.roomId + '/players/' + bid).update({ revealed: true, revealedAt: firebase.database.ServerValue.TIMESTAMP });
                        this['_bot_rev_' + bid] = null;
                    }, 2000 + Math.random()*3000);
                }
            }
            // 2. Hablar en Debate
            if (this.gameState === 'debate') {
                const turnOrder = gd.turnOrder || [], activeIdx = gd.activeTurnIndex || 0;
                if (turnOrder[activeIdx] === bid) {
                    if (!this['_bot_deb_' + bid]) {
                        this['_bot_deb_' + bid] = setTimeout(() => {
                            const botWords = ["Interesante...", "Tengo mis dudas.", "Mmm, ya veo.", "Lo sospechaba.", "Prosiga.", "Anotado.", "Entendido.", "...", "Analizando datos."];
                            const word = botWords[Math.floor(Math.random()*botWords.length)];
                            db.ref('rooms/' + this.roomId + '/gameData/textWords/' + bid).set([word]);
                            db.ref('rooms/' + this.roomId + '/gameData/activeTurnIndex').set(activeIdx + 1);
                            this['_bot_deb_' + bid] = null;
                        }, 2000 + Math.random()*2000);
                    }
                }
                // 3. Votar Consenso (SÍ)
                if (activeIdx >= turnOrder.length && p.readyToVote === null) {
                    db.ref('rooms/' + this.roomId + '/players/' + bid).update({ readyToVote: true });
                }
            }
            // 4. Votar al sospechoso
            if (this.gameState === 'voting' && !p.vote && bid !== gd.impostorId) {
                if (!this['_bot_vot_' + bid]) {
                    this['_bot_vot_' + bid] = setTimeout(() => {
                        const candidates = Object.keys(this.players).filter(id => id !== bid);
                        const target = candidates[Math.floor(Math.random()*candidates.length)];
                        db.ref('rooms/' + this.roomId + '/players/' + bid).update({ vote: target });
                        this['_bot_vot_' + bid] = null;
                    }, 3000 + Math.random()*4000);
                }
            }
        });
    },

    startDebateManually() { db.ref('rooms/' + this.roomId).update({ status: 'debate' }); },
    
    async startGame() {
        if (Object.keys(this.players).length < 3) return alert("Mínimo 3 agentes");
        const cat = document.getElementById('select-category').value, diff = document.getElementById('select-difficulty').value, impHasWord = document.getElementById('check-impostor-word').checked;
        let pool = this.words.filter(w => (cat === 'Todo' || w.categoria === cat) && (diff === 'Todo' || w.dificultad === diff));
        if (pool.length === 0) pool = this.words;

        const roomRef = db.ref('rooms/' + this.roomId);
        const usedSnap = await roomRef.child('usedPairs').once('value');
        let combined = usedSnap.val() || [];
        let available = pool.filter(p => !combined.includes(p.palabra + '::' + p.impostor));
        if (available.length === 0) {
            combined = [];
            available = pool.slice();
        }
        const pair = available[Math.floor(Math.random() * available.length)];
        combined.push(pair.palabra + '::' + pair.impostor);
        await roomRef.child('usedPairs').set(combined);

        const ids = Object.keys(this.players), impId = ids[Math.floor(Math.random() * ids.length)];
        let impostorWord = impHasWord ? pair.impostor : "??? (SIN PALABRA)";
        
        let lastJoinedId = ids.reduce((a,b) => ((this.players[a]?.joinedAt||0) > (this.players[b]?.joinedAt||0) ? a : b), ids[0]);
        const rest = ids.filter(id => id !== lastJoinedId).sort(() => Math.random() - 0.5);
        let turnOrder = [lastJoinedId, ...rest];
        if (!impHasWord && turnOrder[0] === impId) {
            const tmp = turnOrder[1]; turnOrder[1] = turnOrder[0]; turnOrder[0] = tmp;
        }

        const updates = { status: 'playing', gameData: { word: pair.palabra, impostorWord: impostorWord, impostorId: impId, category: pair.categoria, turnOrder: turnOrder, activeTurnIndex: 0 }, results: null };
        ids.forEach(id => { updates[`players/${id}/vote`] = null; updates[`players/${id}/readyToVote`] = null; updates[`players/${id}/revealed`] = null; });
        await db.ref('rooms/' + this.roomId).update(updates);
    },

    startReveal(gd) {
        this.showScreen('screen-reveal');
        const isI = this.playerId === gd.impostorId;
        document.getElementById('role-card-back').className = 'card-back' + (isI ? ' impostor-theme' : '');
        document.getElementById('role-title').innerText = isI ? "IMPOSTOR" : "AGENTE"; 
        document.getElementById('role-word').innerText = isI ? gd.impostorWord : gd.word; 
        document.getElementById('role-hint').innerText = isI ? "No te dejes descubrir." : `ÁREA: ${gd.category}`;
        
        const list = document.getElementById('reveal-status-list'); list.innerHTML = '';
        for (let id in this.players) { 
            const p = this.players[id]; 
            const div = document.createElement('div');
            div.className = 'reveal-player-card' + (p.revealed ? ' is-ready' : '');
            div.innerHTML = `<div class="status-indicator"></div><div class="reveal-player-name">${p.name}</div><div class="score-badge">${p.score || 0} pts</div>`;
            list.appendChild(div); 
        }
        document.getElementById('host-reveal-controls').style.display = this.isHost ? 'block' : 'none';
        document.getElementById('guest-reveal-msg').style.display = !this.isHost ? 'block' : 'none';
    },

    revealRole() { 
        if (!document.getElementById('role-card').classList.contains('flipped')) { 
            document.getElementById('role-card').classList.add('flipped'); 
            db.ref('rooms/' + this.roomId + '/players/' + this.playerId).update({ revealed: true, revealedAt: firebase.database.ServerValue.TIMESTAMP }); 
            playSound(this.playerId === this.gameData?.impostorId ? 'impostor' : 'reveal'); 
        } 
    },

    async guessWord() {
        const input = document.getElementById('input-guess-word'), guess = (input.value || '').trim().toLowerCase();
        if (!guess) return;
        const secretWord = (this.gameData?.word || '').toLowerCase();
        const isCorrect = guess === secretWord;

        if (isCorrect) {
            const updates = { status: 'results', results: { win: false, impGuessWin: true, impName: this.players[this.gameData.impostorId].name } };
            for (let id in this.players) {
                let s = this.players[id].score || 0;
                if (id === this.gameData.impostorId) s += 20;
                updates[`players/${id}/score`] = s;
            }
            await db.ref('rooms/' + this.roomId).update(updates);
        } else {
            const impId = this.gameData.impostorId;
            // Obtenemos el puntaje más fresco posible de la base de datos
            db.ref('rooms/' + this.roomId + '/players/' + impId + '/score').transaction(currentScore => {
                return Math.max(0, (currentScore || 0) - 20);
            });
            
            const feedback = document.getElementById('guess-feedback');
            if(feedback) {
                feedback.innerText = "❌ Palabra incorrecta. -20 pts";
                setTimeout(() => { if(feedback) feedback.innerText = ""; }, 3000);
            }
            input.value = '';
            playSound('fail');
        }
        playSound('click');
    },

    handleDebate(gd) {
        this.showScreen('screen-debate');
        const turnOrder = gd.turnOrder || [], activeIdx = gd.activeTurnIndex || 0, activeId = turnOrder[activeIdx], isMy = activeId === this.playerId;
        const isImp = this.playerId === gd.impostorId;
        const list = document.getElementById('debate-order-list'); list.innerHTML = '';
        turnOrder.forEach((id, idx) => {
            const p = this.players[id]; if (!p) return;
            const div = document.createElement('div'); div.className = 'debate-item' + (idx === activeIdx ? ' active' : '');
            const wordsArr = gd.textWords?.[id] || [];
            let wordsHtml = wordsArr.length ? `<div class="words-inline"><span class="word-icon">💬</span> ${wordsArr.map(w => `<span class="word-inline">${w}</span>`).join(', ')}</div>` : '';
            div.innerHTML = `<div style="display:flex; align-items:center; gap:12px;"><div style="width:12px; height:12px; border-radius:50%; background:${idx === activeIdx ? 'var(--accent-gold)' : (wordsArr.length ? 'var(--accent-green)' : '#333')};"></div><span class="player-name">${p.name}</span></div>${wordsHtml}`;
            list.appendChild(div);
        });
        const rZ = document.getElementById('recording-zone'), wM = document.getElementById('waiting-turn-msg'), cZ = document.getElementById('consensus-zone'), iGZ = document.getElementById('impostor-guess-zone');
        if (iGZ) iGZ.style.display = isImp ? 'block' : 'none';
        this.updateMiniScores('debate-scores-list');

        if (activeIdx < turnOrder.length) { 
            cZ.style.display = 'none'; rZ.style.display = isMy ? 'block' : 'none'; 
            wM.style.display = isMy ? 'none' : 'block'; 
            wM.innerText = `HABLA ${this.players[activeId]?.name}...`; 
        }
        else { 
            rZ.style.display = 'none'; wM.style.display = isImp ? 'block' : 'none'; 
            if (isImp) wM.innerText = "AGENTES DECIDIENDO VOTACIÓN...";
            cZ.style.display = isImp ? 'none' : 'flex'; 
            this.updateConsensusUI(); 
        }
    },

    async sendTextWord() { 
        const input = document.getElementById('input-debate-word'), word = input.value.trim(); 
        if (!word) return; 
        const ref = db.ref('rooms/' + this.roomId);
        const snap = await ref.child('gameData/textWords/' + this.playerId).once('value');
        const arr = snap.exists() ? (Array.isArray(snap.val()) ? snap.val() : [snap.val()]) : [];
        arr.push(word);
        await ref.child('gameData/textWords/' + this.playerId).set(arr);
        const idxSnap = await ref.child('gameData/activeTurnIndex').once('value');
        await ref.child('gameData/activeTurnIndex').set((idxSnap.val() || 0) + 1);
        input.value = ''; playSound('click'); 
    },

    setConsensus(v) { db.ref('rooms/' + this.roomId + '/players/' + this.playerId).update({ readyToVote: v }); playSound('click'); },
    
    updateConsensusUI() {
        let ry = 0, rt = 0;
        const agents = Object.keys(this.players).filter(id => id !== this.gameData.impostorId);
        agents.forEach(id => { 
            const p = this.players[id];
            if (p.readyToVote === true) ry++; 
            if (p.readyToVote === false) rt++; 
        });
        document.getElementById('consensus-status').innerText = `${ry} SÍ / ${rt} NO`;
        if (this.isHost && ry > agents.length / 2) db.ref('rooms/' + this.roomId).update({ status: 'voting' });
        else if (this.isHost && rt >= agents.length / 2) setTimeout(() => this.resetTurns(), 1000);
    },

    resetTurns() { 
        db.ref('rooms/' + this.roomId + '/gameData').update({ activeTurnIndex: 0 }); 
        for (let id in this.players) db.ref('rooms/' + this.roomId + '/players/' + id).update({ readyToVote: null }); 
    },
    
    startVoting(gd) {
        this.showScreen('screen-voting');
        const isImp = this.playerId === gd.impostorId;
        const list = document.getElementById('voting-list'); list.innerHTML = '';
        let agents = Object.keys(this.players).filter(id => id !== gd.impostorId);
        let votesCount = agents.filter(id => this.players[id].vote).length;
        document.getElementById('votes-received').innerText = votesCount; 
        document.getElementById('votes-total').innerText = agents.length;
        if (isImp) { 
            list.innerHTML = '<div class="status-msg" style="color:var(--accent-red)">ERES EL IMPOSTOR. ESPERA...</div>'; 
        } else { 
            for (let id in this.players) { 
                if (id === this.playerId) continue; 
                const btn = document.createElement('button'); 
                btn.className = 'vote-btn' + (this.players[this.playerId].vote === id ? ' voted-for' : ''); 
                btn.innerHTML = `${this.players[id].name} <span>VOTAR</span>`; 
                btn.onclick = () => { db.ref('rooms/' + this.roomId + '/players/' + this.playerId).update({ vote: id }); playSound('click'); }; 
                list.appendChild(btn); 
            } 
        }
        this.updateMiniScores('voting-scores-list');
        if (this.isHost && votesCount === agents.length) this.processResults(gd);
    },

    processResults(gd) {
        const t = {}; 
        for (let id in this.players) { 
            if(id === gd.impostorId) continue; 
            const v = this.players[id].vote; 
            if(v) t[v] = (t[v] || 0) + 1; 
        }
        let max = 0, vid = null, tie = false;
        for (let id in t) { if (t[id] > max) { max = t[id]; vid = id; tie = false; } else if (t[id] === max) tie = true; }
        const win = !tie && vid === gd.impostorId;
        const updates = { status: 'results', results: { win, impName: this.players[gd.impostorId].name } };
        for (let id in this.players) { 
            let s = this.players[id].score || 0; 
            if (id === gd.impostorId) { if (!win) s += 20; } 
            else { if (this.players[id].vote === gd.impostorId) s += 10; } 
            updates[`players/${id}/score`] = s; 
        }
        db.ref('rooms/' + this.roomId).update(updates);
    },

    showResults(res, gd) {
        this.showScreen('screen-results');
        const sortedPlayers = Object.entries(this.players).map(([id, p]) => ({ id, name: p.name, score: p.score || 0 })).sort((a, b) => b.score - a.score);
        const rankLabels = ['1er', '2do', '3er'];
        const rankClasses = ['rank-1', 'rank-2', 'rank-3'];
        
        let statusText = res.win ? '🎯 Misión Cumplida' : (res.impGuessWin ? '💀 Golpe del Impostor' : '💀 Misión Fallida');
        
        let scoresHTML = sortedPlayers.map((p, i) => {
            const rClass = i < 3 ? rankClasses[i] : 'rank-other';
            const label = i < 3 ? rankLabels[i] : `${i+1}to`;
            return `<div class="score-row ${i < 3 ? 'rank-row-'+(i+1) : ''}" ${p.id === this.playerId ? 'style="border-left:2px solid var(--accent-green)"' : ''}>
                <div class="rank-badge ${rClass}">${label}</div><span style="flex:1; text-align:left;">${p.name}</span><span style="color:var(--accent-gold); font-weight:900;">${p.score} pts</span>
            </div>`;
        }).join('');

        document.getElementById('result-display').innerHTML = `
            <div style="font-size:24px; font-weight:900;">${statusText}</div>
            <div style="font-size:32px; color: var(--accent-red); margin: 10px 0;">${res.impName}</div>
            <div style="display:flex; gap:20px; justify-content:center; margin-bottom: 20px;">
                <div>Agentes: <span style="color:var(--accent-blue)">${gd.word}</span></div>
                <div>Impostor: <span style="color:var(--accent-red)">${gd.impostorWord}</span></div>
            </div>
            ${scoresHTML}`;
        
        if(res.win) launchConfetti(); 
        playSound(res.win ? 'success' : 'fail');
        document.getElementById('results-host-controls').style.display = this.isHost ? 'block' : 'none';
        document.getElementById('results-guest-controls').style.display = !this.isHost ? 'block' : 'none';
        ['nc-tl','nc-tr','nc-bl','nc-br'].forEach(id => document.getElementById(id).style.opacity = '1');
    },

    async newGameKeepPlayers() {
        await db.ref('rooms/' + this.roomId).transaction(r => {
            if (!r) return r;
            r.status = 'lobby'; r.gameData = null; r.results = null;
            if (r.players) {
                for (const pid in r.players) {
                    r.players[pid].vote = null; r.players[pid].readyToVote = null; r.players[pid].revealed = null;
                }
            }
            return r;
        });
        ['nc-tl','nc-tr','nc-bl','nc-br'].forEach(id => document.getElementById(id).style.opacity = '0');
    },

    exitGameFromResults() {
        if (confirm("¿Salir?")) {
            localStorage.setItem('explicitLeave','1');
            this.removePlayerAndMaybeRoom(this.roomId, this.playerId).then(() => { localStorage.removeItem('lastRoom'); location.reload(); });
        }
    },

    async cleanupEmptyRooms() {
        try {
            const snap = await db.ref('rooms').once('value');
            const rooms = snap.val(); if (!rooms) return;
            for (const id in rooms) {
                if (!rooms[id].players) await db.ref('rooms/' + id).remove();
            }
        } catch (e) {}
    },

    exitGame() {
        if (confirm("¿Seguro?")) {
            localStorage.setItem('explicitLeave','1');
            if (this.joined) this.removePlayerAndMaybeRoom(this.roomId, this.playerId).then(() => { localStorage.removeItem('lastRoom'); location.reload(); });
            else location.reload();
        }
    },

    toggleSecret() { const o = document.getElementById('secret-overlay'); o.style.display = o.style.display === 'block' ? 'none' : 'block'; },
    
    handlePreloader() {
        const preloader = document.getElementById('preloader');
        const bar = document.getElementById('loader-bar');
        if (!preloader || !bar) return;
        
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                setTimeout(() => {
                    preloader.style.opacity = '0';
                    setTimeout(() => preloader.style.display = 'none', 500);
                }, 500);
            }
            bar.style.width = progress + '%';
        }, 150);
    },

    showScreen(id) {
        document.querySelectorAll('.container').forEach(s => { s.style.display = 'none'; s.classList.remove('screen-appear'); });
        const el = document.getElementById(id); if (!el) return;
        el.style.display = 'flex'; void el.offsetWidth; el.classList.add('screen-appear');

        // Cambio dinámico de fondo al cambiar de pantalla
        this.setRandomBackground();

        const aurora = document.getElementById('aurora-layer');
        const particles = document.getElementById('particles-layer');
        const grid = document.getElementById('grid-overlay');
        
        if (id === 'screen-start') {
            if(aurora) aurora.style.opacity = '1';
            if(particles) particles.style.opacity = '0';
            if(grid) grid.style.display = 'none';
        } else {
            if(aurora) aurora.style.opacity = '0';
            if(grid) grid.style.display = 'block';
            spawnParticles(12);
        }
        if (id === 'screen-start') playSound('reveal');
    }
};

function spawnParticles(count) {
    const layer = document.getElementById('particles-layer'); if (!layer) return;
    layer.innerHTML = ''; layer.style.opacity = '1';
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div'); p.className = 'particle';
        p.style.cssText = `width:4px; height:4px; left:${Math.random()*100}%; background:rgba(0,243,255,0.4); animation-duration:${Math.random()*10+5}s;`;
        layer.appendChild(p);
    }
}

function initMatrixRain() {
    const c = document.getElementById('matrixCanvas'), ctx = c.getContext('2d');
    let fontSize = 14, columns = 0, drops = [];
    function setup() { c.width = window.innerWidth; c.height = window.innerHeight; columns = Math.floor(c.width/fontSize); drops = new Array(columns).fill(1); }
    setup(); window.addEventListener('resize', setup);
    function d() {
        ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(0,0,c.width,c.height);
        ctx.fillStyle = '#00f3ff'; ctx.font = fontSize + 'px monospace';
        for (let i = 0; i < drops.length; i++) {
            ctx.fillText(String.fromCharCode(0x30A0 + Math.random()*96), i*fontSize, drops[i]*fontSize);
            if (drops[i]*fontSize > c.height && Math.random() > 0.975) drops[i] = 0;
            drops[i]++;
        }
    }
    setInterval(d, 50);
}

function launchConfetti() {
    const colors = ['#ff003c', '#00f3ff', '#39ff14', '#b400ff', '#ffe600'];
    for(let i=0; i<50; i++) {
        const c = document.createElement('div'); c.className = 'confetti'; c.style.left = Math.random()*100+'vw';
        c.style.backgroundColor = colors[Math.floor(Math.random()*colors.length)];
        c.style.width = (Math.random()*8+4)+'px'; c.style.height = c.style.width;
        c.style.animationDuration = (Math.random()*2+2)+'s';
        document.body.appendChild(c); setTimeout(() => c.remove(), 4000);
    }
}

function playSound(t) {
    const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination); g.gain.value = 0.05;
    if(t==='reveal') { o.frequency.value = 800; o.start(); o.stop(ac.currentTime+0.2); }
    if(t==='impostor') { o.type = 'sawtooth'; o.frequency.value = 150; o.start(); o.stop(ac.currentTime+0.4); }
    if(t==='click') { o.frequency.value = 1000; o.start(); o.stop(ac.currentTime+0.05); }
    if(t==='success') { o.frequency.value = 600; o.start(); o.stop(ac.currentTime+0.5); }
    if(t==='fail') { o.frequency.value = 100; o.start(); o.stop(ac.currentTime+0.3); }
}

app.init();
window.app = app;
