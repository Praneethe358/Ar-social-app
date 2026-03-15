import { useEffect, useRef, useState } from 'react';
import { fetchNearbyPosts } from '../services/api.js';

// Setup Mapbox access token (Need to be replaced with a real token in an actual app, providing a temporary public one or leaving empty)
// Note: Mapbox requires a valid access token. For demo purposes, we will try to initialize,
// but if it fails, the user will need to add their own.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoicGxhY2Vob2xkZXIiLCJhIjoiY2xhY2Vob2xkZXIifQ.cGxhY2Vob2xkZXI'; // Public example token placeholder

export default function MapScreen() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mapboxgl;
    const initializeMap = async () => {
      try {
        // Load mapboxgl if not already loaded
        if (!window.mapboxgl) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);

            const link = document.createElement('link');
            link.href = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
          });
        }
        mapboxgl = window.mapboxgl;
        mapboxgl.accessToken = MAPBOX_TOKEN;

        const loc = window.userLocation || { latitude: 0, longitude: 0 };
        
        // Initialize Map
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11', // Dark mode map for AR feel
          center: [loc.longitude, loc.latitude],
          zoom: 16
        });
        mapRef.current = map;

        // Add User Location Marker
        if (loc.latitude !== 0) {
          const el = document.createElement('div');
          el.className = 'user-marker';
          el.style.width = '20px';
          el.style.height = '20px';
          el.style.backgroundColor = '#3dffca';
          el.style.borderRadius = '50%';
          el.style.boxShadow = '0 0 15px #3dffca';
          el.style.border = '2px solid white';

          new mapboxgl.Marker(el)
            .setLngLat([loc.longitude, loc.latitude])
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setText('You are here'))
            .addTo(map);
        }

        // Fetch and render Hotspots (Feature 8 & 9)
        const fetchAndRenderHotspots = async () => {
          try {
            const baseUrl = typeof window !== 'undefined' && window.location.hostname === 'localhost' 
                            ? 'http://localhost:5000/api' 
                            : `${window.location.origin}/api`;
            
            const res = await fetch(`${baseUrl}/hotspots`);
            if (res.ok) {
              const hotspots = await res.json();
              hotspots.forEach(spot => {
                const el = document.createElement('div');
                el.className = 'hotspot-marker';
                el.style.width = '30px';
                el.style.height = '30px';
                el.style.backgroundColor = 'rgba(255, 61, 202, 0.4)';
                el.style.border = '2px solid #ff3dca';
                el.style.borderRadius = '50%';

                const popupHTML = `
                  <div style="color: black; padding: 5px;">
                    <h3 style="margin:0; font-size:14px;">🔥 AR Hotspot</h3>
                    <p style="margin:5px 0 0; font-size:12px;">Posts: ${spot.posts}</p>
                  </div>
                `;

                new mapboxgl.Marker(el)
                  .setLngLat([spot.lng, spot.lat])
                  .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(popupHTML))
                  .addTo(map);
              });
            }
          } catch (err) {
            console.error('Failed to load hotspots', err);
          }
        };

        // Fetch and render individual nearby posts (Feature 7)
        const fetchAndRenderPosts = async () => {
          try {
            const posts = await fetchNearbyPosts(loc.latitude, loc.longitude);
            posts.forEach(post => {
              const el = document.createElement('div');
              el.className = 'post-marker';
              el.style.fontSize = '24px';
              el.innerText = post.emoji;
              el.style.cursor = 'pointer';
              el.style.filter = 'drop-shadow(0px 2px 4px rgba(0,0,0,0.5))';

              const timeString = new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });
              const popupHTML = `
                <div style="color: black; text-align: center;">
                  <span style="font-size: 30px;">${post.emoji}</span>
                  <p style="margin: 4px 0; font-size: 12px; font-weight: bold;">Placed at ${timeString}</p>
                </div>
              `;

              new mapboxgl.Marker(el)
                .setLngLat([post.lng, post.lat])
                .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(popupHTML))
                .addTo(map);
            });
          } catch (err) {
            console.error('Failed to load nearby posts for map', err);
          }
        };

        // Let the map load first
        map.on('load', () => {
          fetchAndRenderHotspots();
          fetchAndRenderPosts();
        });

      } catch (err) {
        setError('Could not load map. Please check internet connection.');
        console.error(err);
      }
    };

    initializeMap();

    return () => {
      if (mapRef.current) mapRef.current.remove();
    };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, bottom: '72px' }}>
      {error && (
        <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'red', color: 'white', padding: '10px', borderRadius: '8px' }}>
          {error}
        </div>
      )}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
