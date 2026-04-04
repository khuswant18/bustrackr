import { Server as SocketIOServer, Socket } from 'socket.io';
import { PubSubService } from '../redis/pubsub.service';

export class LocationGateway {
  private activeUsers = 0;
  private readonly logger = {
    log: (msg: string) => console.log(`[LocationGateway] ${msg}`),
  };

  constructor(
    private io: SocketIOServer,
    private pubSubService: PubSubService,
  ) {
    this.initialize();
  }

  private initialize() {
    this.logger.log('WebSocket Server Initialized');

    // Subscribe to Redis channel for location updates
    this.pubSubService.subscribe('location-updates', (message: string) => {
      const locationData = JSON.parse(message);
      // Emit to all clients
      this.io.emit('receive-location', locationData);
      // Also emit to specific driver room
      this.io.to(locationData.id).emit('receive-location', locationData);
    });

    // Handle client connections
    this.io.on('connection', (client: Socket) => {
      this.handleConnection(client);

      client.on('disconnect', () => {
        this.handleDisconnect(client);
      });

      client.on('send-location', (data: { latitude: number; longitude: number }) => {
        this.handleLocation(client, data);
      });

      client.on('track-driver', (driverId: string) => {
        this.handleTrackDriver(client, driverId);
      });
    });
  }

  private handleConnection(client: Socket) {
    this.activeUsers++;
    this.logger.log(`Client connected: ${client.id}`);

    // Broadcast active user count
    this.io.emit('active-users', this.activeUsers);
  }

  private handleDisconnect(client: Socket) {
    this.activeUsers = Math.max(0, this.activeUsers - 1);
    this.logger.log(`Client disconnected: ${client.id}`);

    // Emit user disconnection event
    this.io.emit('user-disconnected', client.id);

    // Update active user count
    this.io.emit('active-users', this.activeUsers);
  }

  private handleLocation(
    client: Socket,
    data: { latitude: number; longitude: number },
  ) {
    this.logger.log(
      `Location received from ${client.id}: latitude=${data.latitude}, longitude=${data.longitude}`,
    );

    const locationData = {
      id: client.id,
      latitude: data.latitude,
      longitude: data.longitude,
    };

    // Publish to Redis for distribution across multiple server instances
    this.pubSubService.publish('location-updates', JSON.stringify(locationData));
  }

  private handleTrackDriver(client: Socket, driverId: string) {
    this.logger.log(`Client ${client.id} is tracking driver ${driverId}`);
    client.join(driverId);
  }
}
