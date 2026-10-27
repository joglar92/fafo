const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map(); // code -> { host, guest }

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

io.on('connection', (socket) => {
  socket.on('create', (cb) => {
    const code = genCode();
    rooms.set(code, { host: socket.id, guest: null });
    socket.join(code);
    socket.data.room = code;
    socket.data.role = 'host';
    if (cb) cb({ ok: true, code });
  });

  socket.on('join', (code, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return cb && cb({ ok: false, error: 'No existe esa sala' });
    if (room.guest) return cb && cb({ ok: false, error: 'La sala está llena' });
    room.guest = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.role = 'guest';
    if (cb) cb({ ok: true, code });
    socket.to(code).emit('opponent_joined');
  });

  // input: guest -> host  /  state: host -> guest
  socket.on('input', (data) => {
    if (socket.data.room) socket.to(socket.data.room).emit('input', data);
  });

  socket.on('state', (data) => {
    if (socket.data.room) socket.to(socket.data.room).emit('state', data);
  });

  // intercambio de planteles del modo carrera (host <-> guest)
  socket.on('squad', (data) => {
    if (socket.data.room) socket.to(socket.data.room).emit('squad', data);
  });

  socket.on('restart', () => {
    if (socket.data.room) socket.to(socket.data.room).emit('restart');
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    if (!code) return;
    socket.to(code).emit('opponent_left');
    const room = rooms.get(code);
    if (room && (room.host === socket.id || room.guest === socket.id)) {
      rooms.delete(code);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`FAFO escuchando en http://localhost:${PORT}`);
});
