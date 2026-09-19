# CODE BREAKER ⚡

> **Crack. Think. Win.**
> A turn-based 1-vs-1 private room code deduction multiplayer web game built with **Python**, **FastAPI**, **WebSockets**, and modern **HTML/CSS/Vanilla JavaScript**.

---

## 1. What the Game Is

**CODE BREAKER ⚡** is a competitive two-player number-cracking duel:
1. **Private Rooms**: Two players connect using a 5-character private room code (e.g. `X7K92`).
2. **Secret Code**: Each player secretly enters a 4-digit code using unique digits from 0 to 9 (e.g. `7284`).
3. **Turn-Based Deductions**: Players take turns guessing the opponent's secret code.
4. **Mastermind-Style Feedback**:
   - 🟢 **Correct**: Digit is in the code and in the exact position.
   - 🟡 **Wrong Position**: Digit exists in the code, but at a different position.
   - ❌ **Miss**: Digit does not exist in the code.
5. **Best-of-3 Match**: The first player to crack the opponent's code wins the round. The first player to win **2 rounds** wins the match, with a built-in rematch system.

---

## 2. Prerequisites & Python Version

- **Python**: Version **3.8** or higher (tested with Python 3.10 and 3.11).
- **Web Browser**: Any modern browser (Google Chrome, Firefox, Safari, Edge, or mobile browser).
- No prior database or complex software required.

---

## 3. Project Structure

```text
CODE-BREAKER/
├── backend/
│   ├── main.py            # FastAPI web server, static files, and WebSocket hub
│   ├── game.py            # Authoritative game logic, validation & room manager
│   └── requirements.txt   # Python dependencies (FastAPI, Uvicorn, WebSockets)
├── frontend/
│   ├── index.html         # Responsive semantic game markup & modal views
│   ├── style.css          # Dark futuristic cyber theme & touch keypad layout
│   └── game.js            # Client controller, state machine & WebSocket handler
└── README.md              # Beginner setup and architecture guide
```

---

## 4. Quick Start (Step-by-Step)

Follow these simple terminal commands to run the game on your computer:

### Step 1: Open Terminal & Navigate to Project
```bash
cd CODE-BREAKER
```

### Step 2: Create a Virtual Environment
A virtual environment keeps the project's dependencies isolated from your system Python.

- **On macOS / Linux**:
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  ```

- **On Windows**:
  ```cmd
  python -m venv venv
  venv\Scripts\activate
  ```

### Step 3: Install Required Packages
```bash
pip install -r backend/requirements.txt
```

### Step 4: Start the Python Server
Run Uvicorn to start the FastAPI server:
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

You will see output like:
```text
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
```

---

## 5. How to Play with Two Players

### Testing on a Single Computer (Two Browser Windows)
1. Open your browser and go to:
   ```text
   http://localhost:8000
   ```
2. In Window 1 (Player 1): Click **CREATE ROOM**. A 5-character code will appear (e.g. `X7K92`). Click **COPY CODE**.
3. Open a second **Incognito / Private Window** (or a different browser like Firefox) and go to:
   ```text
   http://localhost:8000
   ```
4. In Window 2 (Player 2): Click **JOIN ROOM**, paste the room code, and click **JOIN ROOM**.
5. Both players will automatically transition to **CREATE YOUR SECRET CODE**:
   - Player 1 enters 4 unique digits (e.g. `7284`) and clicks **CONFIRM CODE**.
   - Player 2 enters 4 unique digits (e.g. `3916`) and clicks **CONFIRM CODE**.
6. The match begins! The active player sees **YOUR TURN ⚡**, inputs a guess, and receives real-time feedback.

---

## 6. How Multiplayer Communication Works

Communication between players and the server is **real-time** and **server-authoritative**:

1. **WebSockets (`/ws`)**: Rather than polling with HTTP requests, each player establishes a persistent two-way connection with the Python server.
2. **Server-Side Truth**:
   - Player 1's secret code is **never** transmitted to Player 2's browser.
   - Player 2's secret code is **never** transmitted to Player 1's browser.
   - Only the server evaluates the guess and broadcasts feedback (`correct`, `wrong_position`, `not_found`).
3. **Structured JSON Protocol**:
   - `create_room` → `room_created`
   - `join_room` → `player_joined`, `lobby_ready`
   - `set_secret` → `secret_confirmed`, `start_game`
   - `submit_guess` → `guess_result`, `round_won`, `match_won`
   - `next_round` → `start_secret_selection`
   - `rematch` → `rematch_offered`, `start_secret_selection`

---

## 7. Common Errors and Fixes

| Issue | Cause | Easy Fix |
| :--- | :--- | :--- |
| `Address already in use` | Another program is using port 8000. | Change port: `uvicorn backend.main:app --reload --port 8080`. |
| `Room not found` | Typed incorrect code or room was closed. | Double-check uppercase letters/numbers. Room codes are 5 characters. |
| `Room is already full` | Two players are already in that room. | A room only supports 2 players. Have the host create a new room. |
| `All digits must be unique` | Entered repeated numbers (e.g., 7724). | CODE BREAKER rules require 4 distinct digits (0 to 9). |
| `pip: command not found` | Python or pip is not added to system PATH. | Reinstall Python from [python.org](https://www.python.org/) and check *"Add Python to PATH"*. |

---

## 8. Limitations of Version 1

- **In-Memory Storage**: Active rooms exist in server memory. If the server is restarted, ongoing rooms are reset.
- **Local Network Default**: By default, `localhost` runs locally. To play with friends over the internet, deploy to a cloud host (see below) or use a secure tunnel (e.g., Cloudflare Tunnel / ngrok).

---

## 9. How to Deploy to the Cloud (Free / Easy)

When you are ready to host the game online for friends:

### Option A: Render (Free Tier)
1. Push your code to GitHub.
2. Go to [render.com](https://render.com) and create a new **Web Service**.
3. Set **Build Command**: `pip install -r backend/requirements.txt`
4. Set **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`

### Option B: Docker
A sample `Dockerfile` for containerized hosting:
```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
