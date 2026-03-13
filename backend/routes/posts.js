import { Router } from 'express';
import Post from '../models/Post.js';

const router = Router();

router.post('/create', async (req, res) => {
  try {
    const { type, content, latitude, longitude, position, rotation } = req.body;

    // We no longer require latitude/longitude strictly since they default to 0 for AR mode
    if (!type || !content || !position || !rotation) {
      console.warn('[API] Missing required AR anchor fields in /create payload');
      return res.status(400).json({
        message: 'type, content, position, and rotation are required for AR objects.',
      });
    }

    const post = await Post.create({
      type,
      content,
      latitude,
      longitude,
      position,
      rotation,
    });

    console.log(`[API] Successfully saved AR post: ${post._id}`);
    return res.status(201).json({ post });
  } catch (error) {
    console.error('[API] /create error saving post:', error.message);
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
