const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(__dirname));


const rooms = new Map(); // roomId -> { hostId, guestId }

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { hostId: null, guestId: null });
  return rooms.get(roomId);
}

function safeEmit(to, event, payload) {
  if (to) io.to(to).emit(event, payload);
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, name }) => {
    roomId = String(roomId || "").trim();
    name = String(name || "Anon").trim().slice(0, 30);
    if (!roomId) return socket.emit("err", "Room boş ola bilməz.");

    const room = getRoom(roomId);

  

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    let role = "guest";
    if (!room.hostId) {
      room.hostId = socket.id;
      role = "host";
    } else if (!room.guestId && room.hostId !== socket.id) {
      room.guestId = socket.id;
      role = "guest";
    } else if (room.hostId === socket.id) {
      role = "host";
    } else if (room.guestId === socket.id) {
      role = "guest";
    }

    socket.emit("joined", { roomId, role });

    // məlumatlandırma
    socket.to(roomId).emit("system", `${name} qoşuldu (${role})`);

    // guest qoşulanda hosta "offer lazımdır" siqnalı
    if (role === "guest" && room.hostId) {
      safeEmit(room.hostId, "need-offer", { roomId });
    }

    // host qoşulanda, əgər guest var idisə hosta xəbər
    if (role === "host" && room.guestId) {
      safeEmit(room.hostId, "need-offer", { roomId });
    }
  });

  // WebRTC signaling: offer/answer/ice
  socket.on("webrtc-offer", ({ roomId, offer }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    // host -> guest
    if (room.guestId) safeEmit(room.guestId, "webrtc-offer", { offer });
  });

  socket.on("webrtc-answer", ({ roomId, answer }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    // guest -> host
    if (room.hostId) safeEmit(room.hostId, "webrtc-answer", { answer });
  });

  socket.on("webrtc-ice", ({ roomId, candidate }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // kim göndərib? qarşı tərəfə ötür
    if (socket.id === room.hostId && room.guestId) {
      safeEmit(room.guestId, "webrtc-ice", { candidate });
    } else if (socket.id === room.guestId && room.hostId) {
      safeEmit(room.hostId, "webrtc-ice", { candidate });
    }
  });

  socket.on("chat", ({ roomId, name, text }) => {
    const msg = String(text || "").slice(0, 500).trim();
    if (!msg) return;
    io.to(roomId).emit("chat", { name: String(name || "Anon").slice(0, 30), text: msg, ts: Date.now() });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const name = socket.data.name || "Biri";
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (room.hostId === socket.id) room.hostId = null;
    if (room.guestId === socket.id) room.guestId = null;

    io.to(roomId).emit("system", `${name} çıxdı`);

    // otaq boşdursa sil
    if (!room.hostId && !room.guestId) rooms.delete(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running: http://localhost:${PORT}`));



