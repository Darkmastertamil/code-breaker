/**
 * game.js - Client-Side Controller & WebSocket Client for CODE BREAKER ⚡
 * 
 * Handles UI transitions, user inputs, validation, and real-time
 * communication with the authoritative game server.
 */

(function () {
  'use strict';

  // --- APPLICATION STATE ---
  const state = {
    ws: null,
    isConnected: false,
    roomCode: null,
    playerId: null,       // "p1" or "p2"
    playerName: null,     // "PLAYER 1" or "PLAYER 2"
    currentRound: 1,
    currentTurn: null,    // "p1" or "p2"
    p1Score: 0,
    p2Score: 0,
    myAttempts: 0,
    secretCodeDigits: ['', '', '', ''],
    guessDigits: ['', '', '', ''],
    isSecretLocked: false,
    rematchRequested: false
  };

  // --- DOM ELEMENT REFERENCES ---
  const el = {
    connectionIndicator: document.getElementById('connection-indicator'),
    connectionText: document.getElementById('connection-text'),
    toastContainer: document.getElementById('toast-container'),

    // Screens
    screenHome: document.getElementById('screen-home'),
    screenCreate: document.getElementById('screen-create'),
    screenJoin: document.getElementById('screen-join'),
    screenWaiting: document.getElementById('screen-waiting'),
    screenSecret: document.getElementById('screen-secret'),
    screenGame: document.getElementById('screen-game'),
    screenMatchResult: document.getElementById('screen-match-result'),

    // Modals
    modalRoundResult: document.getElementById('modal-round-result'),
    modalDisconnect: document.getElementById('modal-disconnect'),

    // Home actions
    btnHomeCreate: document.getElementById('btn-home-create'),
    btnHomeJoin: document.getElementById('btn-home-join'),

    // Create Room Screen
    createdRoomCode: document.getElementById('created-room-code'),
    btnCopyCode: document.getElementById('btn-copy-code'),
    btnCancelCreate: document.getElementById('btn-cancel-create'),

    // Join Room Screen
    inputRoomCode: document.getElementById('input-room-code'),
    joinErrorMsg: document.getElementById('join-error-msg'),
    btnSubmitJoin: document.getElementById('btn-submit-join'),
    btnCancelJoin: document.getElementById('btn-cancel-join'),

    // Waiting Screen
    lobbyRoomCode: document.getElementById('lobby-room-code'),
    rosterP2Status: document.getElementById('roster-p2-status'),
    lobbyCountdown: document.getElementById('lobby-countdown'),

    // Secret Code Screen
    secretRoundNum: document.getElementById('secret-round-num'),
    secretBoxes: [
      document.getElementById('secret-box-0'),
      document.getElementById('secret-box-1'),
      document.getElementById('secret-box-2'),
      document.getElementById('secret-box-3'),
    ],
    secretFeedbackHint: document.getElementById('secret-feedback-hint'),
    secretKeypad: document.getElementById('secret-keypad'),
    btnConfirmSecret: document.getElementById('btn-confirm-secret'),
    secretLockedNotice: document.getElementById('secret-locked-notice'),
    myLockedCode: document.getElementById('my-locked-code'),

    // Game Screen
    scoreP1: document.getElementById('score-p1'),
    scoreP2: document.getElementById('score-p2'),
    matchRoundLabel: document.getElementById('match-round-label'),
    gameRoomCode: document.getElementById('game-room-code'),
    gameRoomPill: document.getElementById('game-room-pill'),
    turnBanner: document.getElementById('turn-banner'),
    turnTitle: document.getElementById('turn-title'),
    turnSubtitle: document.getElementById('turn-subtitle'),
    attemptsBadge: document.getElementById('attempts-badge'),
    guessBoxes: [
      document.getElementById('guess-box-0'),
      document.getElementById('guess-box-1'),
      document.getElementById('guess-box-2'),
      document.getElementById('guess-box-3'),
    ],
    guessKeypad: document.getElementById('guess-keypad'),
    btnSubmitGuess: document.getElementById('btn-submit-guess'),
    guessHistoryList: document.getElementById('guess-history-list'),
    emptyHistoryMsg: document.getElementById('empty-history-msg'),

    // Round Result Modal
    roundWinnerText: document.getElementById('round-winner-text'),
    roundRevealedSecret: document.getElementById('round-revealed-secret'),
    roundAttemptsVal: document.getElementById('round-attempts-val'),
    summaryP1Score: document.getElementById('summary-p1-score'),
    summaryP2Score: document.getElementById('summary-p2-score'),
    btnNextRound: document.getElementById('btn-next-round'),
    nextRoundNum: document.getElementById('next-round-num'),

    // Match Result Screen
    matchWinnerTitle: document.getElementById('match-winner-title'),
    finalP1Score: document.getElementById('final-p1-score'),
    finalP2Score: document.getElementById('final-p2-score'),
    rematchStatusBanner: document.getElementById('rematch-status-banner'),
    btnRematch: document.getElementById('btn-rematch'),
    btnMatchHome: document.getElementById('btn-match-home'),

    // Disconnect Modal
    btnDisconnectHome: document.getElementById('btn-disconnect-home'),
  };

  // --- TOAST NOTIFICATIONS ---
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // --- SCREEN ROUTING ---
  function showScreen(screenEl) {
    const screens = [
      el.screenHome,
      el.screenCreate,
      el.screenJoin,
      el.screenWaiting,
      el.screenSecret,
      el.screenGame,
      el.screenMatchResult,
    ];

    screens.forEach(s => {
      if (s) {
        s.classList.remove('active-screen');
      }
    });

    if (screenEl) {
      screenEl.classList.add('active-screen');
    }

    // Always hide overlays on screen change unless explicitly opened
    el.modalRoundResult.classList.add('hidden');
    el.modalDisconnect.classList.add('hidden');
  }

  // --- WEBSOCKET CONNECTION ---
  function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  function initWebSocket(onOpenCallback) {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      if (state.ws.readyState === WebSocket.OPEN && onOpenCallback) {
        onOpenCallback();
      }
      return;
    }

    const wsUrl = getWebSocketUrl();
    try {
      state.ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error("Failed to construct WebSocket:", e);
      showToast("Cannot connect to server. Please refresh.", "error");
      return;
    }

    state.ws.onopen = () => {
      state.isConnected = true;
      el.connectionIndicator.className = 'status-pill status-connected';
      el.connectionText.textContent = 'ONLINE';
      if (onOpenCallback) {
        onOpenCallback();
      }
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error("Error parsing WebSocket message:", err);
      }
    };

    state.ws.onerror = (err) => {
      console.warn("WebSocket error observed:", err);
    };

    state.ws.onclose = () => {
      state.isConnected = false;
      el.connectionIndicator.className = 'status-pill status-disconnected';
      el.connectionText.textContent = 'OFFLINE';
    };
  }

  function sendWs(payload) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(payload));
    } else {
      showToast("Connection lost. Reconnecting...", "error");
      initWebSocket(() => {
        state.ws.send(JSON.stringify(payload));
      });
    }
  }

  // --- INCOMING SERVER MESSAGE HANDLER ---
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        state.roomCode = msg.room_code;
        state.playerId = msg.player_id;
        state.playerName = msg.player_name;
        el.createdRoomCode.textContent = state.roomCode;
        showScreen(el.screenCreate);
        break;

      case 'player_joined':
        state.roomCode = msg.room_code;
        state.playerId = msg.player_id;
        state.playerName = msg.player_name;
        break;

      case 'lobby_ready':
        el.lobbyRoomCode.textContent = msg.room_code;
        el.rosterP2Status.textContent = '● Connected';
        el.rosterP2Status.classList.add('status-online');
        showScreen(el.screenWaiting);
        break;

      case 'start_secret_selection':
        state.currentRound = msg.round || 1;
        state.p1Score = msg.p1_score || 0;
        state.p2Score = msg.p2_score || 0;
        state.myAttempts = 0;
        resetSecretCodeScreen();
        showScreen(el.screenSecret);
        if (msg.is_rematch) {
          showToast("Rematch started! Choose your secret code.", "success");
        }
        break;

      case 'secret_confirmed':
        state.isSecretLocked = true;
        el.myLockedCode.textContent = state.secretCodeDigits.join('');
        el.secretLockedNotice.classList.remove('hidden');
        break;

      case 'start_game':
        state.currentRound = msg.round;
        state.currentTurn = msg.current_turn;
        state.p1Score = msg.p1_score;
        state.p2Score = msg.p2_score;
        initGameScreen();
        showScreen(el.screenGame);
        break;

      case 'guess_result':
        handleGuessResult(msg);
        break;

      case 'round_won':
        handleRoundWon(msg);
        break;

      case 'match_won':
        handleMatchWon(msg);
        break;

      case 'rematch_offered':
        showToast(msg.message, "info");
        el.rematchStatusBanner.textContent = msg.message;
        el.rematchStatusBanner.classList.remove('hidden');
        break;

      case 'player_disconnected':
        el.modalDisconnect.classList.remove('hidden');
        break;

      case 'error':
        showToast(msg.message, "error");
        if (el.joinErrorMsg) {
          el.joinErrorMsg.textContent = msg.message;
          el.joinErrorMsg.classList.remove('hidden');
        }
        break;

      default:
        console.log("Unhandled message type:", msg);
    }
  }

  // --- SECRET CODE CREATION LOGIC ---
  function resetSecretCodeScreen() {
    state.secretCodeDigits = ['', '', '', ''];
    state.isSecretLocked = false;
    el.secretRoundNum.textContent = state.currentRound;
    el.secretLockedNotice.classList.add('hidden');
    updateSecretBoxesDisplay();
  }

  function updateSecretBoxesDisplay() {
    let firstEmpty = -1;
    state.secretCodeDigits.forEach((digit, idx) => {
      const box = el.secretBoxes[idx];
      box.textContent = digit ? digit : '-';
      box.classList.toggle('filled', digit !== '');

      if (digit === '' && firstEmpty === -1) {
        firstEmpty = idx;
      }
    });

    el.secretBoxes.forEach((box, idx) => {
      box.classList.toggle('active-cursor', idx === firstEmpty && !state.isSecretLocked);
    });

    const isFull = state.secretCodeDigits.every(d => d !== '');
    const isUnique = new Set(state.secretCodeDigits.filter(d => d !== '')).size === 4;

    el.btnConfirmSecret.disabled = !(isFull && isUnique) || state.isSecretLocked;

    if (!isFull) {
      el.secretFeedbackHint.textContent = "Choose 4 distinct digits (0–9)";
      el.secretFeedbackHint.style.color = "var(--text-muted)";
    } else if (!isUnique) {
      el.secretFeedbackHint.textContent = "All digits must be unique!";
      el.secretFeedbackHint.style.color = "var(--color-amber)";
    } else {
      el.secretFeedbackHint.textContent = "Valid 4-digit code! Click confirm to lock in.";
      el.secretFeedbackHint.style.color = "var(--color-cyan)";
    }
  }

  function handleSecretKeyInput(key) {
    if (state.isSecretLocked) return;

    if (key === 'clear') {
      state.secretCodeDigits = ['', '', '', ''];
      updateSecretBoxesDisplay();
      return;
    }

    if (key === 'backspace') {
      for (let i = 3; i >= 0; i--) {
        if (state.secretCodeDigits[i] !== '') {
          state.secretCodeDigits[i] = '';
          break;
        }
      }
      updateSecretBoxesDisplay();
      return;
    }

    // If numeric 0-9
    if (/^[0-9]$/.test(key)) {
      // Check if already in code
      if (state.secretCodeDigits.includes(key)) {
        showToast(`Digit ${key} is already in your code! Digits must be unique.`, "error");
        return;
      }
      for (let i = 0; i < 4; i++) {
        if (state.secretCodeDigits[i] === '') {
          state.secretCodeDigits[i] = key;
          break;
        }
      }
      updateSecretBoxesDisplay();
    }
  }

  // --- ACTIVE GAME SCREEN LOGIC ---
  function initGameScreen() {
    state.guessDigits = ['', '', '', ''];
    el.scoreP1.textContent = state.p1Score;
    el.scoreP2.textContent = state.p2Score;
    el.matchRoundLabel.textContent = `ROUND ${state.currentRound} OF 3`;
    el.gameRoomCode.textContent = state.roomCode;

    // Clear history on fresh round
    el.guessHistoryList.innerHTML = '';
    el.emptyHistoryMsg.classList.remove('hidden');

    updateTurnUI();
    updateGuessBoxesDisplay();
  }

  function updateTurnUI() {
    const isMyTurn = state.currentTurn === state.playerId;

    if (isMyTurn) {
      el.turnBanner.className = 'turn-banner banner-your-turn';
      el.turnTitle.textContent = 'YOUR TURN ⚡';
      el.turnSubtitle.textContent = "CRACK YOUR OPPONENT'S CODE";
      setKeypadEnabled(el.guessKeypad, true);
    } else {
      el.turnBanner.className = 'turn-banner banner-opponent-turn';
      el.turnTitle.textContent = 'WAITING FOR OPPONENT...';
      el.turnSubtitle.textContent = 'Opponent is calculating their next move';
      setKeypadEnabled(el.guessKeypad, false);
    }

    updateGuessBoxesDisplay();
  }

  function setKeypadEnabled(keypadEl, enabled) {
    const btns = keypadEl.querySelectorAll('.keypad-btn');
    btns.forEach(b => b.disabled = !enabled);
  }

  function updateGuessBoxesDisplay() {
    const isMyTurn = state.currentTurn === state.playerId;
    let firstEmpty = -1;

    state.guessDigits.forEach((digit, idx) => {
      const box = el.guessBoxes[idx];
      box.textContent = digit ? digit : '-';
      box.classList.toggle('filled', digit !== '');

      if (digit === '' && firstEmpty === -1) {
        firstEmpty = idx;
      }
    });

    el.guessBoxes.forEach((box, idx) => {
      box.classList.toggle('active-cursor', isMyTurn && idx === firstEmpty);
    });

    const isFull = state.guessDigits.every(d => d !== '');
    const isUnique = new Set(state.guessDigits.filter(d => d !== '')).size === 4;

    el.btnSubmitGuess.disabled = !isMyTurn || !(isFull && isUnique);
    el.attemptsBadge.textContent = `Attempt #${state.myAttempts + 1}`;
  }

  function handleGuessKeyInput(key) {
    if (state.currentTurn !== state.playerId) return;

    if (key === 'clear') {
      state.guessDigits = ['', '', '', ''];
      updateGuessBoxesDisplay();
      return;
    }

    if (key === 'backspace') {
      for (let i = 3; i >= 0; i--) {
        if (state.guessDigits[i] !== '') {
          state.guessDigits[i] = '';
          break;
        }
      }
      updateGuessBoxesDisplay();
      return;
    }

    if (/^[0-9]$/.test(key)) {
      if (state.guessDigits.includes(key)) {
        showToast(`Digit ${key} is already in your guess! Digits must be unique.`, "error");
        return;
      }
      for (let i = 0; i < 4; i++) {
        if (state.guessDigits[i] === '') {
          state.guessDigits[i] = key;
          break;
        }
      }
      updateGuessBoxesDisplay();
    }
  }

  // --- GUESS RESULTS & HISTORY FEED ---
  function handleGuessResult(res) {
    el.emptyHistoryMsg.classList.add('hidden');

    const isMe = res.guesser_id === state.playerId;
    if (isMe) {
      state.myAttempts = res.attempt;
      state.guessDigits = ['', '', '', ''];
    }

    state.currentTurn = res.current_turn;

    // Create history entry
    const row = document.createElement('div');
    row.className = `history-row ${isMe ? 'row-my-guess' : 'row-opp-guess'}`;

    // Left info
    const meta = document.createElement('div');
    meta.className = 'history-meta';

    const num = document.createElement('span');
    num.className = 'history-num';
    num.textContent = `#${res.attempt}`;

    const badge = document.createElement('span');
    badge.className = `history-player-badge ${isMe ? 'badge-you' : 'badge-opp'}`;
    badge.textContent = isMe ? 'YOU' : 'OPPONENT';

    const code = document.createElement('span');
    code.className = 'history-code';
    code.textContent = res.guess;

    meta.appendChild(num);
    meta.appendChild(badge);
    meta.appendChild(code);

    // Right feedback badges (🟢, 🟡, ❌)
    const fbContainer = document.createElement('div');
    fbContainer.className = 'history-feedback';

    res.feedback.forEach(item => {
      const fbBadge = document.createElement('span');
      fbBadge.className = 'fb-badge';
      if (item === 'correct') {
        fbBadge.textContent = '🟢';
        fbBadge.title = 'Correct digit & position';
      } else if (item === 'wrong_position') {
        fbBadge.textContent = '🟡';
        fbBadge.title = 'In code, wrong position';
      } else {
        fbBadge.textContent = '❌';
        fbBadge.title = 'Not in code';
      }
      fbContainer.appendChild(fbBadge);
    });

    row.appendChild(meta);
    row.appendChild(fbContainer);

    // Prepend so the latest guess is at the top
    el.guessHistoryList.insertBefore(row, el.guessHistoryList.firstChild);

    updateTurnUI();
  }

  // --- ROUND & MATCH WIN HANDLERS ---
  function handleRoundWon(msg) {
    state.p1Score = msg.p1_score;
    state.p2Score = msg.p2_score;
    el.scoreP1.textContent = state.p1Score;
    el.scoreP2.textContent = state.p2Score;

    el.roundWinnerText.textContent = `${msg.winner_name} WINS ROUND ${msg.round}`;
    el.roundRevealedSecret.textContent = msg.cracked_secret || '----';
    el.roundAttemptsVal.textContent = msg.attempts;
    el.summaryP1Score.textContent = `${msg.p1_score} WINS`;
    el.summaryP2Score.textContent = `${msg.p2_score} WINS`;

    el.nextRoundNum.textContent = msg.round + 1;
    el.modalRoundResult.classList.remove('hidden');
  }

  function handleMatchWon(msg) {
    state.p1Score = msg.p1_score;
    state.p2Score = msg.p2_score;

    el.matchWinnerTitle.textContent = `🏆 ${msg.winner_name} WINS THE MATCH!`;
    el.finalP1Score.textContent = msg.p1_score;
    el.finalP2Score.textContent = msg.p2_score;

    el.rematchStatusBanner.classList.add('hidden');
    el.btnRematch.disabled = false;

    showScreen(el.screenMatchResult);
  }

  // --- COPY TO CLIPBOARD HELPER ---
  function copyRoomCodeToClipboard() {
    const code = state.roomCode;
    if (!code) return;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code)
        .then(() => showToast(`Room Code ${code} copied!`, "success"))
        .catch(() => fallbackCopy(code));
    } else {
      fallbackCopy(code);
    }
  }

  function fallbackCopy(text) {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.focus();
    input.select();
    try {
      document.execCommand('copy');
      showToast(`Room Code ${text} copied!`, "success");
    } catch (err) {
      showToast(`Room Code: ${text}`, "info");
    }
    document.body.removeChild(input);
  }

  // --- ATTACH EVENT LISTENERS ---
  function initEvents() {
    // 1. Home
    el.btnHomeCreate.addEventListener('click', () => {
      initWebSocket(() => {
        sendWs({ type: 'create_room' });
      });
    });

    el.btnHomeJoin.addEventListener('click', () => {
      el.inputRoomCode.value = '';
      el.joinErrorMsg.classList.add('hidden');
      showScreen(el.screenJoin);
      setTimeout(() => el.inputRoomCode.focus(), 100);
    });

    // 2. Create Room
    el.btnCopyCode.addEventListener('click', copyRoomCodeToClipboard);
    el.btnCancelCreate.addEventListener('click', () => {
      if (state.ws) state.ws.close();
      showScreen(el.screenHome);
    });

    // 3. Join Room
    el.inputRoomCode.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      el.joinErrorMsg.classList.add('hidden');
    });

    el.btnSubmitJoin.addEventListener('click', () => {
      const code = el.inputRoomCode.value.trim().toUpperCase();
      if (code.length < 5) {
        el.joinErrorMsg.textContent = "Room code must be 5 characters.";
        el.joinErrorMsg.classList.remove('hidden');
        return;
      }
      initWebSocket(() => {
        sendWs({ type: 'join_room', room_code: code });
      });
    });

    el.btnCancelJoin.addEventListener('click', () => {
      showScreen(el.screenHome);
    });

    // 4. Secret Code
    el.secretKeypad.addEventListener('click', (e) => {
      const btn = e.target.closest('.keypad-btn');
      if (!btn || btn.disabled) return;
      handleSecretKeyInput(btn.dataset.key);
    });

    el.btnConfirmSecret.addEventListener('click', () => {
      const code = state.secretCodeDigits.join('');
      if (code.length === 4) {
        sendWs({ type: 'set_secret', code: code });
      }
    });

    // 5. Active Game
    el.guessKeypad.addEventListener('click', (e) => {
      const btn = e.target.closest('.keypad-btn');
      if (!btn || btn.disabled) return;
      handleGuessKeyInput(btn.dataset.key);
    });

    el.btnSubmitGuess.addEventListener('click', () => {
      const guess = state.guessDigits.join('');
      if (guess.length === 4) {
        sendWs({ type: 'submit_guess', guess: guess });
      }
    });

    el.gameRoomPill.addEventListener('click', copyRoomCodeToClipboard);

    // 6. Round Result Modal
    el.btnNextRound.addEventListener('click', () => {
      el.modalRoundResult.classList.add('hidden');
      sendWs({ type: 'next_round' });
    });

    // 7. Match Result & Rematch
    el.btnRematch.addEventListener('click', () => {
      el.btnRematch.disabled = true;
      el.rematchStatusBanner.textContent = "Rematch requested! Waiting for opponent...";
      el.rematchStatusBanner.classList.remove('hidden');
      sendWs({ type: 'rematch' });
    });

    el.btnMatchHome.addEventListener('click', () => {
      if (state.ws) state.ws.close();
      showScreen(el.screenHome);
    });

    // 8. Disconnect Modal
    el.btnDisconnectHome.addEventListener('click', () => {
      el.modalDisconnect.classList.add('hidden');
      showScreen(el.screenHome);
    });

    // 9. Physical Keyboard Support
    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      // Do not intercept if typing into the join input
      if (activeEl && activeEl.id === 'input-room-code') {
        if (e.key === 'Enter') {
          el.btnSubmitJoin.click();
        }
        return;
      }

      const activeScreen = document.querySelector('.game-screen.active-screen');
      if (!activeScreen) return;

      let key = e.key;
      if (key === 'Backspace') key = 'backspace';
      if (key === 'Escape') key = 'clear';

      if (activeScreen.id === 'screen-secret') {
        if (/^[0-9]$/.test(key) || key === 'backspace' || key === 'clear') {
          e.preventDefault();
          handleSecretKeyInput(key);
        } else if (key === 'Enter' && !el.btnConfirmSecret.disabled) {
          el.btnConfirmSecret.click();
        }
      } else if (activeScreen.id === 'screen-game') {
        if (/^[0-9]$/.test(key) || key === 'backspace' || key === 'clear') {
          e.preventDefault();
          handleGuessKeyInput(key);
        } else if (key === 'Enter' && !el.btnSubmitGuess.disabled) {
          el.btnSubmitGuess.click();
        }
      }
    });
  }

  // --- INITIALIZE APPLICATION ---
  window.addEventListener('DOMContentLoaded', () => {
    initEvents();
    // Warm up WebSocket connection
    initWebSocket();
  });

})();
