import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import { PrismaClient } from "@prisma/client";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const redisClient = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
);

redisClient.on("connect", () => {
  console.log("🟢 Connected to Redis Streams");
});

redisClient.on("error", (err) => {
  console.error("🔴 Redis Error:", err.message);
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.adapter(createAdapter(redisClient));

// runs when a driver or parent connects
io.on("connection", (socket: Socket) => {
  console.log(`📡 New connection: ${socket.id}`);

  // parent logic
  socket.on("track-bus", (busId: string) => {
    console.log(`👁️ Client ${socket.id} is tracking bus: ${busId}`);
    socket.join(busId);
    console.log(`✅ Client ${socket.id} joined room ${busId}`);
  });

  // driver logic
  socket.on(
    "send-location",
    async (data: { 
      tripId?: string;
      busId: string;
      lat: number;
      lng: number;
      capturedAt?: string;
    }) => {
      console.log(
        `📍 Location ping from ${socket.id} for bus ${data.busId}: ${data.lat}, ${data.lng}`,
      );

      // sending driver location to parents
      io.to(data.busId).emit("live-location-update", {
        busId: data.busId,
        lat: data.lat,
        lng: data.lng,
        timestamp: data.capturedAt,
      });

      try {
        // these tripid things are just for saving in db
        let tripId = data.tripId;

        // if driver does not send tripid , find an active trip for this bus and attach it
        if (!tripId) {
          const activeTrip = await prisma.trip.findFirst({
            where: {
              busId: data.busId,
              status: "IN_PROGRESS",
            },
            orderBy: { scheduledAt: "desc" },
            select: { id: true },
          });
          tripId = activeTrip?.id;
        }

        // if there is no IN_PROGRESS trip, attach to the latest trip for this bus.
        if (!tripId) {
          const latestTrip = await prisma.trip.findFirst({
            where: { busId: data.busId },
            orderBy: { scheduledAt: "desc" },
            select: { id: true },
          });
          tripId = latestTrip?.id;
        }

        // If there is no active trip to attach this ping to, skip DB write but keep live broadcast.
        if (!tripId) {
          console.warn(
            `⚠️ Skipping location persistence: no tripId provided and no trip found for bus ${data.busId}`,
          );
          return;
        }

        await prisma.locationPing.create({
          data: {
            tripId,
            lat: data.lat,
            lng: data.lng,
            capturedAt: data.capturedAt
              ? new Date(data.capturedAt)
              : new Date(),
          },
        });
      } catch (error) {
        console.error("Database write failed:", error);
      }
    },
  );

  socket.on("disconnect", () => {
    console.log(`🔴 Disconnected: ${socket.id}`);
  });
});

app.get("/", (req, res) => {
  res.status(200).json({ status: "API is running", timestamp: new Date() });
});

app.get("/api/trips/:tripId/history", async (req, res) => {
  try {
    const history = await prisma.locationPing.findMany({
      where: { tripId: req.params.tripId },
      orderBy: { capturedAt: "asc" },
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 BusTrackr Backend running on port ${PORT}`);
});
