const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rootRouter = require('./routes/root.js');
const roomRoutes = require('./routes/roomRoutes.js');
const setupSocket = require('./socket.ts');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use('/api/v1', roomRoutes);

// Routes
// app.use('/', rootRouter);
app.get('/', (req, res) => {
    res.send('Server is running!');
  });
  

// Socket.io logic
setupSocket(io);

const port = process.env.PORT || 3001;
server.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
