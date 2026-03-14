function getBaseURL() {
  const envUrl = import.meta.env.VITE_API_URL;
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  if (envUrl && (isLocalhost || !envUrl.includes('localhost'))) {
    return envUrl;
  }
  if (typeof window !== 'undefined' && !isLocalhost) {
    return `${window.location.origin}/api`;
  }
  return 'http://localhost:5000/api';
}

export async function createPost(postData) {
  const url = `${getBaseURL()}/posts`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('[API] createPost failed:', error);
    throw error;
  }
}

export async function fetchNearbyPosts(lat, lng) {
  const query = (lat && lng) ? `?lat=${lat}&lng=${lng}` : '';
  const url = `${getBaseURL()}/posts/nearby${query}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('[API] fetchNearbyPosts failed:', error);
    return [];
  }
}
