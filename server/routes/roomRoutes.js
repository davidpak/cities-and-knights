// routes/roomRoutes.js
const express = require('express');
const router = express.Router();
const roomService = require('../services/roomService');

// Example: Get all active room codes
router.get('/rooms', (req, res) => {
  const rooms = roomService.getAllRoomCodes();
  res.json({ rooms });
});

module.exports = router;
