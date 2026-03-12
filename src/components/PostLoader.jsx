import { useEffect } from 'react';
import { fetchNearbyPosts } from '../services/api.js';

function PostLoader({ refreshKey, onLoaded, onError }) {
  useEffect(() => {
    let isCancelled = false;

    async function loadPosts() {
      try {
        const posts = await fetchNearbyPosts();
        if (!isCancelled) {
          onLoaded(posts);
        }
      } catch (error) {
        if (!isCancelled && onError) {
          onError(error);
        }
      }
    }

    loadPosts();

    return () => {
      isCancelled = true;
    };
  }, [refreshKey, onLoaded, onError]);

  return null;
}

export default PostLoader;
