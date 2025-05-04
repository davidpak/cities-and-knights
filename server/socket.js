const { rollDice } = require('./controllers/gameController');
const { joinRoom,
        createRoom, 
        getPlayersInRoom, 
        handleDisconnect,
        updateNickname
       } = require('./controllers/roomController');

const { gameState, activeRooms } = require('./gameState');

function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('createRoom', createRoom(socket, io));
    socket.on('joinRoom', joinRoom(socket, io));
    socket.on('rollDice', rollDice(io, socket));
    socket.on('getPlayersInRoom', getPlayersInRoom(socket));
    socket.on('updateNickname', updateNickname(socket, io));

    socket.on('disconnect', () => {
        handleDisconnect(socket, io)
    });
  });
}

module.exports = setupSocket;
