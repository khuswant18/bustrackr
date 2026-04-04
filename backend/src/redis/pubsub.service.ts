import { Redis } from 'ioredis';

export class PubSubService {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor() {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
    const redisUsername = process.env.REDIS_USERNAME || '';
    const redisPassword = process.env.REDIS_PASSWORD || '';

    // Connect to Redis with configuration from environment variables
    this.publisher = new Redis({
      host: redisHost,
      port: redisPort,
      username: redisUsername || undefined,
      password: redisPassword || undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.subscriber = new Redis({
      host: redisHost,
      port: redisPort,
      username: redisUsername || undefined,
      password: redisPassword || undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.publisher.on('connect', () => {
      console.log('[Redis Publisher] Connected to Redis');
    });

    this.subscriber.on('connect', () => {
      console.log('[Redis Subscriber] Connected to Redis');
    });

    this.publisher.on('error', (err) => {
      console.error('[Redis Publisher Error]', err.message);
    });

    this.subscriber.on('error', (err) => {
      console.error('[Redis Subscriber Error]', err.message);
    });
  }

  publish(channel: string, message: string): void {
    this.publisher.publish(channel, message);
  }

  subscribe(channel: string, callback: (message: string) => void): void {
    this.subscriber.subscribe(channel, (err) => {
      if (err) {
        console.error(`Failed to subscribe to channel ${channel}:`, err);
      }
    });

    this.subscriber.on('message', (receivedChannel, receivedMessage) => {
      if (receivedChannel === channel) {
        callback(receivedMessage);
      }
    });
  }

  async disconnect(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}
