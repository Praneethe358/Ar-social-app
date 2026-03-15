import express from 'express';
import Post from '../models/Post.js';

const router = express.Router();

// GET /api/hotspots → Return areas with highly concentrated posts
router.get('/', async (req, res) => {
  try {
    // 1. Group posts by approximately ~110m grid squares (using 3 decimal places for lat/lng)
    // 2. Count the number of posts in each group
    // 3. Sort by highest count
    const hotspots = await Post.aggregate([
      {
        $group: {
          _id: {
            lat: { $round: ["$lat", 3] },
            lng: { $round: ["$lng", 3] }
          },
          posts: { $sum: 1 }
        }
      },
      // Optional: Only return areas with at least 1 post (could change to 2 or more later)
      { $match: { posts: { $gte: 1 } } }, 
      { $sort: { posts: -1 } },
      { $limit: 20 }
    ]);

    // Format response to match required schema: { lat, lng, posts }
    const formattedHotspots = hotspots.map(spot => ({
      lat: spot._id.lat,
      lng: spot._id.lng,
      posts: spot.posts
    }));

    res.json(formattedHotspots);
  } catch (err) {
    console.error('[API] Hotspots Error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
