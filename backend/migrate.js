import mongoose from 'mongoose';
import Post from './models/Post.js';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ar_social_network';

async function migrate() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    const posts = await Post.find({
      $or: [
        { location: { $exists: false } },
        { 'location.coordinates': { $size: 0 } }
      ]
    });

    console.log(`Found ${posts.length} posts to migrate.`);

    for (const post of posts) {
      if (post.lat && post.lng) {
        post.location = {
          type: 'Point',
          coordinates: [post.lng, post.lat] // [lng, lat]
        };
        await post.save();
        console.log(`Migrated post ${post._id}`);
      }
    }

    console.log('Migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
