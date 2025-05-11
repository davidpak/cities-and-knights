const { gameState, activeRooms } = require('../gameState');
const { generateRandomCatanBoard} = require('../game/generateBoard');

// Track players per room
const playersInRoom = {};

function createRoom(socket, io) {
  return (roomCode) => {
    activeRooms.add(roomCode);
    gameState[roomCode] = { lastRoll: null };
    playersInRoom[roomCode] = [{ 
        socketId: socket.id,
        nickname: socket.id,
        color: '#888',
        isReady: false,
        isHost: true,
    }];

    socket.join(roomCode);
    socket.emit('roomJoined', roomCode);
    io.to(roomCode).emit('playerList', playersInRoom[roomCode]);
    console.log(`Room created and joined: ${roomCode}`);
  };
}

function joinRoom(socket, io) {
  return (roomCode) => {
    if (!activeRooms.has(roomCode)) {
      socket.emit('errorMessage', 'Room does not exist');
      return;
    }

    if (!playersInRoom[roomCode]) {
      playersInRoom[roomCode] = [];
    }

    if (gameState[roomCode]?.hasStarted) {
      socket.emit('errorMessage', "Game has already started. You cannot join now");
      return;
    }

    if (playersInRoom[roomCode].length >= 4) {
      socket.emit('errorMessage', 'Room is full. Maximum of 4 players is allowed.');
      return;
    }

    
    socket.join(roomCode);

    playersInRoom[roomCode].push({ 
        socketId: socket.id,
        nickname: socket.id,
        color: '#888',
        isReady: false,
        isHost: false,
      });

    socket.emit('roomJoined', roomCode);
    socket.emit('gameState', gameState[roomCode]);
    io.to(roomCode).emit('playerList', playersInRoom[roomCode]);
    console.log(`Client ${socket.id} joined room ${roomCode}`);
  };
}

function getPlayersInRoom(socket) {
    return (roomCode) => {
        if (playersInRoom[roomCode]) {
            socket.emit('playerList', playersInRoom[roomCode]);
        }
    };
}

function updateNickname(socket, io) {
    return (nickname) => {
      for (const [roomCode, players] of Object.entries(playersInRoom)) {
        const player = players.find((p) => p.socketId === socket.id);
        if (player) {
          player.nickname = nickname; // Update nickname
  
          // Emit updated player list to everyone in the room
          io.to(roomCode).emit('playerList', players);
          console.log(`Player ${socket.id} updated nickname to ${nickname} in room ${roomCode}`);
          break; // Stop once we find the player
        }
      }
    };
  }

function handleDisconnect(socket, io) {
    for (const [roomCode, players] of Object.entries(playersInRoom)) {
      const index = players.findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        players.splice(index, 1);
        io.to(roomCode).emit('playerList', players);
        console.log(`Client ${socket.id} left room ${roomCode}`);
        console.log(`There are ${players.length} players in room ${roomCode}`);
      }

      if (players.length === 0) {
        delete playersInRoom[roomCode];
        delete gameState[roomCode];
        activeRooms.delete(roomCode);
    }
    } 
}

function toggleReady(socket, io) {
    return (roomCode) => {
        const players = playersInRoom[roomCode];
        if (!players) return;

        const player = players.find(p => p.socketId === socket.id);
        if (player) {
            player.isReady = !player.isReady;
            console.log(`Player ${player.nickname} toggled ready.`)
            io.to(roomCode).emit('playerList', players);
        }
    }; 
}

function startGame(socket, io) {
  return (roomCode) => {
    const players = playersInRoom[roomCode];
    if (!players) return;

    const playerColors = ['red', 'blue', 'green', 'white'];
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

    const turnOrder = shuffledPlayers.map(p => p.socketId);

    // Assign colors directly to players
    const playerColorMap = {};
    shuffledPlayers.forEach((player, index) => {
      player.color = playerColors[index];
      playerColorMap[player.socketId] = playerColors[index];
    });

    const host = players.find(p => p.isHost);
    const allReady = players.every(p => p.isReady);

    if (host?.socketId === socket.id && allReady) {
      const board = generateRandomCatanBoard();
      gameState[roomCode] = {
        ...(gameState[roomCode] || {}),
        hasStarted: true,
        turnOrder,
        activePlayerIndex: 0,
        board,
        playerColors: playerColorMap,
        settlements: {},
      };
      console.log(`${host.nickname} has started the game for room: ${roomCode}`);
      io.to(roomCode).emit('gameStarted', roomCode);
      io.to(roomCode).emit('playerList', players); // Send updated players with colors
      io.to(roomCode).emit('gameState', gameState[roomCode]);
    }
  };
}


function renderRoom(io) {
  return (roomCode) => {
    if (!activeRooms.has(roomCode)) return;
    const state = gameState[roomCode];
    io.to(roomCode).emit('gameState', state);
  }
}


module.exports = {
  createRoom,
  joinRoom,
  handleDisconnect,
  getPlayersInRoom,
  updateNickname,
  toggleReady,
  startGame,
  renderRoom
};
