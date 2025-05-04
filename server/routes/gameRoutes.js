// routes/gameRoutes.js
const express = require('express');
const router = express.Router();
const gameService = require('../services/gameService');

// Example stub: Get game state for a room
router.get('/state/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  const state = gameService.getGameState(roomCode);
  if (!state) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json(state);
});

module.exports = router;
