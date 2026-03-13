import axios from 'axios';

/**
 * API base URL resolution:
 *  - In production on Render: use the same origin (e.g. https://ar-social-app.onrender.com/api)
 *  - In local dev: Vite proxy forwards /api → localhost:5000
 *  - Override with VITE_API_URL env var if needed
 */
function getBaseURL() {
  const envUrl = import.meta.env.VITE_API_URL;
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  // Only trust VITE_API_URL if we're actually running on localhost
  // (prevents a stale localhost URL from being used in production)
  if (envUrl && (isLocalhost || !envUrl.includes('localhost'))) {
    return envUrl;
  }

  // In production, use same origin — avoids all CORS issues
  if (typeof window !== 'undefined' && !isLocalhost) {
    return `${window.location.origin}/api`;
  }

  // Local dev — Vite proxy handles /api → backend
  return '/api';
}

const api = axios.create({
  baseURL: getBaseURL(),
  timeout: 12000,
});

console.log('[API] baseURL =', api.defaults.baseURL);

// Optional auth header injection
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ar_auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Retry wrapper for flaky mobile connections
async function fetchWithRetry(fn, retries = 3, delay = 1500) {
  for (let i = 1; i <= retries; i++) {
    try { return await fn(); }
    catch (err) {
      console.warn(`[API] attempt ${i} failed:`, err.message);
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/* ── POST /api/ar-posts ── */
export async function createPost(payload) {
  console.log('[API] createPost payload:', payload);
  try {
    const res = await fetchWithRetry(() => api.post('/ar-posts', payload));
    console.log('[API] createPost success:', res.data.post?._id);
    return res.data.post;
  } catch (err) {
    console.error('[API] createPost FAILED:', err.response?.status, err.response?.data || err.message);
    throw err;
  }
}

/* ── GET /api/ar-posts ── */
export async function fetchNearbyPosts() {
  console.log('[API] fetchNearbyPosts…');
  try {
    const res = await api.get('/ar-posts');
    const posts = res.data.posts || [];
    console.log(`[API] fetched ${posts.length} posts`);
    return posts;
  } catch (err) {
    console.error('[API] fetchNearbyPosts FAILED:', err.response?.status, err.response?.data || err.message);
    return [];
  }
}

export default api;
