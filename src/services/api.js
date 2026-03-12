import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
});

export async function createPost(payload) {
  const response = await api.post('/posts/create', payload);
  return response.data.post;
}

export async function fetchNearbyPosts() {
  const response = await api.get('/posts/nearby');
  return response.data.posts || [];
}

export default api;
