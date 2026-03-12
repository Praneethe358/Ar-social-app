import { Router } from 'express';
import Post from '../models/Post.js';

const router = Router();

router.post('/create', async (req, res) => {
  try {
    const { type, content, latitude, longitude } = req.body;

    if (!type || !content || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: 'type, content, latitude, and longitude are required.',
      });
    }

    const post = await Post.create({
      type,
      content,
      latitude,
      longitude,
    });

    return res.status(201).json({ post });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to create post.',
      error: error.message,
    });
  }
});

router.get('/nearby', async (_req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    return res.json({ posts });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to load nearby posts.',
      error: error.message,
    });
  }
});

export default router;
