import axios from 'axios';

// Ensure it points to Render backend URL dynamically if Vite env is not passed locally.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://ar-app-backend.onrender.com/api',
  timeout: 10000,
});

// Example token auth injection
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ar_auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Retry utility wrapper
async function fetchWithRetry(requestFn, maxRetries = 3, delayMs = 1500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      console.warn(`[API] Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function createPost(payload) {
  try {
    const response = await fetchWithRetry(() => api.post('/posts/create', payload));
    console.log('[API] createPost success:', response.data.post);
    return response.data.post;
  } catch (error) {
    console.error('[API] createPost final failure:', error.response?.data || error.message);
    throw error;
  }
}

export async function fetchNearbyPosts() {
  try {
    const response = await api.get('/posts/nearby');
    return response.data.posts || [];
  } catch (error) {
    console.error('[API] fetchNearbyPosts error:', error.response?.data || error.message);
    return [];
  }
}

export default api;
