const { gameState, activeRooms } = require('../gameState');
const GameEngine = require('../game/GameEngine');

function rollDice(io, socket) {
  return (roomCode) => {
    if (!activeRooms.has(roomCode)) return;
    const state = gameState[roomCode];
    if (!state || !state.hasStarted) return;

    const currentPlayerId = state.turnOrder[state.activePlayerIndex];
    if (socket.id !== currentPlayerId) {
      socket.emit('errorMessage', 'Actions can only be performed on your turn.');
      return;
    }

    const dice1 = Math.ceil(Math.random() * 6);
    const dice2 = Math.ceil(Math.random() * 6);
    const roll = { dice1, dice2 };

    state.lastRoll = roll;

    io.to(roomCode).emit('diceRolled', roll);

    state.activePlayerIndex = (state.activePlayerIndex + 1) % state.turnOrder.length;
    io.to(roomCode).emit('gameState', state);
  };
}

function placeSettlement(socket, io) {
  return ({ roomCode, vertexId} ) => {
    const state = gameState[roomCode];
    if (!state) return;

    const engine = new GameEngine(state);

    try {
      engine.placeSettlement(socket.id, vertexId);
    } catch (err) {
      socket.emit('errorMessage', err.message);
      return;
    }

    io.to(roomCode).emit('settlementPlaced', {
      playerId: socket.id,
      vertexId,
      color: state.playerColors[socket.id]
    });

    console.log(`Player ${socket.id} placed a settlement on vertex ${vertexId}`);

    io.to(roomCode).emit('gameState', state);
  };
}

module.exports = {
  rollDice,
  placeSettlement
};
