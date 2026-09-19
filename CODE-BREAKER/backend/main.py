"""
main.py - FastAPI & WebSocket Server for CODE BREAKER ⚡

This server coordinates real-time multiplayer gameplay via WebSockets.
It handles room creation, player joining, secret code validation,
turn-by-turn guessing, and state broadcasts.
"""

import json
import os
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.game import GameManager, Room

app = FastAPI(title="CODE BREAKER ⚡ Backend")

# Allow CORS for development / testing flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Central game manager storing active rooms in memory
game_manager = GameManager()

# Track active WebSocket connections: room_code -> { "p1": WebSocket, "p2": WebSocket }
active_connections: Dict[str, Dict[str, WebSocket]] = {}


async def send_json_safe(ws: WebSocket, payload: dict):
    """Safely send a JSON message over a WebSocket."""
    try:
        await ws.send_text(json.dumps(payload))
    except Exception as e:
        print(f"Error sending message to client: {e}")


async def broadcast_to_room(room_code: str, payload: dict, exclude_player: Optional[str] = None):
    """Broadcast a message to all players in a room."""
    connections = active_connections.get(room_code, {})
    for pid, ws in list(connections.items()):
        if exclude_player and pid == exclude_player:
            continue
        await send_json_safe(ws, payload)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket endpoint for 2-player private-room game actions.
    """
    await websocket.accept()
    current_room_code: Optional[str] = None
    current_player_id: Optional[str] = None

    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                msg = json.loads(data_text)
            except json.JSONDecodeError:
                await send_json_safe(websocket, {
                    "type": "error",
                    "message": "Invalid message format: expected JSON."
                })
                continue

            msg_type = msg.get("type")

            # -----------------------------------------------------------------
            # 1. CREATE ROOM
            # -----------------------------------------------------------------
            if msg_type == "create_room":
                room = game_manager.create_room()
                current_room_code = room.room_code
                current_player_id = "p1"

                room.add_player("p1", "PLAYER 1")

                if current_room_code not in active_connections:
                    active_connections[current_room_code] = {}
                active_connections[current_room_code]["p1"] = websocket

                await send_json_safe(websocket, {
                    "type": "room_created",
                    "room_code": room.room_code,
                    "player_id": "p1",
                    "player_name": "PLAYER 1"
                })

            # -----------------------------------------------------------------
            # 2. JOIN ROOM
            # -----------------------------------------------------------------
            elif msg_type == "join_room":
                raw_code = msg.get("room_code", "").strip().upper()
                if not raw_code:
                    await send_json_safe(websocket, {
                        "type": "error",
                        "message": "Please enter a valid room code."
                    })
                    continue

                room = game_manager.get_room(raw_code)
                if not room:
                    await send_json_safe(websocket, {
                        "type": "error",
                        "message": "Room not found. Please verify the 5-character code."
                    })
                    continue

                if room.is_full():
                    await send_json_safe(websocket, {
                        "type": "error",
                        "message": "This room is already full (max 2 players)."
                    })
                    continue

                current_room_code = room.room_code
                current_player_id = "p2"
                room.add_player("p2", "PLAYER 2")

                if current_room_code not in active_connections:
                    active_connections[current_room_code] = {}
                active_connections[current_room_code]["p2"] = websocket

                # Notify Player 2 of successful join
                await send_json_safe(websocket, {
                    "type": "player_joined",
                    "room_code": room.room_code,
                    "player_id": "p2",
                    "player_name": "PLAYER 2"
                })

                # Broadcast lobby status (both players connected)
                await broadcast_to_room(current_room_code, {
                    "type": "lobby_ready",
                    "room_code": room.room_code,
                    "p1_connected": True,
                    "p2_connected": True
                })

                # Transition automatically to Secret Code selection
                room.start_secret_selection()
                await broadcast_to_room(current_room_code, {
                    "type": "start_secret_selection",
                    "round": room.current_round,
                    "p1_score": room.players["p1"].round_wins,
                    "p2_score": room.players["p2"].round_wins
                })

            # -----------------------------------------------------------------
            # 3. SET SECRET CODE
            # -----------------------------------------------------------------
            elif msg_type == "set_secret":
                if not current_room_code or not current_player_id:
                    await send_json_safe(websocket, {"type": "error", "message": "Not in an active room."})
                    continue

                room = game_manager.get_room(current_room_code)
                if not room:
                    await send_json_safe(websocket, {"type": "error", "message": "Room not found."})
                    continue

                code = str(msg.get("code", "")).strip()
                ok, err = room.set_player_secret(current_player_id, code)
                if not ok:
                    await send_json_safe(websocket, {"type": "error", "message": err})
                    continue

                # Confirm to this player that their code was saved securely
                await send_json_safe(websocket, {
                    "type": "secret_confirmed",
                    "message": "Secret code locked in. Waiting for opponent..."
                })

                # If both have set their secret, room.state becomes 'PLAYING'
                if room.state == "PLAYING":
                    # Broadcast game start
                    await broadcast_to_room(current_room_code, {
                        "type": "start_game",
                        "round": room.current_round,
                        "current_turn": room.current_turn,
                        "p1_score": room.players["p1"].round_wins,
                        "p2_score": room.players["p2"].round_wins
                    })

            # -----------------------------------------------------------------
            # 4. SUBMIT GUESS
            # -----------------------------------------------------------------
            elif msg_type == "submit_guess":
                if not current_room_code or not current_player_id:
                    await send_json_safe(websocket, {"type": "error", "message": "Not in an active room."})
                    continue

                room = game_manager.get_room(current_room_code)
                if not room:
                    await send_json_safe(websocket, {"type": "error", "message": "Room not found."})
                    continue

                guess = str(msg.get("guess", "")).strip()
                ok, err, res = room.process_guess(current_player_id, guess)
                if not ok:
                    await send_json_safe(websocket, {"type": "error", "message": err})
                    continue

                # Broadcast guess result to both players
                await broadcast_to_room(current_room_code, {
                    "type": "guess_result",
                    "guesser_id": res["guesser_id"],
                    "guesser_name": res["guesser_name"],
                    "guess": res["guess"],
                    "feedback": res["feedback"],
                    "attempt": res["attempt"],
                    "is_cracked": res["is_cracked"],
                    "current_turn": res["current_turn"],
                    "state": res["state"]
                })

                # Handle round or match win
                if res["is_cracked"]:
                    if res["state"] == "MATCH_OVER":
                        await broadcast_to_room(current_room_code, {
                            "type": "match_won",
                            "winner_id": res["match_winner"],
                            "winner_name": room.players[res["match_winner"]].name,
                            "p1_score": res["p1_score"],
                            "p2_score": res["p2_score"],
                            "cracked_secret": res["secret_code"],
                            "round": res["current_round"]
                        })
                    else:
                        await broadcast_to_room(current_room_code, {
                            "type": "round_won",
                            "winner_id": res["round_winner"],
                            "winner_name": room.players[res["round_winner"]].name,
                            "round": res["current_round"],
                            "attempts": res["attempt"],
                            "p1_score": res["p1_score"],
                            "p2_score": res["p2_score"],
                            "cracked_secret": res["secret_code"]
                        })

            # -----------------------------------------------------------------
            # 5. NEXT ROUND
            # -----------------------------------------------------------------
            elif msg_type == "next_round":
                if not current_room_code:
                    continue
                room = game_manager.get_room(current_room_code)
                if not room:
                    continue

                if room.next_round():
                    await broadcast_to_room(current_room_code, {
                        "type": "start_secret_selection",
                        "round": room.current_round,
                        "p1_score": room.players["p1"].round_wins,
                        "p2_score": room.players["p2"].round_wins
                    })

            # -----------------------------------------------------------------
            # 6. REMATCH
            # -----------------------------------------------------------------
            elif msg_type == "rematch":
                if not current_room_code or not current_player_id:
                    continue
                room = game_manager.get_room(current_room_code)
                if not room:
                    continue

                ok, both_agreed = room.request_rematch(current_player_id)
                if ok:
                    if both_agreed:
                        await broadcast_to_room(current_room_code, {
                            "type": "start_secret_selection",
                            "round": 1,
                            "p1_score": 0,
                            "p2_score": 0,
                            "is_rematch": True
                        })
                    else:
                        # Notify opponent that rematch was requested
                        opponent_id = room.get_opponent_id(current_player_id)
                        if opponent_id and opponent_id in active_connections.get(current_room_code, {}):
                            await send_json_safe(
                                active_connections[current_room_code][opponent_id],
                                {
                                    "type": "rematch_offered",
                                    "from": current_player_id,
                                    "message": f"{room.players[current_player_id].name} wants a rematch!"
                                }
                            )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket unhandled error: {e}")
    finally:
        # Handle player disconnect cleanly
        if current_room_code and current_player_id:
            room_conns = active_connections.get(current_room_code, {})
            if current_player_id in room_conns:
                del room_conns[current_player_id]

            room = game_manager.get_room(current_room_code)
            if room:
                if current_player_id in room.players:
                    room.players[current_player_id].connected = False

                # If opponent is still connected, notify them
                opponent_id = room.get_opponent_id(current_player_id)
                if opponent_id and opponent_id in room_conns:
                    await send_json_safe(room_conns[opponent_id], {
                        "type": "player_disconnected",
                        "message": "Your opponent has disconnected from the room."
                    })

                # If all players left, remove room from memory
                if not room_conns:
                    game_manager.remove_room(current_room_code)
                    if current_room_code in active_connections:
                        del active_connections[current_room_code]


# Mount frontend static files
frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(frontend_dir / "index.html")

    @app.get("/{full_path:path}")
    async def serve_frontend_files(full_path: str):
        target = frontend_dir / full_path
        if target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(frontend_dir / "index.html")
