import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT) || 3000;

// --- AUTHORITATIVE IN-MEMORY GAME ENGINE ---

interface GuessRecord {
  guess: string;
  feedback: string[];
  attempt: number;
}

interface Player {
  id: string; // 'p1' | 'p2'
  name: string;
  secretCode: string | null;
  guesses: GuessRecord[];
  roundWins: number;
  connected: boolean;
  readyForRematch: boolean;
  ws?: WebSocket;
}

interface Room {
  roomCode: string;
  players: Record<string, Player>;
  state: 'LOBBY' | 'SECRET_SELECTION' | 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER';
  currentRound: number;
  currentTurn: string;
  roundWinner: string | null;
  matchWinner: string | null;
}

const rooms = new Map<string, Room>();

function generateRoomCode(length = 5): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function validateCode(code: string): { valid: boolean; error: string } {
  if (typeof code !== 'string') return { valid: false, error: 'Code must be a string.' };
  if (code.length !== 4) return { valid: false, error: 'Code must be exactly 4 digits.' };
  if (!/^\d{4}$/.test(code)) return { valid: false, error: 'Code must contain only numeric digits (0-9).' };
  const unique = new Set(code.split(''));
  if (unique.size !== 4) return { valid: false, error: 'All 4 digits must be unique with no repeated numbers.' };
  return { valid: true, error: '' };
}

function calculateFeedback(guess: string, secret: string): string[] {
  const feedback: string[] = [];
  for (let i = 0; i < 4; i++) {
    const digit = guess[i];
    if (digit === secret[i]) {
      feedback.push('correct');
    } else if (secret.includes(digit)) {
      feedback.push('wrong_position');
    } else {
      feedback.push('not_found');
    }
  }
  return feedback;
}

function sendJsonSafe(ws: WebSocket | undefined, payload: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to send WebSocket message:', err);
    }
  }
}

function broadcastToRoom(room: Room, payload: Record<string, unknown>, excludePlayerId?: string) {
  Object.values(room.players).forEach((p) => {
    if (excludePlayerId && p.id === excludePlayerId) return;
    sendJsonSafe(p.ws, payload);
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.json());

  // API health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', roomsActive: rooms.size });
  });

  // WebSocket Server attached to path /ws
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    let currentRoomCode: string | null = null;
    let currentPlayerId: string | null = null;

    ws.on('message', (message: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(message.toString());
      } catch {
        sendJsonSafe(ws, { type: 'error', message: 'Invalid JSON payload.' });
        return;
      }

      const msgType = msg.type;

      // 1. CREATE ROOM
      if (msgType === 'create_room') {
        let code = generateRoomCode();
        while (rooms.has(code)) {
          code = generateRoomCode();
        }

        const room: Room = {
          roomCode: code,
          players: {
            p1: {
              id: 'p1',
              name: 'PLAYER 1',
              secretCode: null,
              guesses: [],
              roundWins: 0,
              connected: true,
              readyForRematch: false,
              ws,
            },
          },
          state: 'LOBBY',
          currentRound: 1,
          currentTurn: 'p1',
          roundWinner: null,
          matchWinner: null,
        };

        rooms.set(code, room);
        currentRoomCode = code;
        currentPlayerId = 'p1';

        sendJsonSafe(ws, {
          type: 'room_created',
          room_code: code,
          player_id: 'p1',
          player_name: 'PLAYER 1',
        });
      }

      // 2. JOIN ROOM
      else if (msgType === 'join_room') {
        const rawCode = String(msg.room_code || '').trim().toUpperCase();
        if (!rawCode) {
          sendJsonSafe(ws, { type: 'error', message: 'Please enter a valid room code.' });
          return;
        }

        const room = rooms.get(rawCode);
        if (!room) {
          sendJsonSafe(ws, { type: 'error', message: 'Room not found. Please verify the code.' });
          return;
        }

        if (Object.keys(room.players).length >= 2) {
          sendJsonSafe(ws, { type: 'error', message: 'This room is already full.' });
          return;
        }

        currentRoomCode = room.roomCode;
        currentPlayerId = 'p2';

        room.players['p2'] = {
          id: 'p2',
          name: 'PLAYER 2',
          secretCode: null,
          guesses: [],
          roundWins: 0,
          connected: true,
          readyForRematch: false,
          ws,
        };

        sendJsonSafe(ws, {
          type: 'player_joined',
          room_code: room.roomCode,
          player_id: 'p2',
          player_name: 'PLAYER 2',
        });

        // Broadcast lobby ready
        broadcastToRoom(room, {
          type: 'lobby_ready',
          room_code: room.roomCode,
          p1_connected: true,
          p2_connected: true,
        });

        // Transition to secret code selection
        room.state = 'SECRET_SELECTION';
        broadcastToRoom(room, {
          type: 'start_secret_selection',
          round: room.currentRound,
          p1_score: room.players['p1']?.roundWins || 0,
          p2_score: room.players['p2']?.roundWins || 0,
        });
      }

      // 3. SET SECRET
      else if (msgType === 'set_secret') {
        if (!currentRoomCode || !currentPlayerId) {
          sendJsonSafe(ws, { type: 'error', message: 'Not currently in a room.' });
          return;
        }

        const room = rooms.get(currentRoomCode);
        if (!room || room.state !== 'SECRET_SELECTION') {
          sendJsonSafe(ws, { type: 'error', message: 'Room is not accepting secret codes.' });
          return;
        }

        const code = String(msg.code || '').trim();
        const check = validateCode(code);
        if (!check.valid) {
          sendJsonSafe(ws, { type: 'error', message: check.error });
          return;
        }

        const player = room.players[currentPlayerId];
        if (player) {
          player.secretCode = code;
        }

        sendJsonSafe(ws, {
          type: 'secret_confirmed',
          message: 'Secret code locked in. Waiting for opponent...',
        });

        // Check if both players locked in their codes
        const p1 = room.players['p1'];
        const p2 = room.players['p2'];
        if (p1 && p2 && p1.secretCode && p2.secretCode) {
          room.state = 'PLAYING';
          room.currentTurn = room.currentRound % 2 !== 0 ? 'p1' : 'p2';

          broadcastToRoom(room, {
            type: 'start_game',
            round: room.currentRound,
            current_turn: room.currentTurn,
            p1_score: p1.roundWins,
            p2_score: p2.roundWins,
          });
        }
      }

      // 4. SUBMIT GUESS
      else if (msgType === 'submit_guess') {
        if (!currentRoomCode || !currentPlayerId) {
          sendJsonSafe(ws, { type: 'error', message: 'Not in a game room.' });
          return;
        }

        const room = rooms.get(currentRoomCode);
        if (!room || room.state !== 'PLAYING') {
          sendJsonSafe(ws, { type: 'error', message: 'Game is not currently active.' });
          return;
        }

        if (currentPlayerId !== room.currentTurn) {
          sendJsonSafe(ws, { type: 'error', message: "It's not your turn!" });
          return;
        }

        const guess = String(msg.guess || '').trim();
        const check = validateCode(guess);
        if (!check.valid) {
          sendJsonSafe(ws, { type: 'error', message: check.error });
          return;
        }

        const opponentId = currentPlayerId === 'p1' ? 'p2' : 'p1';
        const opponent = room.players[opponentId];
        const player = room.players[currentPlayerId];

        if (!opponent || !opponent.secretCode || !player) {
          sendJsonSafe(ws, { type: 'error', message: 'Opponent secret code missing.' });
          return;
        }

        const feedback = calculateFeedback(guess, opponent.secretCode);
        const attempt = player.guesses.length + 1;
        player.guesses.push({ guess, feedback, attempt });

        const isCracked = feedback.every((f) => f === 'correct');

        if (isCracked) {
          player.roundWins += 1;
          room.roundWinner = currentPlayerId;

          // Broadcast the guess feedback first
          broadcastToRoom(room, {
            type: 'guess_result',
            guesser_id: currentPlayerId,
            guesser_name: player.name,
            guess,
            feedback,
            attempt,
            is_cracked: true,
            current_turn: room.currentTurn,
          });

          // Check if match won (best of 3: first to 2 round wins)
          if (player.roundWins >= 2) {
            room.state = 'MATCH_OVER';
            room.matchWinner = currentPlayerId;
            broadcastToRoom(room, {
              type: 'match_won',
              winner_id: currentPlayerId,
              winner_name: player.name,
              p1_score: room.players['p1'].roundWins,
              p2_score: room.players['p2'].roundWins,
              cracked_secret: opponent.secretCode,
              round: room.currentRound,
            });
          } else {
            room.state = 'ROUND_OVER';
            broadcastToRoom(room, {
              type: 'round_won',
              winner_id: currentPlayerId,
              winner_name: player.name,
              round: room.currentRound,
              attempts: attempt,
              p1_score: room.players['p1'].roundWins,
              p2_score: room.players['p2'].roundWins,
              cracked_secret: opponent.secretCode,
            });
          }
        } else {
          // Switch turn
          room.currentTurn = opponentId;
          broadcastToRoom(room, {
            type: 'guess_result',
            guesser_id: currentPlayerId,
            guesser_name: player.name,
            guess,
            feedback,
            attempt,
            is_cracked: false,
            current_turn: room.currentTurn,
          });
        }
      }

      // 5. NEXT ROUND
      else if (msgType === 'next_round') {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room || room.state !== 'ROUND_OVER') return;

        room.currentRound += 1;
        room.state = 'SECRET_SELECTION';
        Object.values(room.players).forEach((p) => {
          p.secretCode = null;
          p.guesses = [];
        });

        broadcastToRoom(room, {
          type: 'start_secret_selection',
          round: room.currentRound,
          p1_score: room.players['p1']?.roundWins || 0,
          p2_score: room.players['p2']?.roundWins || 0,
        });
      }

      // 6. REMATCH
      else if (msgType === 'rematch') {
        if (!currentRoomCode || !currentPlayerId) return;
        const room = rooms.get(currentRoomCode);
        if (!room || room.state !== 'MATCH_OVER') return;

        const player = room.players[currentPlayerId];
        if (player) {
          player.readyForRematch = true;
        }

        const opponentId = currentPlayerId === 'p1' ? 'p2' : 'p1';
        const opponent = room.players[opponentId];

        if (opponent && opponent.readyForRematch) {
          // Both agreed: reset match
          room.currentRound = 1;
          room.state = 'SECRET_SELECTION';
          room.roundWinner = null;
          room.matchWinner = null;
          Object.values(room.players).forEach((p) => {
            p.roundWins = 0;
            p.secretCode = null;
            p.guesses = [];
            p.readyForRematch = false;
          });

          broadcastToRoom(room, {
            type: 'start_secret_selection',
            round: 1,
            p1_score: 0,
            p2_score: 0,
            is_rematch: true,
          });
        } else if (opponent) {
          sendJsonSafe(opponent.ws, {
            type: 'rematch_offered',
            from: currentPlayerId,
            message: `${player?.name || 'Opponent'} wants a rematch!`,
          });
        }
      }
    });

    ws.on('close', () => {
      if (currentRoomCode && currentPlayerId) {
        const room = rooms.get(currentRoomCode);
        if (room) {
          const player = room.players[currentPlayerId];
          if (player) {
            player.connected = false;
          }

          const opponentId = currentPlayerId === 'p1' ? 'p2' : 'p1';
          const opponent = room.players[opponentId];
          if (opponent && opponent.connected) {
            sendJsonSafe(opponent.ws, {
              type: 'player_disconnected',
              message: 'Your opponent has disconnected.',
            });
          }

          // Cleanup if everyone disconnected
          const anyoneConnected = Object.values(room.players).some((p) => p.connected);
          if (!anyoneConnected) {
            rooms.delete(currentRoomCode);
          }
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CODE BREAKER ⚡ server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
