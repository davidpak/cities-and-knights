const { gameState, activeRooms } = require('../gameState');

function rollDice(io, socket) {
  return (roomCode) => {
    if (!activeRooms.has(roomCode)) return;

    const dice1 = Math.ceil(Math.random() * 6);
    const dice2 = Math.ceil(Math.random() * 6);
    const roll = { dice1, dice2 };

    gameState[roomCode] = { lastRoll: roll };

    io.to(roomCode).emit('diceRolled', roll);
  };
}

module.exports = {
  rollDice,
};
