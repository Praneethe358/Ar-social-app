import { Router } from 'express';
import Post from '../models/Post.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { type, content, latitude, longitude, position, rotation, timestamp } = req.body;

    // Strict validation for Day-3: GPS coordinates are now REQUIRED
    if (!type || !content || !position || !rotation || latitude === undefined || longitude === undefined) {
      console.warn('[API] Missing required fields including GPS coords');
      return res.status(400).json({
        message: 'type, content, position, rotation, latitude, and longitude are required.',
      });
    }

    const post = await Post.create({
      type,
      content,
      latitude,
      longitude,
      position,
      rotation,
      timestamp: timestamp || new Date(),
    });

    console.log(`[API] Saved AR post with GPS: ${latitude}, ${longitude}`);
    return res.status(201).json({ post });
  } catch (error) {
    console.error('[API] /create error:', error.message);
    return res.status(500).json({ message: 'Failed to create post.', error: error.message });
  }
});

router.get('/', async (_req, res) => {
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
