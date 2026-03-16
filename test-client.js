const io = require('socket.io-client');

// === CHANGE THIS LINE TO YOUR ACTUAL RENDER URL AFTER DEPLOY ===
const SOCKET_URL = 'http://localhost:3001';   // for local test
// Later change to: 'https://your-pinochle-server.onrender.com'

const socket = io(SOCKET_URL);

socket.on('connect', () => {
  console.log('Connected to Pinochle server!');
  
  // Join a test room as a player
  socket.emit('joinRoom', {
    roomId: 'testroom123',
    playerName: 'ChaseTestPlayer'
  });
});

socket.on('joined', (data) => {
  console.log('Joined successfully:', data);
});

socket.on('gameState', (state) => {
  console.log('Received game state update:');
  console.log('Phase:', state.phase);
  console.log('Players:', state.players.length);
  console.log('Trump:', state.trump || 'not set');
  console.log('Current turn:', state.currentTurn);
});

socket.on('connect_error', (err) => {
  console.log('Connection error:', err.message);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});