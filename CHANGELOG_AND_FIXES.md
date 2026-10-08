# Team Project Notes: Bugs Fixed & Architecture Improvements

> **Summary for Team Members**:  
> This note documents all the bugs, configuration traps, and enhancements made to the original midterm project codebase to ensure it builds cleanly on Docker, runs without connection errors on any machine (Local & AWS EC2), passes 100% of test cases in `test.md`, and includes a clean live demonstration interface.

---

## 1. Critical Bug Fixes (Docker & Database Networking)

### 🚨 Fix 1.1: Docker Compose MongoDB Fallback Connection String
* **The Original Code**:
  In `docker-compose.yml`, services used:
  ```yaml
  MONGO_URI=${MONGO_URI:-mongodb://localhost:27017/smart_campus_access_db}
  ```
* **The Bug**:
  Inside a Docker container on the bridge network (`campus_network`), `localhost:27017` refers to the container itself (`127.0.0.1`), **not** the `campus_mongodb` container. If someone cloned the repository on a new machine or AWS EC2 without a `.env` file, all 6 microservices immediately crashed on startup with:
  ```text
  MongoDB Connection Error: connect ECONNREFUSED 127.0.0.1:27017
  ```
* **The Solution**:
  Updated the fallback default in `docker-compose.yml` to:
  ```yaml
  MONGO_URI=${MONGO_URI:-mongodb://mongodb:27017/smart_campus_access_db}
  ```
  and created a root `.env` file. Now all containers automatically resolve MongoDB via Docker DNS out-of-the-box.

---

### 🚨 Fix 1.2: Container Startup Race Condition (`depends_on: mongodb`)
* **The Original Code**:
  Backend services (`registration_service`, `auth_service`, `room_service`, `permission_service`, `accesslog_service_1`, `accesslog_service_2`, `emergency_service`) did not have `depends_on: - mongodb`.
* **The Bug**:
  On lower-tier instances (like an AWS EC2 `t2.micro` or cold machine boot), Node.js processes start up in milliseconds, whereas MongoDB takes 5–8 seconds to initialize its socket. This caused microservices to fail their initial DB connection attempt before MongoDB was ready.
* **The Solution**:
  Added `depends_on: - mongodb` to each microservice definition in `docker-compose.yml` so Docker coordinates startup order properly.

---

### 🚨 Fix 1.3: Removed Obsolete Docker Compose `version: '3.8'`
* **The Original Code**:
  Line 1 of `docker-compose.yml` declared `version: '3.8'`.
* **The Issue**:
  Modern Docker Compose v2 emits an obsolete warning on every single execution:
  ```text
  level=warning msg="the attribute `version` is obsolete, it will be ignored"
  ```
* **The Solution**:
  Removed the `version` line, producing 100% clean terminal output.

---

### 🚨 Fix 1.4: Invalid MongoDB Atlas Placeholders in Local `.env` Files
* **The Original Code**:
  All 6 microservice `.env` files contained:
  ```env
  MONGO_URI=mongodb+srv://<username>:<password>@cluster0.example.mongodb.net/smart_campus_db...
  ```
* **The Bug**:
  If any team member attempted to test a microservice locally outside Docker (`npm start` or `node index.js`), it immediately crashed attempting to resolve the unconfigured `<username>:<password>` placeholder.
* **The Solution**:
  Updated all service `.env` files to point to `mongodb://localhost:27017/smart_campus_access_db`.

---

## 2. API Gateway & Live Demonstration Console

### 🖥️ Feature 2.1: Embedded Live Demo Web Console (`http://localhost:4000/`)
* **Why it was added**:
  Presenting raw JSON responses in Postman during a live midterm demo can be dry. We added a lightweight, single-page executive console served directly by the existing `APIGateway_Microservice`:
  - **Zero extra packages & zero extra Docker containers**.
  - **No emojis & no AI-slop colors**: Designed with an enterprise dark slate security console aesthetic.
  - **Live Round-Robin Visualizer**: Displays cards for `AccessLog-Instance-1` (Port 5005) and `AccessLog-Instance-2` (Port 5015) that pulse and alternate with live request counters.
  - **Header Inspection Terminal**: Displays `X-Load-Balanced-By` and `X-Served-By-Instance` directly on screen.
  - **Served with `Cache-Control: no-cache`** in `api-gateway.js` to prevent browser caching stale code.

---

### 🔧 Fix 2.2: Dynamic Target Room Dropdown Syncing
* **The Issue**:
  The Target Room dropdown in the swipe simulator initially had only 3 hardcoded rooms. When a new room was created in the database, it showed in the table but not in the swipe selector.
* **The Solution**:
  Updated `loadRoomInventory()` in `index.html` to dynamically query MongoDB and populate the dropdown with all current rooms and their lock states (e.g. `[LOCKED]`).

---

### 💡 Clarification & Feature 2.3: Visual Door Solenoid / Deadbolt Feedback
* **How Locking Works in this Architecture**:
  - **When a room is UNLOCKED (`isLocked: false`)**: Swiping a card returns `GRANTED`, and the electronic solenoid unlocks the door.
  - **When a room is LOCKED (`isLocked: true`)**: A professor or admin manually locked the room (`PATCH /api/rooms/:id/toggle-lock`). Swiping a badge returns `DENIED` with reason `ROOM_PHYSICALLY_LOCKED`. The solenoid remains deadbolted.
  - **Why HTTP status is `200 OK`**: In access control architectures, the HTTP call succeeded (the reader reached the Gateway and logged the audit entry), but the security decision inside the JSON payload is `accessDecision: DENIED`.
* **Visual Improvement**:
  Added a dedicated **Physical Solenoid / Lock Status** box above the swipe buttons that visually flashes:
  - Green: `SOLENOID RELEASED • Door Unlocked for ENG-301 [ACCESS GRANTED]`
  - Red: `DOOR DEADBOLTED • Denied (ROOM_PHYSICALLY_LOCKED) [ACCESS DENIED]`

---

## 3. Testing & Verification Tooling Added

1. **`run_tests.js`**:
   - A standalone Node.js automated test runner placed in the repository root.
   - Run `node run_tests.js` in the terminal to execute all 19 assertions defined in `test.md` in 2 seconds.
2. **Updated `test.md`**:
   - Added **Section 6: Interactive Web Console & Live UI Testing Guide** with instructions on demonstrating the load balancer, physical locks, and emergency lockdown.
3. **Added `README.md`**:
   - Comprehensive project overview, microservice architecture port map, and quick-start instructions for teammates and grading instructors.

---

## 4. Quick Commands for Teammates

```bash
# Start all 9 containers
docker compose up -d

# Check health of all containers
docker compose ps


## 5. Cloud Database Migration (MongoDB Atlas)

All microservices now connect to the cloud MongoDB Atlas replica set (`clusterdb`):
- **Atlas URI**: Configured across root `.env`, all 6 microservice `.env` files, and `docker-compose.yml`.

## 6. Authentication-First Flow & Role-Based UI (RBAC)

1. **Authentication Gate**:
   - Unauthenticated visitors are now shown a dedicated **Sign In Screen** first instead of directly exposing the control system.
   - Separate **Register Screen** accessible via a toggle link ("Don't have an account? Register here"), keeping Login and Register clean, focused, and distinct.
   - Includes one-click quick demo buttons (`[Admin]`, `[Faculty]`, `[Student]`) for rapid evaluation and testing.

2. **Role-Based Access Control in the UI**:
   - **Student / Faculty**:
     - Cannot see or use the **Quick Create Room** form (hidden from UI).
     - Cannot see or trigger **Emergency Lockdown** action buttons (shows "Admin Clearance Required").
     - Cannot click lock/unlock on campus rooms; the Action column displays `<span class="pill pill-neutral">Read Only</span>`.
   - **Admin**:
     - Full management access: can create rooms, lock/unlock rooms, and trigger campus-wide lockdowns.
   - **Sign Out**:
     - Added a clean **Sign Out** button in the top navigation bar and session banner to return to the login gate at any time.

3. **Clean Session Isolation**:
   - Removed in-session role switcher buttons (`Switch: Admin`, `Switch: Faculty`, `Switch: Student`) to maintain strict session integrity. To change roles or accounts, users must legitimately sign out and sign in.
   - Restricted the `Run test.md Verification` button and Automated Verification Suite Terminal strictly to `admin` users; students and faculty only see their appropriate workspace.
