const socket = io();

const el = {
  badge: document.getElementById("badge"),
  name: document.getElementById("name"),
  room: document.getElementById("room"),
  joinBtn: document.getElementById("joinBtn"),
  shareBtn: document.getElementById("shareBtn"),
  stopBtn: document.getElementById("stopBtn"),
  copyBtn: document.getElementById("copyBtn"),
  status: document.getElementById("status"),

  remoteVideo: document.getElementById("remoteVideo"),
  localPreview: document.getElementById("localPreview"),

  chatBox: document.getElementById("chatBox"),
  chatInput: document.getElementById("chatInput"),
  sendBtn: document.getElementById("sendBtn"),
};

let roomId = "";
let role = "";
let pc = null;
let localStream = null;
let connected = false;

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

function setBadge(text) {
  el.badge.textContent = text;
}

function setStatus(text) {
  el.status.textContent = text;
}

function addLine(text, cls="") {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  el.chatBox.appendChild(div);
  el.chatBox.scrollTop = el.chatBox.scrollHeight;
}

function roomLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

function cleanupPC() {
  try { if (pc) pc.close(); } catch {}
  pc = null;
}

function ensurePC() {
  if (pc) return pc;

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("webrtc-ice", { roomId, candidate: e.candidate });
  };

  pc.onconnectionstatechange = () => {
    setStatus(`connection: ${pc.connectionState}`);
  };

  pc.ontrack = (e) => {
    // guest remote stream burada düşür
    const [stream] = e.streams;
    if (stream) {
      el.remoteVideo.srcObject = stream;
      setBadge("live");
      setStatus("Ekran gəlir ✅");
    }
  };

  return pc;
}

async function startShare() {
  if (role !== "host") return;

  // Screen share HTTPS tələb edir (localhost istisna).
  // Browser açanda bir popup çıxacaq: Screen/Window/Tab seç.
  localStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: true
  });

  el.localPreview.srcObject = localStream;
  el.localPreview.style.display = "block";

  // share bitəndə avtomatik dayansın
  localStream.getVideoTracks()[0].addEventListener("ended", () => stopShare());

  const pc0 = ensurePC();
  // əvvəlki track-ləri təmizlə (təkrar share)
  pc0.getSenders().forEach((s) => { try { pc0.removeTrack(s); } catch {} });

  for (const track of localStream.getTracks()) {
    pc0.addTrack(track, localStream);
  }

  // Guest varsa offer göndər
  await makeOffer();

  setBadge("sharing");
  setStatus("Ekran paylaşırsan ✅ Linki dostuna at.");
  el.stopBtn.disabled = false;
}

async function stopShare() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  el.localPreview.srcObject = null;
  el.localPreview.style.display = "none";

  // əlaqə qalır, amma track dayandı
  setBadge("online");
  setStatus("Paylaşım dayandı.");
  el.stopBtn.disabled = true;
}

async function makeOffer() {
  if (role !== "host") return;
  const pc0 = ensurePC();

  // yalnız localStream varsa offer mənalıdır
  if (!localStream) return;

  const offer = await pc0.createOffer();
  await pc0.setLocalDescription(offer);

  socket.emit("webrtc-offer", { roomId, offer: pc0.localDescription });
}

async function handleOffer(offer) {
  // guest tərəfi
  const pc0 = ensurePC();
  await pc0.setRemoteDescription(offer);

  const answer = await pc0.createAnswer();
  await pc0.setLocalDescription(answer);

  socket.emit("webrtc-answer", { roomId, answer: pc0.localDescription });
}

async function handleAnswer(answer) {
  // host tərəfi
  const pc0 = ensurePC();
  await pc0.setRemoteDescription(answer);
}

async function handleICE(candidate) {
  const pc0 = ensurePC();
  try {
    await pc0.addIceCandidate(candidate);
  } catch (e) {
    // bəzən timing problem olur, ignore
  }
}

// UI: join
el.joinBtn.onclick = () => {
  roomId = el.room.value.trim();
  const name = el.name.value.trim() || "Anon";
  if (!roomId) return setStatus("Room yaz.");

  socket.emit("join-room", { roomId, name });
};

el.copyBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(roomLink());
    setStatus("Link kopyalandı ✅");
  } catch {
    setStatus(roomLink());
  }
};

el.shareBtn.onclick = async () => {
  try {
    await startShare();
  } catch (e) {
    setStatus("Screen share açılmadı. HTTPS olmalıdır və icazə verməlisən.");
  }
};

el.stopBtn.onclick = () => stopShare();

// Chat
el.sendBtn.onclick = () => {
  const name = el.name.value.trim() || "Anon";
  const text = el.chatInput.value.trim();
  if (!roomId || !text) return;
  socket.emit("chat", { roomId, name, text });
  el.chatInput.value = "";
};
el.chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") el.sendBtn.click();
});

// Socket events
socket.on("connect", () => {
  connected = true;
  setBadge("online");
});

socket.on("disconnect", () => {
  connected = false;
  setBadge("offline");
  setStatus("Serverlə əlaqə kəsildi.");
  cleanupPC();
});

socket.on("joined", ({ roomId: rid, role: r }) => {
  roomId = rid;
  role = r;

  setStatus(`Qoşuldun. Role: ${role}`);
  el.copyBtn.disabled = false;

  if (role === "host") {
    el.shareBtn.disabled = false;
    addLine("Sistem: Sən host-san. Ekranı paylaş və linki göndər.", "sys");
  } else {
    el.shareBtn.disabled = true;
    addLine("Sistem: Guest kimi qoşuldun. Host paylaşanda ekran gələcək.", "sys");
  }

  // URL-ə room yaz (link rahat olsun)
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url.toString());
});

socket.on("need-offer", async () => {
  // guest qoşuldu -> host offer göndərsin
  if (role === "host" && localStream) {
    await makeOffer();
  } else if (role === "host" && !localStream) {
    setStatus("Guest qoşuldu. Ekranı paylaş ki görüntü getsin.");
  }
});

socket.on("webrtc-offer", async ({ offer }) => {
  if (role !== "guest") return;
  await handleOffer(offer);
  setStatus("Host paylaşım göndərdi. Qoşulursan...");
});

socket.on("webrtc-answer", async ({ answer }) => {
  if (role !== "host") return;
  await handleAnswer(answer);
});

socket.on("webrtc-ice", async ({ candidate }) => {
  await handleICE(candidate);
});

socket.on("room-full", () => setStatus("Otaq doludur (max 2 nəfər)."));
socket.on("err", (msg) => setStatus(msg));

socket.on("system", (t) => addLine(`Sistem: ${t}`, "sys"));
socket.on("chat", ({ name, text }) => addLine(`${name}: ${text}`));

// URL-də room varsa auto-fill
(function initFromURL(){
  const url = new URL(window.location.href);
  const r = url.searchParams.get("room");
  if (r) el.room.value = r;
})();
