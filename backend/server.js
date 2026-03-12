import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import postsRouter from './routes/posts.js';

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ar_social_network';

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ar-social-api' });
});

app.use('/api/posts', postsRouter);

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    // Keep startup logs concise but visible in terminal.
    console.log(`Connected to MongoDB at ${MONGO_URI}`);

    app.listen(PORT, () => {
      console.log(`API running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  }
}

startServer();
