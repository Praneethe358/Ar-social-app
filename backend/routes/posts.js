const express = require('express');
const router = express.Router();
const Post = require('../models/Post');

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

module.exports = router;
