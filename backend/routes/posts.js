import express from 'express';
import Post from '../models/Post.js'; // Extension is required for ES Modules

const router = express.Router();

// GET /api/posts → Return AR posts within 50m of user
router.get('/', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    // If lat/lng provided, use high-performance geospatial query
    let query = {};
    if (lat && lng) {
      query = {
        location: {
          $nearSphere: {
            $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
            $maxDistance: 50 // 50 meters
          }
        }
      };
    }

    const posts = await Post.find(query).limit(100);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts → Save new AR post
router.post('/', async (req, res) => {
  try {
    const { emoji, x, y, z, lat, lng } = req.body;

    if (!emoji || x === undefined || lat === undefined) {
      return res.status(400).json({ message: 'Missing fields.' });
    }

    // 2. DUPLICATE PROTECTION
    // Check if same emoji was placed within 1 meter in the last 60 seconds
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const existing = await Post.findOne({
      emoji,
      createdAt: { $gte: oneMinuteAgo },
      location: {
        $nearSphere: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: 1 // 1 meter
        }
      }
    });

    if (existing) {
      return res.status(409).json({ message: 'Similar post already exists nearby.' });
    }

    const post = await Post.create({
      emoji, x, y, z, lat, lng,
      location: { type: 'Point', coordinates: [lng, lat] }
    });

    // 1. BROADCAST TO ZONE ROOM
    const io = req.app.get('socketio');
    const zoneId = `zone-${lat.toFixed(1)}-${lng.toFixed(1)}`;
    io.to(zoneId).emit('new-post', post);

    res.status(201).json(post);
  } catch (err) {
    console.error('[API] Error saving post:', err);
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
