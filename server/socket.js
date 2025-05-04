const { rollDice } = require('./controllers/gameController');
const { joinRoom, createRoom } = require('./controllers/roomController');

const { gameState, activeRooms } = require('./gameState');

function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('createRoom', createRoom(socket));
    socket.on('joinRoom', joinRoom(socket));
    socket.on('rollDice', rollDice(io, socket));

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = setupSocket;
