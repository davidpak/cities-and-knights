const { activeRooms } = require('../gameState');

function getAllRoomCodes() {
  return Array.from(activeRooms);
}

module.exports = {
  getAllRoomCodes,
};
