import { io } from 'socket.io-client';

const DEBUG = false;

const socket = io(
  DEBUG ? 'http://localhost:3001' : 'https://cities-and-knights-production.up.railway.app',
  { transports: ['websocket'] }
);

export default socket;
