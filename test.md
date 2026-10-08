# API Testing Guide (Postman & Manual Testing)

> **Base URL**:
> - Local Testing: `http://localhost:4000`
> - EC2 Deployment: `http://<EC2_PUBLIC_IP>:4000`

---

## 1. Test Registration

- **Method**: `POST`
- **URL**: `http://localhost:4000/reg`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body (raw JSON)**:
  ```json
  {
    "name": "Admin Director",
    "email": "admin@campus.edu",
    "password": "Password123!",
    "role": "admin",
    "department": "Campus Security"
  }
  ```
- **Expected Status**: `201 Created`
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "user": {
      "id": "USR-xxxx",
      "name": "Admin Director",
      "email": "admin@campus.edu",
      "role": "admin",
      "department": "Campus Security"
    }
  }
  ```

---

## 2. Test Login & Get JWT Token

- **Method**: `POST`
- **URL**: `http://localhost:4000/login`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body (raw JSON)**:
  ```json
  {
    "email": "admin@campus.edu",
    "password": "Password123!",
    "role": "admin"
  }
  ```
- **Expected Status**: `200 OK`
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "USR-xxxx",
      "name": "Admin Director",
      "email": "admin@campus.edu",
      "role": "admin"
    }
  }
  ```
> 📌 **Note**: Copy the returned `token` string for the protected requests below!

---

## 3. Test Room Management (With Token)

- **Method**: `POST`
- **URL**: `http://localhost:4000/api/rooms`
- **Headers**:
  ```http
  Content-Type: application/json
  Authorization: Bearer <PASTE_YOUR_TOKEN_HERE>
  ```
- **Body (raw JSON)**:
  ```json
  {
    "roomNumber": "ENG-301",
    "roomName": "Software Engineering Lab",
    "building": "Engineering Hall",
    "floor": 3,
    "roomType": "LAB",
    "capacity": 50,
    "securityClearance": "GENERAL"
  }
  ```
- **Expected Status**: `201 Created`
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "Room created successfully",
    "room": {
      "_id": "ROOM-xxxx",
      "roomNumber": "ENG-301",
      "roomName": "Software Engineering Lab",
      "building": "Engineering Hall",
      "capacity": 50,
      "securityClearance": "GENERAL",
      "isLocked": false,
      "isEmergencyLocked": false
    }
  }
  ```

---

## 4. Test Negative Cases (Required Assignment Screenshots)

### 4.1 Wrong Password
- **Method**: `POST`
- **URL**: `http://localhost:4000/login`
- **Headers**: `Content-Type: application/json`
- **Body (raw JSON)**:
  ```json
  {
    "email": "admin@campus.edu",
    "password": "WRONG_PASSWORD_123",
    "role": "admin"
  }
  ```
- **Expected Status**: `401 Unauthorized`
- **Expected Response**:
  ```json
  {
    "success": false,
    "message": "Invalid email, password, or role"
  }
  ```

---

### 4.2 Missing Token
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/rooms`
- **Headers**: *(Do NOT provide Authorization header)*
- **Expected Status**: `401 Unauthorized`
- **Expected Response**:
  ```json
  {
    "success": false,
    "error": "Unauthorized",
    "message": "Please send token. Bearer token is required in Authorization header."
  }
  ```

---

### 4.3 Invalid / Tampered Token
- **Method**: `GET`
- **URL**: `http://localhost:4000/api/rooms`
- **Headers**:
  ```http
  Authorization: Bearer fake123
  ```
- **Expected Status**: `403 Forbidden`
- **Expected Response**:
  ```json
  {
    "success": false,
    "error": "Forbidden",
    "message": "Invalid or expired token."
  }
  ```

---

### 4.4 Unauthorized Role (Role-Based Access Control)
1. Register and login as a `student`:
   - `POST http://localhost:4000/reg` with `"role": "student"`
   - `POST http://localhost:4000/login` to get the student token.
2. Attempt to create a room using the student token:
   - **Method**: `POST`
   - **URL**: `http://localhost:4000/api/rooms`
   - **Headers**:
     ```http
     Content-Type: application/json
     Authorization: Bearer <STUDENT_TOKEN>
     ```
   - **Body**:
     ```json
     {
       "roomNumber": "ENG-999",
       "roomName": "Unauthorized Room",
       "building": "Engineering Hall"
     }
     ```
- **Expected Status**: `403 Forbidden`
- **Expected Response**:
  ```json
  {
    "success": false,
    "error": "Unauthorized",
    "message": "Access denied. Role 'student' is unauthorized for this endpoint. Required role(s): [admin]"
  }
  ```

---

## 5. Test Door Badge Swipe & Load Balancing

### 5.1 Door Badge Swipe Simulation
- **Method**: `POST`
- **URL**: `http://localhost:4000/api/logs/swipe`
- **Headers**:
  ```http
  Content-Type: application/json
  Authorization: Bearer <TOKEN>
  ```
- **Body (raw JSON)**:
  ```json
  {
    "userId": "USR-1001",
    "userEmail": "student@campus.edu",
    "userRole": "student",
    "roomId": "ROOM-ENG301",
    "roomNumber": "ENG-301",
    "building": "Engineering Hall"
  }
  ```
- **Expected Status**: `200 OK`
- **Response Headers to inspect**:
  - `X-Load-Balanced-By`: `API-Gateway-RoundRobin`
  - `X-Served-By-Instance`: `AccessLog-Instance-1` or `AccessLog-Instance-2` *(Alternates on each request)*

---

## 6. Interactive Web Console & Live UI Testing Guide

In addition to manual Postman requests, the API Gateway serves an interactive live demonstration console.

- **Console URL**: `http://localhost:4000/` (or `http://localhost:4000/dashboard`)
- **EC2 Deployment URL**: `http://<EC2_PUBLIC_IP>:4000/`

### 6.1 Testing the Round-Robin Load Balancer Visually
1. Open `http://localhost:4000/` in your browser.
2. Under **Door Badge Swipe & Round-Robin Load Balancer**:
   - Select a room from the **Target Room** dropdown (e.g. `ENG-301`).
   - Click **"Swipe Badge (Single)"** or **"Simulate 4x Swipes"**.
3. **What to Observe**:
   - The active instance card (`AccessLog-Instance-1` vs `AccessLog-Instance-2`) highlights with a blue border during each request.
   - The request counters increment, maintaining an even 50% / 50% load distribution.
   - The **Physical Solenoid / Lock Status** box flashes `ACCESS GRANTED` in green when the room is unlocked.
   - The embedded terminal prints the required response headers:
     - `X-Load-Balanced-By: API-Gateway-RoundRobin`
     - `X-Served-By-Instance: AccessLog-Instance-1` / `AccessLog-Instance-2`
     - Status code and response latency.

### 6.2 Testing Room Management & Lock Control
1. In the **Campus Room Management** table on the right:
   - Click the **"Lock"** button on any room (e.g., `ENG-146`). The room status changes to `LOCKED`.
2. Go back to the swipe simulator, select that locked room, and click **"Swipe Badge (Single)"**.
3. **What to Observe**:
   - The solenoid status box flashes red: `DOOR DEADBOLTED • Denied (ROOM_PHYSICALLY_LOCKED)`.
   - Access decision returns `DENIED`.
4. Click **"Unlock"** on that room, swipe again, and observe access is restored (`ACCESS GRANTED`).
5. **Quick Create Room**:
   - Enter room details (e.g. `ENG-404`, `Robotics Lab`, `Engineering Hall`) and click **"Create"**.
   - The new room appears in both the management table and the Target Room dropdown.

### 6.3 Testing Campus Emergency Lockdown
1. In the top emergency banner, click **"Activate Campus Lockdown"**.
2. **What to Observe**:
   - The banner turns red: `CAMPUS LOCKDOWN ACTIVE`.
   - All rooms across the campus are immediately put into emergency lock.
   - Any student or faculty badge swipe is immediately denied with `CAMPUS_EMERGENCY_LOCKDOWN`.
3. Click **"Lift Lockdown"** to restore standard security policies.

### 6.4 One-Click Automated Verification
1. Click the blue **"Run test.md Verification"** button in the top session bar.
2. The verification terminal runs all 5 test sections live and displays a green `ALL CHECKS PASSED (100%)` badge.

