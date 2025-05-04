const { gameState, activeRooms } = require('../gameState');

// Track players per room
const playersInRoom = {};

function createRoom(socket, io) {
  return (roomCode) => {
    activeRooms.add(roomCode);
    gameState[roomCode] = { lastRoll: null };
    playersInRoom[roomCode] = [socket.id];

    socket.join(roomCode);
    socket.emit('roomJoined', roomCode);
    io.to(roomCode).emit('playerList', playersInRoom[roomCode]);
    console.log(`Room created and joined: ${roomCode}`);
  };
}

function joinRoom(socket, io) {
  return (roomCode) => {
    if (!activeRooms.has(roomCode)) {
      socket.emit('errorMessage', 'Room does not exist');
      return;
    }

    socket.join(roomCode);

    if (!playersInRoom[roomCode]) {
      playersInRoom[roomCode] = [];
    }
    playersInRoom[roomCode].push(socket.id);

    socket.emit('roomJoined', roomCode);
    socket.emit('gameState', gameState[roomCode]);
    io.to(roomCode).emit('playerList', playersInRoom[roomCode]);
    console.log(`Client ${socket.id} joined room ${roomCode}`);
  };
}

function getPlayersInRoom(socket) {
    return (roomCode) => {
        if (playersInRoom[roomCode]) {
            socket.emit('playerList', playersInRoom[roomCode]);
        }
    };
}

function handleDisconnect(socket, io) {
  for (const [roomCode, players] of Object.entries(playersInRoom)) {
    const index = players.indexOf(socket.id);
    if (index !== -1) {
      players.splice(index, 1);
      io.to(roomCode).emit('playerList', players);
      console.log(`Client ${socket.id} left room ${roomCode}`);
    }
  }
}

module.exports = {
  createRoom,
  joinRoom,
  handleDisconnect,
  getPlayersInRoom
};
