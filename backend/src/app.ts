import express, { Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as dotenv from 'dotenv';
import { LocationGateway } from './websockets/location.gateway';
import { PubSubService } from './redis/pubsub.service';

dotenv.config();

const port: number = parseInt(process.env.PORT || '3335', 10);
const prefix: string = 'xam';

const app: Express = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3333',
      'http://localhost:3001',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
});

// Middleware
app.use(helmet());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3333',
      'http://localhost:3001',
      'http://localhost:3000',
    ],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(cookieParser());

// API Routes
app.get(`/${prefix}`, (req, res) => {
  const message = `Server is running successfully at ${new Date().toLocaleString()}`;
  console.log(message);
  res.status(200).json({ message });
});

// Health check endpoint
app.get(`/${prefix}/health`, (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Initialize WebSocket Gateway
const pubSubService = new PubSubService();
const locationGateway = new LocationGateway(io, pubSubService);

// Start server
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${port}`);
  console.log(`WebSocket available at ws://0.0.0.0:${port}/socket.io/`);
  console.log(`API prefix: /${prefix}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

