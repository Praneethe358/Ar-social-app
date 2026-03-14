import express from 'express';
import Post from '../models/Post.js'; // Extension is required for ES Modules

const router = express.Router();

// GET /api/posts → Return all AR posts
router.get('/', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts → Save new AR post
router.post('/', async (req, res) => {
  try {
    const { emoji, x, y, z, lat, lng } = req.body;

    // Reject if fields are missing
    if (!emoji || x === undefined || y === undefined || z === undefined || lat === undefined || lng === undefined) {
      return res.status(400).json({ message: 'Missing required AR or GPS fields.' });
    }

    const post = await Post.create({
      emoji,
      x,
      y,
      z,
      lat,
      lng
    });

    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMPORARY: Clear all data to start fresh (Visit /api/posts/admin/clear in browser)
router.get('/admin/clear', async (req, res) => {
  try {
    await Post.deleteMany({});
    res.send('<h1>✅ Database Cleared!</h1><p>Your AR Social Network is now fresh. You can now go back to the app and place new emojis.</p>');
  } catch (err) {
    res.status(500).send('Error clearing database: ' + err.message);
  }
});

export default router;
