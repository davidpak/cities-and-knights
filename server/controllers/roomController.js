const { gameState, activeRooms } = require('../gameState');

function createRoom(socket) {
  return (roomCode) => {
    activeRooms.add(roomCode);
    gameState[roomCode] = { lastRoll: null };
    socket.join(roomCode);
    socket.emit('roomJoined', roomCode);
    console.log(`Room created and joined: ${roomCode}`);
  };
}

function joinRoom(socket) {
  return (roomCode) => {
    if (!activeRooms.has(roomCode)) {
      socket.emit('errorMessage', 'Room does not exist');
      return;
    }

    socket.join(roomCode);
    socket.emit('roomJoined', roomCode);
    socket.emit('gameState', gameState[roomCode]);
    console.log(`Client ${socket.id} joined room ${roomCode}`);
  };
}

module.exports = {
  createRoom,
  joinRoom,
};
