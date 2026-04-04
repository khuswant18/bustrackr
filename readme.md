# Safely. — Practical System Design
**School Bus Real-Time Tracking Platform**
*Driver phone as GPS source · WebSocket real-time streaming · No IoT hardware · MVP in 4 weeks*

---

## 1. Product Breakdown

### Core Problem
25 million Indian parents have zero visibility when their child's school bus is delayed. Schools resist hardware CAPEX. Every existing solution sells to the wrong customer (the school) instead of the willing payer (the parent).

### Target Users
| User | Pain | What they need |
|------|------|----------------|
| Parent | No idea where the bus is | Live map + push alerts |
| Driver | Parents calling constantly | One-tap trip start, no more calls |
| School admin | Morning crisis calls flooding the office | Dashboard showing all buses live |

### MUST-HAVE features only (MVP)

**Driver app (Android)**
- Login with phone number OTP
- Select assigned bus from list
- Tap "Start Trip" → GPS broadcast begins
- Tap "End Trip" → GPS broadcast stops
- Delay reason selector (Traffic / Breakdown / School delay)
- App stays alive in background (foreground service)

**Parent app (Android + iOS)**
- Login with phone OTP (linked to school by school admin)
- Live bus map — green dot moving every 5 seconds
- Push notification: trip started + ETA
- Push notification: bus delayed + reason
- Push notification: bus 500m from stop
- Push notification: trip complete
- See stops remaining + driver name

**School dashboard (web)**
- Login with email + password
- Add/remove drivers and assign to buses
- Add/remove routes and stops
- Add parents and link to student + route
- Live map showing ALL active buses
- Mark school holiday (cancels all trips)
- View trip history (last 30 days)

---

## 2. High-Level Architecture

**Monolith first. Split later.**

```
Driver App (React Native Android)
    |
    | HTTP POST every 5s → /api/location
    |
    ↓
Node.js + Express + Socket.io (single server)
    |
    ├── Stores last known location → Redis (in-memory Map for pilot)
    ├── Broadcasts location → Socket.io room (trip_${tripId})
    ├── Checks geofences → Triggers FCM push notifications
    ├── Checks delay logic → Triggers WhatsApp via Meta API
    └── Reads/Writes → PostgreSQL (Supabase)

Socket.io rooms
    |
    | Parent subscribes to room "trip_abc123"
    | Server emits "location" event every 5s
    ↓
Parent App (React Native) — map marker moves live

School Dashboard (Next.js web)
    |
    | REST API calls for management
    | Socket.io subscription to "school_xyz" room (all buses)
    ↓
Node.js Backend + Supabase
```

**Why this works:**
- Socket.io runs inside the same Node.js server — no separate infrastructure
- Driver posts location via HTTP → server broadcasts to all parents via WebSocket in the same request handler
- Redis (or in-memory Map for pilot) stores last known location so parents joining mid-trip see the bus immediately without waiting for the next driver POST
- PostgreSQL handles all structured data — users, routes, trips, schools
- One server handles everything comfortably up to ~500 concurrent WebSocket connections (around 50 active buses with 10 parents each)

---

## 3. Tech Stack

### Frontend
| Layer | Choice | Why |
|-------|--------|-----|
| Driver app | React Native + Expo | Single codebase, fast build, Expo Go for pilot (no store submission) |
| Parent app | React Native + Expo | Same codebase as driver app, shared components |
| School dashboard | Next.js | Fast to build, SSR for dashboard loads, deploy free on Vercel |

### Backend
| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 20 + Express | Fast to write, huge ecosystem, your team knows it |
| Real-time streaming | Socket.io | Built-in room management, automatic reconnection, works with React Native, runs inside Express server — zero extra infra |
| Live location state | In-memory Map (pilot) → Upstash Redis (scale) | Stores last known location per trip so parents joining mid-trip see the bus immediately |
| Push notifications | Firebase Cloud Messaging (FCM) | Free, works on Android + iOS, single API |
| WhatsApp alerts | Meta Cloud API (WhatsApp Business) | Official API, free tier for first 1k conversations/month |
| Auth | Firebase Auth (OTP) | Phone OTP built-in, free, handles SMS cost |

### Database
| Data type | Choice | Why |
|-----------|--------|-----|
| Structured data (users, routes, trips) | PostgreSQL via Supabase | Free tier, real-time subscriptions, built-in REST API, row-level security |
| Live location state | In-memory Map on server (pilot) | Zero cost, instant reads, sufficient for 1 pilot school. Upgrade to Redis when you go multi-server |
| Live location state (scale) | Upstash Redis | Free tier, serverless, stores last known location per trip_id |
| Media/files | Supabase Storage | Free tier, same SDK |

### Hosting
| Service | Host | Cost at pilot |
|---------|------|---------------|
| Backend API + Socket.io server | Railway.app | Free tier → $5/mo |
| School dashboard | Vercel | Free |
| Domain | Namecheap | ₹900/year |
| Firebase (Auth + FCM only) | Google | Free tier |
| Supabase (PostgreSQL) | Supabase | Free tier |
| Redis (live location cache) | Upstash | Free tier (10k requests/day) |

**Total infra cost at pilot: ₹0 – ₹500/month**

---

## 4. Database Design

### PostgreSQL tables (Supabase)

```sql
-- Schools
schools
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  name          TEXT NOT NULL
  city          TEXT
  contact_email TEXT UNIQUE
  contact_phone TEXT
  created_at    TIMESTAMPTZ DEFAULT NOW()

-- Users (all user types in one table, role differentiates)
users
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  phone         TEXT UNIQUE NOT NULL
  name          TEXT
  role          TEXT CHECK (role IN ('driver','parent','admin'))
  school_id     UUID REFERENCES schools(id)
  fcm_token     TEXT          -- push notification token
  whatsapp_opt_in BOOLEAN DEFAULT true
  created_at    TIMESTAMPTZ DEFAULT NOW()

-- Buses
buses
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID REFERENCES schools(id)
  bus_number    TEXT NOT NULL
  capacity      INT
  created_at    TIMESTAMPTZ DEFAULT NOW()

-- Routes
routes
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID REFERENCES schools(id)
  name          TEXT NOT NULL  -- "Route A - Sector 14"
  type          TEXT CHECK (type IN ('morning','afternoon'))
  created_at    TIMESTAMPTZ DEFAULT NOW()

-- Stops (ordered within a route)
stops
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  route_id      UUID REFERENCES routes(id)
  name          TEXT NOT NULL
  lat           DECIMAL(9,6) NOT NULL
  lng           DECIMAL(9,6) NOT NULL
  sequence      INT NOT NULL   -- order of stop on route
  geofence_radius_m INT DEFAULT 500

-- Students
students
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID REFERENCES schools(id)
  name          TEXT NOT NULL
  route_id      UUID REFERENCES routes(id)
  stop_id       UUID REFERENCES stops(id)
  created_at    TIMESTAMPTZ DEFAULT NOW()

-- Parent-Student link (one parent can have multiple children)
parent_students
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  parent_id     UUID REFERENCES users(id)
  student_id    UUID REFERENCES students(id)
  UNIQUE(parent_id, student_id)

-- Secondary contacts (nanny, grandparent)
secondary_contacts
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  student_id    UUID REFERENCES students(id)
  name          TEXT
  phone         TEXT
  whatsapp_opt_in BOOLEAN DEFAULT true

-- Driver-Bus assignment (daily)
driver_assignments
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  driver_id     UUID REFERENCES users(id)
  bus_id        UUID REFERENCES buses(id)
  route_id      UUID REFERENCES routes(id)
  assigned_date DATE NOT NULL
  UNIQUE(driver_id, assigned_date)

-- Trips (one per route per day)
trips
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  route_id      UUID REFERENCES routes(id)
  bus_id        UUID REFERENCES buses(id)
  driver_id     UUID REFERENCES users(id)
  started_at    TIMESTAMPTZ
  ended_at      TIMESTAMPTZ
  status        TEXT CHECK (status IN ('scheduled','active','delayed','completed','cancelled'))
  delay_reason  TEXT
  date          DATE NOT NULL DEFAULT CURRENT_DATE
  created_at    TIMESTAMPTZ DEFAULT NOW()

-- School holidays
holidays
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID REFERENCES schools(id)
  date          DATE NOT NULL
  reason        TEXT
  UNIQUE(school_id, date)
```

### WebSocket server setup (inside Express)

```javascript
// server.js — Socket.io runs inside the same Express server
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// In-memory store for pilot — replace with Redis at scale
const liveLocations = new Map();
// key: trip_id
// value: { lat, lng, speed_kmh, heading, timestamp, stops_remaining, eta_minutes }

io.on('connection', (socket) => {

  // Parent app subscribes to a specific trip
  socket.on('subscribe_trip', ({ trip_id }) => {
    socket.join(`trip_${trip_id}`);

    // Immediately send last known location so parent
    // doesn't wait up to 5s for the next driver POST
    const lastKnown = liveLocations.get(trip_id);
    if (lastKnown) {
      socket.emit('location', lastKnown);
    }
  });

  // School dashboard subscribes to all buses for their school
  socket.on('subscribe_school', ({ school_id }) => {
    socket.join(`school_${school_id}`);

    // Send all active trips for this school immediately
    const activeForSchool = [...liveLocations.entries()]
      .filter(([tid, data]) => data.school_id === school_id)
      .map(([tid, data]) => ({ trip_id: tid, ...data }));
    socket.emit('all_locations', activeForSchool);
  });

  socket.on('disconnect', () => {
    // Socket.io handles cleanup automatically
  });
});

httpServer.listen(3000);
```

### Location broadcast — called inside POST /api/location

```javascript
// When driver posts a location update:
app.post('/api/location', verifyFirebaseToken, async (req, res) => {
  const { trip_id, lat, lng, speed_kmh, heading, timestamp } = req.body;

  const locationPayload = {
    trip_id, lat, lng, speed_kmh, heading, timestamp,
    bus_number: trip.bus_number,
    driver_name: trip.driver_name,
    school_id: trip.school_id,
    stops_remaining: await calculateStopsRemaining(trip_id, lat, lng),
    eta_minutes: await calculateETA(trip_id, lat, lng)
  };

  // 1. Update in-memory store (instant read for new connections)
  liveLocations.set(trip_id, locationPayload);

  // 2. Broadcast to all parents watching this trip
  io.to(`trip_${trip_id}`).emit('location', locationPayload);

  // 3. Broadcast to school dashboard watching all buses
  io.to(`school_${trip.school_id}`).emit('bus_update', locationPayload);

  // 4. Run geofence check (triggers FCM push if 500m threshold crossed)
  await checkGeofences(trip_id, lat, lng);

  res.json({ ok: true });
});
```

### Parent app — connecting to WebSocket (React Native)

```javascript
// parentTrackingScreen.js
import { io } from 'socket.io-client';

const socket = io('https://api.safely-app.up.railway.app', {
  auth: { token: firebaseIdToken },
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000
});

useEffect(() => {
  socket.emit('subscribe_trip', { trip_id: activeTripId });

  socket.on('location', (data) => {
    // Animate map marker to new position
    setBusLocation({ lat: data.lat, lng: data.lng });
    setStopsRemaining(data.stops_remaining);
    setETA(data.eta_minutes);
  });

  socket.on('trip_ended', () => {
    setTripComplete(true);
    socket.disconnect();
  });

  return () => {
    socket.off('location');
    socket.disconnect();
  };
}, [activeTripId]);
```

### School dashboard — watching all buses (Next.js)

```javascript
// dashboardLiveMap.js
useEffect(() => {
  const socket = io('https://api.safely-app.up.railway.app', {
    auth: { token: adminJwt }
  });

  socket.emit('subscribe_school', { school_id: mySchoolId });

  // Initial state — all currently active buses
  socket.on('all_locations', (buses) => {
    setBusMarkers(buses);
  });

  // Per-bus updates as drivers post location
  socket.on('bus_update', (data) => {
    setBusMarkers(prev =>
      prev.map(b => b.trip_id === data.trip_id ? { ...b, ...data } : b)
    );
  });

  return () => socket.disconnect();
}, []);
```

**Key indexes to add from day one:**
```sql
CREATE INDEX idx_trips_date ON trips(date);
CREATE INDEX idx_trips_route ON trips(route_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_driver_assignments_date ON driver_assignments(assigned_date);
CREATE INDEX idx_stops_route ON stops(route_id, sequence);
CREATE INDEX idx_parent_students_parent ON parent_students(parent_id);
```

---

## 5. API Design

### Auth
Firebase Auth handles OTP. After phone verification, Firebase returns a JWT (`idToken`). All API calls include:
```
Authorization: Bearer {firebase_idToken}
```
Backend verifies token with Firebase Admin SDK on every request. No custom auth to build.

### Core endpoints

**Trip management**

```
POST /api/trips/start
Authorization: Bearer {token}
Body: { bus_id, route_id }
Response: { trip_id, status: "active" }

Side effects:
- Creates trips record in PostgreSQL
- Initialises liveLocations.set(trip_id, { status: 'active', school_id })
- Sends FCM push + WhatsApp to all parents on route
```

```
POST /api/trips/end
Body: { trip_id }
Response: { status: "completed", duration_minutes: 33 }

Side effects:
- Updates trips.ended_at and status in PostgreSQL
- liveLocations.delete(trip_id) — clears in-memory state
- io.to(`trip_${trip_id}`).emit('trip_ended') — disconnects all parent sockets
- Sends completion FCM to parents
```

```
POST /api/trips/delay
Body: { trip_id, reason: "traffic|breakdown|school_delay" }
Response: { ok: true }

Side effects:
- Updates trips.status and delay_reason
- Sends delay FCM + WhatsApp to parents
```

**Location update (called every 5 seconds by driver app)**

```
POST /api/location
Body: {
  trip_id,
  lat,
  lng,
  speed_kmh,
  heading,
  timestamp
}
Response: { ok: true }

Side effects:
- Updates liveLocations Map with new coordinates
- io.to(`trip_${trip_id}`).emit('location', payload) → parent apps update map
- io.to(`school_${school_id}`).emit('bus_update', payload) → dashboard updates
- Runs geofence check for each upcoming stop
- If bus within 500m of next stop → trigger 500m FCM push to parents at that stop
- If speed < 5 km/h for > 3 min → flag as possible delay (admin alert)
```

**School dashboard**

```
GET  /api/school/buses           → list all buses
POST /api/school/buses           → add bus { bus_number, capacity }

GET  /api/school/routes          → list routes with stops
POST /api/school/routes          → create route
POST /api/school/routes/:id/stops → add stop { name, lat, lng, sequence }

GET  /api/school/drivers         → list drivers
POST /api/school/drivers         → invite driver { phone, name }

GET  /api/school/parents         → list parents
POST /api/school/parents         → add parent { phone, name, student_name, route_id, stop_id }

POST /api/school/assignments     → assign driver to bus+route for date
GET  /api/school/trips?date=     → trip history with status
POST /api/school/holidays        → mark holiday { date, reason }

GET  /api/school/live  → all active trips with last known location from liveLocations Map
                         (used as initial state before WebSocket connects)
```

**Parent app**

```
GET /api/parent/trips/active
Response: [{
  trip_id,
  bus_number,
  driver_name,
  status,
  stops_remaining,
  eta_minutes,
  route_name,
  student_name,
  stop_name
}]

GET /api/parent/trips/history?limit=10
→ last 10 completed trips for parent's children
```

---

## 6. Core User Flows

### Flow 1 — Driver starts a trip

```
1. Driver opens app, sees "Start Trip" screen
2. App shows list of buses assigned to them for today
   → GET /api/school/assignments?driver_id=me&date=today
3. Driver selects bus G-045
4. Driver taps "Start Trip"
   → POST /api/trips/start { bus_id, route_id }
5. Backend:
   a. Creates trip row in PostgreSQL (status: active)
   b. Initialises liveLocations.set(trip_id, { status: 'active', school_id })
   c. Queries all parents on this route via parent_students + stops join
   d. Sends FCM push to all parent FCM tokens
   e. Sends WhatsApp message via Meta API to all parent phones with opt-in
6. Driver app starts expo-location foreground service
   → watchPositionAsync every 5 seconds
7. Every 5 seconds:
   → POST /api/location { trip_id, lat, lng, speed_kmh, heading }
   → Backend:
      a. liveLocations.set(trip_id, payload) — update in-memory state
      b. io.to(`trip_${trip_id}`).emit('location', payload)
         → All parent sockets in this room receive update instantly
      c. io.to(`school_${school_id}`).emit('bus_update', payload)
         → School dashboard map marker moves
      d. Runs geofence check:
         - Calculate Haversine distance to each upcoming stop
         - If distance <= 500m AND stop not yet alerted:
              → Send 500m FCM push to parents at that stop
              → alertedStops.add(`${trip_id}:${stop_id}`) — prevent double-send
8. Parent app receives 'location' WebSocket event
   → Google Maps marker animates to new coordinates
   → ETA and stops_remaining update on screen
   → No polling, no HTTP calls from parent app during trip
```

### Flow 2 — Parent opens live tracking mid-trip

```
1. Parent receives FCM push "Bus G-045 has started your route"
2. Parent taps notification → parent app opens live map screen
3. App calls GET /api/parent/trips/active
   → Gets trip_id, route info, student info, current ETA
4. App opens Socket.io connection and subscribes:
   socket.connect()
   socket.emit('subscribe_trip', { trip_id })
5. Server immediately sends last known location from liveLocations Map:
   socket.emit('location', liveLocations.get(trip_id))
   → Parent sees bus position instantly — no waiting for next driver POST
6. Every 5 seconds as driver posts:
   → Server emits 'location' event to room 'trip_{trip_id}'
   → Parent app marker animates on map
   → ETA and stops remaining update
7. When bus hits 500m geofence for parent's stop:
   → Backend sends FCM push (arrives even if app is backgrounded)
   → Parent app shows "Step outside now" banner
8. Trip ends (driver taps End Trip):
   → Backend: liveLocations.delete(trip_id)
   → Backend: io.to(`trip_${trip_id}`).emit('trip_ended')
   → Parent app shows "Trip completed" screen
   → FCM push: "Child dropped safely"
   → Socket disconnects automatically
```

### Flow 3 — School admin adds a parent

```
1. Admin opens dashboard → Parents tab
2. Fills form: Parent name, phone, child name, route, stop
3. POST /api/school/parents {
     parent_phone, parent_name,
     student_name, route_id, stop_id
   }
4. Backend:
   a. Creates user row (role: parent) if not exists
   b. Creates student row linked to route and stop
   c. Creates parent_students link
   d. Sends WhatsApp to parent: "You have been added to Safely. for [School Name].
      Download the app: [link]"
5. Parent receives WhatsApp, downloads app
6. Parent logs in with same phone number via OTP
7. App automatically shows their child's route and stop
```

### Flow 4 — Geofence alert trigger (backend logic)

```javascript
// In-memory Set for pilot — tracks which stops have been alerted per trip
// Key format: "tripId:stopId"
const alertedStops = new Set();

// Called every time POST /api/location is received
async function checkGeofences(tripId, currentLat, currentLng) {
  const upcomingStops = await getUpcomingStops(tripId); // cached, not DB hit every time

  for (const stop of upcomingStops) {
    const alertKey = `${tripId}:${stop.id}`;

    // Skip stops already alerted this trip
    if (alertedStops.has(alertKey)) continue;

    const distance = haversineDistance(
      currentLat, currentLng,
      stop.lat, stop.lng
    );

    if (distance <= stop.geofence_radius_m) {
      const parents = await getParentsAtStop(stop.id);

      // Send FCM push to all parents at this stop
      await admin.messaging().sendEachForMulticast({
        tokens: parents.map(p => p.fcm_token).filter(Boolean),
        notification: {
          title: 'Bus arriving soon',
          body: `Bus G-045 is 500m from your stop. Step outside now.`
        }
      });

      // Mark as alerted so we don't send again for this trip
      alertedStops.add(alertKey);
    }
  }
}

// Clean up when trip ends — prevent memory leak
function cleanupTrip(tripId) {
  for (const key of alertedStops) {
    if (key.startsWith(tripId)) alertedStops.delete(key);
  }
  liveLocations.delete(tripId);
}

// Haversine distance in metres
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

---

## 7. Scalability — Only What Actually Matters

### What breaks first at scale

| Bottleneck | Breaks at | Simple fix |
|------------|-----------|------------|
| Single Node.js WebSocket server | ~2,000 concurrent socket connections (~200 buses × 10 parents) | Add Redis adapter for Socket.io to run multiple server instances |
| In-memory liveLocations Map | Server restart loses all live state | Move to Redis — `SETEX trip:{id} 3600 {json}` |
| `/api/location` HTTP endpoint | ~500 req/sec (500 buses posting simultaneously) | Move driver location to WebSocket too — driver keeps persistent connection instead of HTTP POST every 5s |
| PostgreSQL connections | ~100 concurrent API requests | Supabase PgBouncer connection pooling — built in, just enable it |
| FCM send rate | ~500 notifications/second | FCM batch API — send to 500 tokens in one call instead of 500 calls |
| WhatsApp API rate | 80 messages/second per number | Bull queue + Redis, process in batches of 10 |

### Fixes to implement before scaling (not day one)

**Step 1 — Add Redis adapter for Socket.io (when you go multi-server)**
```javascript
// When Railway scales you to 2+ instances, WebSocket rooms break
// because Socket.io doesn't know about connections on other servers
// Fix: Redis adapter syncs rooms across all instances

const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: process.env.UPSTASH_REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
// That's it — now all instances share the same rooms
```

**Step 2 — Move liveLocations from in-memory Map to Redis**
```javascript
// Pilot: in-memory (fine for 1 server, lost on restart)
liveLocations.set(trip_id, payload);

// Scale: Redis with TTL (survives restarts, shared across servers)
await redis.setEx(`trip:${trip_id}`, 3600, JSON.stringify(payload));
const loc = JSON.parse(await redis.get(`trip:${trip_id}`));
```

**Step 3 — FCM batch notifications**
```javascript
// Bad — 200 individual calls:
for (const token of parentTokens) { await sendFCM(token, msg); }

// Good — one batch call for up to 500 tokens:
await admin.messaging().sendEachForMulticast({
  tokens: parentTokens,
  notification: { title, body }
});
```

**Step 4 — WhatsApp message queue (Bull + Redis)**
```javascript
const whatsappQueue = new Bull('whatsapp', { redis: process.env.UPSTASH_REDIS_URL });
whatsappQueue.add({ phone, message });
whatsappQueue.process(10, async (job) => {
  await sendWhatsApp(job.data.phone, job.data.message);
});
```

**Database indexes** — add these on day one, not after:
```sql
CREATE INDEX idx_trips_active ON trips(status, date) WHERE status = 'active';
CREATE INDEX idx_location_update ON trips(id, status);
```

---

## 8. Deployment Plan

### Week 1–3: Local development
```bash
# Run everything locally
node server.js          # Backend on localhost:3000
npx expo start          # Driver + parent app on phone via Expo Go
cd dashboard && npm run dev  # School dashboard on localhost:3001
```

### Week 4: Go live (pilot school)

**Step 1 — Deploy backend to Railway**
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up
# Railway auto-detects Node.js, gives you a URL: api.safely-app.up.railway.app
```

**Step 2 — Set environment variables in Railway dashboard**
```
FIREBASE_PROJECT_ID=safely-prod
FIREBASE_PRIVATE_KEY=...
DATABASE_URL=postgresql://...  (from Supabase)
META_WHATSAPP_TOKEN=...
META_PHONE_NUMBER_ID=...
UPSTASH_REDIS_URL=...          (add when ready to scale beyond pilot)
# No separate Firebase RTDB needed — Socket.io runs inside this server
```

**Step 3 — Deploy school dashboard to Vercel**
```bash
cd dashboard
vercel --prod
# Gives you: safely-dashboard.vercel.app
# Add custom domain: dashboard.safely.in
```

**Step 4 — Update app API URL**
```javascript
// config.js
const API_URL = __DEV__
  ? 'http://localhost:3000'
  : 'https://api.safely-app.up.railway.app';
```

**Step 5 — Test end-to-end with pilot school**
- Driver installs Expo Go, scans QR code
- Admin opens dashboard.safely.in
- Parent installs Expo Go, scans QR code
- Run one real trip

### CI/CD (keep it simple)

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install && npm test
      - run: railway up
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

That's the entire CI/CD. Push to main → tests run → backend deploys. Dashboard auto-deploys on Vercel on every push.

### Environment structure
```
/safely-backend      → Node.js API → Railway
/safely-dashboard    → Next.js → Vercel
/safely-app          → React Native → Expo (no hosting needed)
```

---

## 9. Future Upgrades — After PMF Only

**Do these only after 50+ schools, not before:**

| Upgrade | Why | When |
|---------|-----|-------|
| Switch `/api/location` from HTTP polling to WebSocket | Reduces overhead at 500+ concurrent buses | After 50 schools |
| MQTT broker (EMQX) instead of Firebase RTDB | Lower latency, lower cost at scale | After 100 schools |
| Separate notification microservice | Isolate WhatsApp/FCM queue from main API | After 200 schools |
| iOS app store submission | Reach iPhone parents | After pilot validated |
| AIS-140 hardware integration | Enterprise school sales, regulatory compliance | After Series A |
| AI delay prediction model | Predict delays before they happen using traffic APIs | After 6 months of trip data |
| Student boarding confirmation (RFID/manual) | Schools with strict attendance needs | After pilot feedback |
| Fintech layer — transport fee collection | Add transaction revenue stream | After 1,000 parents |
| Regional language support (Hindi, Tamil) | Tier-2 city expansion | After Delhi-NCR pilot |
| Driver safety score | Protect drivers + attract enterprise schools | After driver trust is established |

---

## Summary — What to build in 4 weeks

```
Week 1: Backend API + Firebase setup + Database schema
Week 2: Driver app (login, start trip, location broadcast)
Week 3: Parent app (live map, notifications) + School dashboard (basic)
Week 4: End-to-end testing + pilot school onboarding

Stack: Node.js + Express + Supabase + Firebase RTDB + React Native + Next.js
Cost to launch: ₹0 infrastructure (all free tiers)
Hosting: Railway (backend) + Vercel (dashboard) + Expo Go (apps during pilot)
Team size needed: 2 engineers + 1 person for school outreach
```