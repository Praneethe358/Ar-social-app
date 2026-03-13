import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import postsRouter from './routes/posts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ar_social_network';

app.use(cors());
app.use(express.json());

/* ── API routes ── */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ar-social-api' });
});

app.use('/api/ar-posts', postsRouter);

/* ── Serve Vite build in production ── */
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback — any non-API route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

/* ── Start ── */
async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`✓ MongoDB connected: ${MONGO_URI}`);

    app.listen(PORT, () => {
      console.log(`✓ Server running on http://localhost:${PORT}`);
      console.log(`  API:      /api/ar-posts`);
      console.log(`  Frontend: ${distPath}`);
    });
  } catch (error) {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  }
}

startServer();
