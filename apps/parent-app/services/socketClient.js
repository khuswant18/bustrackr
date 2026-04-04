import { io } from 'socket.io-client';

const BACKEND_URL = 'http://10.7.18.252:3000';

export const socket = io(BACKEND_URL, {
  autoConnect: true,
});
