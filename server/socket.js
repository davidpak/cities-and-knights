const { rollDice, placeSettlement } = require('./controllers/gameController');
const { joinRoom,
        createRoom, 
        getPlayersInRoom, 
        handleDisconnect,
        updateNickname,
        toggleReady,
        startGame,
        renderRoom
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
    socket.on('toggleReady', toggleReady(socket, io));
    socket.on('gameStarted', startGame(socket, io));
    socket.on('renderRoom', renderRoom(io));
    socket.on('placeSettlement', placeSettlement(socket, io));

    socket.on('disconnect', () => {
        handleDisconnect(socket, io)
    });
  });
}

module.exports = setupSocket;
