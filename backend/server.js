import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import { Server } from 'socket.io';
import { createServer } from 'http';
import postsRouter from './routes/posts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ar_social_network';

app.use(cors());
app.use(express.json());

// Pass io to routes
app.set('socketio', io);

/* ── Socket logic ── */
io.on('connection', (socket) => {
  console.log(`[Socket] New client: ${socket.id}`);

  // Spatial zoning: Join a room based on rounded GPS
  socket.on('join-zone', ({ lat, lng }) => {
    // Rooms are ~10km blocks (0.1 degree precision)
    const zoneId = `zone-${lat.toFixed(1)}-${lng.toFixed(1)}`;
    
    // Clear old zones
    socket.rooms.forEach(r => { if (r.startsWith('zone-')) socket.leave(r); });
    
    socket.join(zoneId);
    console.log(`[Socket] Client ${socket.id} joined ${zoneId}`);
  });

  socket.on('disconnect', () => console.log(`[Socket] Client disconnected`));
});

/* ── API routes ── */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ar-social-api', sockets: io.engine.clientsCount });
});

app.use('/api/posts', postsRouter);

/* ── Serve Vite build in production ── */
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

/* ── Start ── */
async function startServer() {
  httpServer.listen(PORT, () => {
    console.log(`✓ Server listening on port ${PORT}`);
  });

  const connectWithRetry = async () => {
    try {
      await mongoose.connect(MONGO_URI);
      console.log(`✓ MongoDB connected`);
    } catch (error) {
      console.error('MongoDB connection failed:', error.message);
      setTimeout(connectWithRetry, 5000);
    }
  };
  connectWithRetry();
}

startServer();
