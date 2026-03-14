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

app.use('/api/posts', postsRouter);

/* ── Serve Vite build in production ── */
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback — any non-API route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

/* ── Start ── */
async function startServer() {
  // Bind the port FIRST so Render doesn't kill us for "no open port"
  await new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`✓ Server listening on port ${PORT}`);
      console.log(`  API:      /api/ar-posts`);
      console.log(`  Frontend: ${distPath}`);
      resolve();
    });
  });

  // Then connect to MongoDB (retries every 5 s on failure)
  const connectWithRetry = async () => {
    try {
      await mongoose.connect(MONGO_URI);
      console.log(`✓ MongoDB connected`);
    } catch (error) {
      console.error('MongoDB connection failed:', error.message);
      console.log('Retrying in 5 seconds...');
      setTimeout(connectWithRetry, 5000);
    }
  };

  connectWithRetry();
}

startServer();
