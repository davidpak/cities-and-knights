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

let gameState = {
    lastRoll: null,
};

app.get('/', (req, res) => {
    res.send('Cities & Knights Server is live!');
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.emit('gameState', gameState);

    socket.on('rollDice', () => {
        const dice1 = Math.ceil(Math.random() * 6);
        const dice2 = Math.ceil(Math.random() * 6);
        const roll = { dice1, dice2 };

        gameState.lastRoll = roll;

        io.emit('diceRolled', roll);
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

server.listen(3001, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:3001');
});
