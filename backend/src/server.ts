import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// ==========================================
// 1. INITIALIZATION
// ==========================================
const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json());

// ==========================================
// 2. REDIS STREAMS & SOCKET.IO SETUP
// ==========================================
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redisClient.on('connect', () => {
  console.log('🟢 Connected to Redis Streams');
});

redisClient.on('error', (err) => {
  console.error('🔴 Redis Error:', err.message);
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// MAGIC LINE: This adapter handles all the complex fault-tolerant routing automatically
io.adapter(createAdapter(redisClient));

// ==========================================
// 3. WEBSOCKET EVENT LISTENERS
// ==========================================
io.on('connection', (socket: Socket) => {
  console.log(`📡 New connection: ${socket.id}`);

  // --- PARENT: Join a specific bus tracking room ---
  socket.on('track-bus', (busId: string) => {
    console.log(`👁️ Client ${socket.id} is tracking bus: ${busId}`);
    socket.join(busId);
    console.log(`✅ Client ${socket.id} joined room ${busId}`);
  });

  // --- DRIVER: Emit live GPS pings ---
  socket.on('send-location', async (data: { tripId?: string; busId: string; lat: number; lng: number; capturedAt?: string }) => {
    console.log(`📍 Location ping from ${socket.id} for bus ${data.busId}: ${data.lat}, ${data.lng}`);
    
    // 1. Broadcast instantly to Parents in this bus's room (Zero latency)
    io.to(data.busId).emit('live-location-update', {
      busId: data.busId,
      lat: data.lat,
      lng: data.lng,
      timestamp: data.capturedAt
    });

    // 2. Save historical breadcrumb to PostgreSQL asynchronously
    try {
      let tripId = data.tripId;

      // Driver payloads may omit tripId; resolve from current in-progress trip for this bus.
      if (!tripId) {
        const activeTrip = await prisma.trip.findFirst({
          where: {
            busId: data.busId,
            status: 'IN_PROGRESS',
          },
          orderBy: { scheduledAt: 'desc' },
          select: { id: true },
        });
        tripId = activeTrip?.id;
      }

      // Fallback: if there is no IN_PROGRESS trip, attach to the latest trip for this bus.
      if (!tripId) {
        const latestTrip = await prisma.trip.findFirst({
          where: { busId: data.busId },
          orderBy: { scheduledAt: 'desc' },
          select: { id: true },
        });
        tripId = latestTrip?.id;
      }

      // If there is no active trip to attach this ping to, skip DB write but keep live broadcast.
      if (!tripId) {
        console.warn(`⚠️ Skipping location persistence: no tripId provided and no trip found for bus ${data.busId}`);
        return;
      } 

      await prisma.locationPing.create({
        data: {
          tripId,
          lat: data.lat,
          lng: data.lng,
          capturedAt: data.capturedAt ? new Date(data.capturedAt) : new Date(),
          // syncedAt is automatically handled by @default(now()) in Prisma
        }
      });
    } catch (error) {
      console.error('Database write failed:', error);
    }
  });

  // --- DRIVER: Transit Attendance Scan ---
  socket.on('transit-attendance', async (data: { tripId: string; studentId: string; method: any }) => {
    try {
      // Save the boarding event
      await prisma.boardingEvent.create({
        data: {
          tripId: data.tripId,
          studentId: data.studentId,
          method: data.method,
        }
      });
      // You could also emit an event here directly to the Parent to say "Boarded!"
      console.log(`✅ Student ${data.studentId} boarded trip ${data.tripId}`);
    } catch (error) {
      console.error('Failed to log attendance:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Disconnected: ${socket.id}`);
  });
});

// ==========================================
// 4. STANDARD REST API ROUTES
// ==========================================

// Health Check
app.get('/', (req, res) => {
  res.status(200).json({ status: 'API is running', timestamp: new Date() });
});

// Example: Get trip history for a parent's app
app.get('/api/trips/:tripId/history', async (req, res) => {
  try {
    const history = await prisma.locationPing.findMany({
      where: { tripId: req.params.tripId },
      orderBy: { capturedAt: 'asc' }
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ==========================================
// 5. START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 BusTrackr Backend running on port ${PORT}`);
});