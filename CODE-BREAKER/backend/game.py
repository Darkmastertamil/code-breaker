"""
game.py - Authoritative Game Logic for CODE BREAKER ⚡

This module contains all core game rules, validation, feedback calculation,
and in-memory room/match state management. No game-state decisions are made
by the client; the server is the single source of truth.
"""

import random
import string
from typing import Dict, List, Optional, Tuple


def generate_room_code(length: int = 5) -> str:
    """Generate a random, readable 5-character alphanumeric room code."""
    # Exclude characters easily confused with numbers or other letters (0, O, 1, I)
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choices(alphabet, k=length))


def validate_code(code: str) -> Tuple[bool, str]:
    """
    Validate a secret code or a guess.
    Rules:
    - Exactly 4 characters
    - Only numeric digits (0-9)
    - All digits must be unique (no duplicates)
    """
    if not isinstance(code, str):
        return False, "Code must be a string."
    if len(code) != 4:
        return False, "Code must be exactly 4 digits."
    if not code.isdigit():
        return False, "Code must contain only numeric digits (0-9)."
    if len(set(code)) != 4:
        return False, "All 4 digits must be unique with no repeated numbers."
    return True, ""


def calculate_feedback(guess: str, secret: str) -> List[str]:
    """
    Mastermind-style positional feedback for 4 unique digits:
    - 'correct' (🟢): Correct digit and correct position.
    - 'wrong_position' (🟡): Digit exists in secret code, but at a different position.
    - 'not_found' (❌): Digit does not exist in secret code.
    
    Since both guess and secret have unique digits, this matching is
    100% deterministic and unambiguous.
    """
    feedback: List[str] = []
    for i in range(4):
        digit = guess[i]
        if digit == secret[i]:
            feedback.append("correct")
        elif digit in secret:
            feedback.append("wrong_position")
        else:
            feedback.append("not_found")
    return feedback


class Player:
    """Represents a connected player in a room."""

    def __init__(self, player_id: str, name: str):
        self.player_id: str = player_id  # "p1" or "p2"
        self.name: str = name            # "PLAYER 1" or "PLAYER 2"
        self.secret_code: Optional[str] = None
        self.guesses: List[dict] = []     # [{ "guess": "7829", "feedback": [...], "attempt": 1 }]
        self.round_wins: int = 0
        self.connected: bool = True
        self.ready_for_rematch: bool = False

    def reset_for_round(self):
        """Reset player state for a new round."""
        self.secret_code = None
        self.guesses = []
        self.ready_for_rematch = False

    def reset_for_match(self):
        """Reset player state for a full new match."""
        self.reset_for_round()
        self.round_wins = 0


class Room:
    """
    Manages a 2-player private room and game state.
    
    State flow:
    - LOBBY: Waiting for Player 2 to join.
    - SECRET_SELECTION: Both players choosing their 4-digit code.
    - PLAYING: Active round with alternating turns.
    - ROUND_OVER: A player cracked the opponent's code.
    - MATCH_OVER: Best-of-3 finished (one player reached 2 round wins).
    """

    def __init__(self, room_code: str):
        self.room_code: str = room_code
        self.players: Dict[str, Player] = {}  # "p1": Player, "p2": Player
        self.state: str = "LOBBY"
        self.current_round: int = 1
        self.current_turn: str = "p1"        # "p1" starts Round 1, "p2" starts Round 2, "p1" starts Round 3
        self.round_winner: Optional[str] = None
        self.match_winner: Optional[str] = None

    def add_player(self, player_id: str, name: str) -> Optional[Player]:
        """Add a player to the room (max 2)."""
        if len(self.players) >= 2 and player_id not in self.players:
            return None
        if player_id not in self.players:
            player = Player(player_id, name)
            self.players[player_id] = player
        else:
            player = self.players[player_id]
            player.connected = True
        return player

    def is_full(self) -> bool:
        return len(self.players) >= 2

    def get_opponent_id(self, player_id: str) -> Optional[str]:
        """Return the ID of the other player."""
        for pid in self.players:
            if pid != player_id:
                return pid
        return None

    def start_secret_selection(self):
        """Transition room to secret code selection."""
        self.state = "SECRET_SELECTION"
        self.round_winner = None
        for p in self.players.values():
            p.reset_for_round()

    def set_player_secret(self, player_id: str, code: str) -> Tuple[bool, str]:
        """Authoritatively set a player's secret code."""
        if self.state != "SECRET_SELECTION":
            return False, "Cannot set secret code outside secret selection state."
        if player_id not in self.players:
            return False, "Player not found in this room."

        valid, err = validate_code(code)
        if not valid:
            return False, err

        self.players[player_id].secret_code = code

        # Check if both players have set their secret code
        all_set = (
            len(self.players) == 2
            and all(p.secret_code is not None for p in self.players.values())
        )
        if all_set:
            self.state = "PLAYING"
            # Round 1 -> p1 starts, Round 2 -> p2 starts, Round 3 -> p1 starts
            self.current_turn = "p1" if (self.current_round % 2 != 0) else "p2"

        return True, ""

    def process_guess(self, player_id: str, guess: str) -> Tuple[bool, str, Optional[dict]]:
        """
        Validate and process a guess from player_id.
        Returns: (success, error_message, result_data)
        """
        if self.state != "PLAYING":
            return False, "Game is not currently active.", None

        if player_id != self.current_turn:
            return False, "It's not your turn!", None

        valid, err = validate_code(guess)
        if not valid:
            return False, err

        opponent_id = self.get_opponent_id(player_id)
        if not opponent_id or opponent_id not in self.players:
            return False, "Opponent not found.", None

        opponent = self.players[opponent_id]
        if not opponent.secret_code:
            return False, "Opponent secret code is not set.", None

        player = self.players[player_id]

        # Calculate Mastermind-style feedback
        feedback = calculate_feedback(guess, opponent.secret_code)
        attempt_number = len(player.guesses) + 1

        guess_record = {
            "guess": guess,
            "feedback": feedback,
            "attempt": attempt_number,
        }
        player.guesses.append(guess_record)

        # Check if all 4 are correct (code cracked!)
        is_cracked = all(f == "correct" for f in feedback)

        result_data = {
            "guesser_id": player_id,
            "guesser_name": player.name,
            "guess": guess,
            "feedback": feedback,
            "attempt": attempt_number,
            "is_cracked": is_cracked,
            "secret_code": opponent.secret_code if is_cracked else None,
        }

        if is_cracked:
            player.round_wins += 1
            self.round_winner = player_id

            # Best-of-3: First to 2 round wins takes the match
            if player.round_wins >= 2:
                self.state = "MATCH_OVER"
                self.match_winner = player_id
            else:
                self.state = "ROUND_OVER"
        else:
            # Switch turns
            self.current_turn = opponent_id

        result_data["state"] = self.state
        result_data["current_round"] = self.current_round
        result_data["current_turn"] = self.current_turn
        result_data["round_winner"] = self.round_winner
        result_data["match_winner"] = self.match_winner
        result_data["p1_score"] = self.players.get("p1").round_wins if "p1" in self.players else 0
        result_data["p2_score"] = self.players.get("p2").round_wins if "p2" in self.players else 0

        return True, "", result_data

    def next_round(self) -> bool:
        """Advance to the next round if in ROUND_OVER."""
        if self.state != "ROUND_OVER":
            return False
        self.current_round += 1
        self.start_secret_selection()
        return True

    def request_rematch(self, player_id: str) -> Tuple[bool, bool]:
        """
        Record a rematch request.
        Returns: (success, both_agreed)
        """
        if self.state != "MATCH_OVER":
            return False, False
        if player_id not in self.players:
            return False, False

        self.players[player_id].ready_for_rematch = True

        both_agreed = len(self.players) == 2 and all(
            p.ready_for_rematch for p in self.players.values()
        )

        if both_agreed:
            # Reset for a brand new match
            self.current_round = 1
            self.round_winner = None
            self.match_winner = None
            for p in self.players.values():
                p.reset_for_match()
            self.start_secret_selection()

        return True, both_agreed


class GameManager:
    """Manages all active rooms in memory."""

    def __init__(self):
        self.rooms: Dict[str, Room] = {}

    def create_room(self) -> Room:
        """Create a new room with a unique code."""
        code = generate_room_code()
        while code in self.rooms:
            code = generate_room_code()
        room = Room(code)
        self.rooms[code] = room
        return room

    def get_room(self, room_code: str) -> Optional[Room]:
        """Retrieve a room by code (case-insensitive)."""
        if not room_code:
            return None
        return self.rooms.get(room_code.strip().upper())

    def remove_room(self, room_code: str):
        """Remove a room when empty or game concluded."""
        code = room_code.strip().upper()
        if code in self.rooms:
            del self.rooms[code]
