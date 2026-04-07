import { io } from 'socket.io-client';
import { Platform } from 'react-native';

const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://10.7.4.75:3000');

export const socket = io(BACKEND_URL, {
  autoConnect: false,
  transports: ['websocket'],
});
