import { useEffect, useRef, useState } from 'react';
import { fetchNearbyPosts } from '../services/api.js';

export default function MapScreen() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let L;
    const initializeMap = async () => {
      try {
        // Load Leaflet if not already loaded (Open source, no API key required!)
        if (!window.L) {
          await new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            link.rel = 'stylesheet';
            document.head.appendChild(link);

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }
        L = window.L;

        const loc = window.userLocation || { latitude: 0, longitude: 0 };
        
        // Initialize Map
        const map = L.map(mapContainerRef.current, {
           zoomControl: false // keep it clean
        }).setView([loc.latitude, loc.longitude], 16);
        mapRef.current = map;

        // Dark mode carto tiles (No API key needed)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 20
        }).addTo(map);

        // Add User Location Marker
        if (loc.latitude !== 0) {
          const userIcon = L.divIcon({
            className: 'custom-leaflet-icon',
            html: `<div style="width:20px; height:20px; background-color:#3dffca; border-radius:50%; box-shadow:0 0 15px #3dffca; border:2px solid white;"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          L.marker([loc.latitude, loc.longitude], { icon: userIcon })
             .bindPopup('You are here')
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
                const hotspotIcon = L.divIcon({
                  className: 'custom-leaflet-icon',
                  html: `<div style="width:30px; height:30px; background-color:rgba(255, 61, 202, 0.4); border:2px solid #ff3dca; border-radius:50%;"></div>`,
                  iconSize: [30, 30],
                  iconAnchor: [15, 15]
                });

                const popupHTML = `
                  <div style="color: black; padding: 5px; text-align: center;">
                    <h3 style="margin:0; font-size:14px; color:#ff3dca;">🔥 AR Hotspot</h3>
                    <p style="margin:5px 0 0; font-size:12px;">Posts: ${spot.posts}</p>
                  </div>
                `;

                L.marker([spot.lat, spot.lng], { icon: hotspotIcon })
                   .bindPopup(popupHTML)
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
              const postIcon = L.divIcon({
                className: 'custom-leaflet-icon',
                html: `<div style="font-size:24px; cursor:pointer; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.5));">${post.emoji}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
              });

              const timeString = new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });
              const popupHTML = `
                <div style="color: black; text-align: center;">
                  <span style="font-size: 30px;">${post.emoji}</span>
                  <p style="margin: 4px 0; font-size: 12px; font-weight: bold;">Placed at ${timeString}</p>
                </div>
              `;

              L.marker([post.lat, post.lng], { icon: postIcon })
                 .bindPopup(popupHTML)
                 .addTo(map);
            });
          } catch (err) {
            console.error('Failed to load nearby posts for map', err);
          }
        };

        fetchAndRenderHotspots();
        fetchAndRenderPosts();

      } catch (err) {
        setError('Could not load map. Please check internet connection.');
        console.error(err);
      }
    };

    initializeMap();

    return () => {
      if (mapRef.current) {
         mapRef.current.remove();
         mapRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, bottom: '72px' }}>
      {error && (
        <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'red', color: 'white', padding: '10px', borderRadius: '8px' }}>
          {error}
        </div>
      )}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', backgroundColor: '#060d18' }} />
    </div>
  );
}
