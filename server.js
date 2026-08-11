const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  transports: ['websocket', 'polling']
});
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
let rooms = {};

rooms['PUBLIC'] = { players: [], gameState: 'lobby' };

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', (roomCode, name) => {
    roomCode = roomCode.toUpperCase();
    if(!rooms[roomCode]) rooms[roomCode] = { players: [], gameState: 'lobby' };

    rooms[roomCode].players.push({id: socket.id, name, role: null, team: null});
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = name;

    io.to(roomCode).emit('roomUpdate', rooms[roomCode].players);
  });

  socket.on('startGame', (roomCode) => {
    let room = rooms[roomCode];
    if(room.players.length < 4) return;

    room.gameState = 'team_phase';
    const total = room.players.length;

    // 1 gangster per 4 people
    let gangsterCount = Math.max(1, Math.floor(total / 4));
    let roles = [];
    for(let i=0; i<gangsterCount; i++) roles.push('Gangster');
    roles.push('Police', 'Reporter');
    while(roles.length < total) roles.push('Citizen');

    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    // Assign roles + teams
    let shuffledPlayers = [...room.players].sort(() => Math.random() - 0.5);
    shuffledPlayers.forEach((p, i) => {
      p.role = roles[i];
      p.team = p.role === 'Gangster'? 'Gangster' : 'Citizen'; // Police/Reporter are on Citizen team for chat

      io.to(p.id).emit('role', p.role, p.team);
      socket.join(roomCode + '-team-' + p.team);
    });

    io.to(roomCode).emit('phaseUpdate', 'TEAM PHASE: 2 minutes. Plan in your team chat!');

    // Switch to general phase after 2 minutes
    setTimeout(() => {
      room.gameState = 'general_phase';
      io.to(roomCode).emit('phaseUpdate', 'GENERAL PHASE: Everyone together. Debate and Vote!');
    }, 120000);
  });

  // Team chat - only your team can see
  socket.on('teamMsg', (roomCode, team, msg) => {
    io.to(roomCode + '-team-' + team).emit('teamChat', msg);
  });

  // General chat - everyone
  socket.on('generalMsg', (roomCode, msg) => {
    io.to(roomCode).emit('generalChat', msg);
  });

  // Team voice ping
  socket.on('joinTeamVoice', (roomCode, team) => {
    socket.join(roomCode + '-voice-' + team);
    socket.to(roomCode + '-voice-' + team).emit('teamPing', socket.playerName + ' joined team voice');
  });

  socket.on('disconnect', () => {
    if(socket.roomCode && rooms[socket.roomCode]) {
      rooms[socket.roomCode].players = rooms[socket.roomCode].players.filter(p => p.id!== socket.id);
      io.to(socket.roomCode).emit('roomUpdate', rooms[socket.roomCode].players);
    }
  });
});

http.listen(PORT, () => console.log('Server on port', PORT));
