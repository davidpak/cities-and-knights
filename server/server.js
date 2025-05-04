const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

const port = process.env.PORT || 3001;

// Store game state per room
let gameState = {};
// Set of active rooms to ensure unique room codes
let activeRooms = new Set();

app.get('/', (req, res) => {
    res.send('Cities & Knights Server is live!');
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Create room event
    socket.on('createRoom', (roomCode) => {
        // Prevent creating a room if it already exists
        if (activeRooms.has(roomCode)) {
            socket.emit('errorMessage', 'Room already exists');
            return;
        }

        // Add the room to the active rooms set
        activeRooms.add(roomCode);
        // Initialize game state for the room
        gameState[roomCode] = { lastRoll: null };

        // Join the room
        socket.join(roomCode);
        socket.emit('roomJoined', roomCode);
        console.log(`Room created and joined: ${roomCode}`);
    });

    // Join room event
    socket.on('joinRoom', (roomCode) => {
        // Check if the room exists
        if (!activeRooms.has(roomCode)) {
            socket.emit('errorMessage', 'Room does not exist');
            return;
        }

        // Join the room
        socket.join(roomCode);
        socket.emit('roomJoined', roomCode);
        socket.emit('gameState', gameState[roomCode]);
        console.log(`Client ${socket.id} joined room ${roomCode}`);
    });

    // Roll dice event
    socket.on('rollDice', (roomCode) => {
        // If the room exists, roll the dice and update game state
        if (!activeRooms.has(roomCode)) return;

        const dice1 = Math.ceil(Math.random() * 6);
        const dice2 = Math.ceil(Math.random() * 6);
        const roll = { dice1, dice2 };

        // Update the room's game state
        gameState[roomCode] = { lastRoll: roll };

        // Emit the dice roll result to all clients in the room
        io.to(roomCode).emit('diceRolled', roll);
        console.log(`Dice rolled in room ${roomCode}:`, roll);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});
