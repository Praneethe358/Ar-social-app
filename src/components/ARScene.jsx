import { useCallback, useEffect, useRef, useState } from 'react';
import { createPost, fetchNearbyPosts } from '../services/api.js';
import { getGPSLocation, haversineDistance } from '../utils/geo.js';

const AFRAME_CDN = 'https://aframe.io/releases/1.4.2/aframe.min.js';

/* ─────────────────────────────────────────
   Canvas helper for rendering Emojis
   ───────────────────────────────────────── */
function emojiToDataURL(emoji) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = '180px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 128, 140);
  return canvas.toDataURL();
}

/* ─────────────────────────────────────────
   ARScene Component
   ───────────────────────────────────────── */
export default function ARScene() {
  const sceneRef = useRef(null);
  const latestHitRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [status, setStatus] = useState('Initializing GPS…');
  
  // Day-3 Features
  const [userLoc, setUserLoc] = useState(null);
  const [nearbyCount, setNearbyCount] = useState(0);
  
  // Setup Draft Emoji
  const [draftEmoji, setDraftEmoji] = useState('🔥');

  // Load A-Frame and components
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 1. GPS LOCATION DETECTION
        const loc = await getGPSLocation();
        if (!alive) return;
        setUserLoc(loc);
        console.log(`[Day-3 GPS] Location found: ${loc.lat}, ${loc.lng}`);
        
        // Setup A-Frame
        await new Promise((resolve, reject) => {
          if (window.AFRAME) return resolve();
          const script = document.createElement('script');
          script.src = AFRAME_CDN;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });

        // Register custom Hit-Test WebXR component
        if (!window.AFRAME.components['webxr-hit-test']) {
          window.AFRAME.registerComponent('webxr-hit-test', {
            schema: { reticle: { type: 'selector' } },
            init() {
              this.session = null;
              this.localSpace = null;
              this.viewerSpace = null;
              this.hitTestSource = null;
              
              this.el.sceneEl.addEventListener('enter-vr', async () => {
                if (!this.el.sceneEl.is('ar-mode')) return;
                const session = this.el.sceneEl.renderer?.xr.getSession();
                if (!session) return;
                
                try {
                  // REQUIREMENT 6: Use local-floor reference space
                  this.localSpace = await session.requestReferenceSpace('local-floor');
                  this.viewerSpace = await session.requestReferenceSpace('viewer');
                  this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
                  this.session = session;
                  
                  session.addEventListener('select', () => {
                    if (this.lastHitPose && this.el.sceneEl) {
                      this.el.sceneEl.emit('webxr-place-request', this.lastHitPose);
                    }
                  });
                } catch (e) {
                  console.warn('[HitTest] error initializing', e);
                }
              });
            },
            tick() {
              const frame = this.el.sceneEl?.frame;
              if (!frame || !this.hitTestSource || !this.localSpace) return;
              
              const results = frame.getHitTestResults(this.hitTestSource);
              const reticle = document.getElementById('reticle');
              
              if (results.length > 0) {
                const pose = results[0].getPose(this.localSpace);
                if (pose && reticle) {
                  const p = pose.transform.position;
                  const q = pose.transform.orientation;
                  
                  reticle.object3D.position.set(p.x, p.y, p.z);
                  reticle.object3D.quaternion.set(q.x, q.y, q.z, q.w);
                  reticle.object3D.visible = true;
                  
                  this.lastHitPose = { position: { x: p.x, y: p.y, z: p.z } };
                }
              } else if (reticle) {
                reticle.object3D.visible = false;
              }
            }
          });
        }

        setReady(true);
        setStatus('Tap "Enter AR" to begin.');
      } catch (err) {
        setStatus(`Initialization Error: ${err}`);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Set up AR Scene event listeners
  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    const scene = sceneRef.current;
    
    // Check if scene has loaded, otherwise wait
    const initScene = () => {
      if (!userLoc) return;
      
      // 8. AR OBJECT RELOAD (Fetch from DB on boot)
      fetchNearbyPosts().then(posts => {
        if (!Array.isArray(posts)) return;
        
        // 5. DISTANCE FILTERING
        const nearbyPosts = posts.filter(post => {
          if (!post.lat || !post.lng) return false;
          // Haversine formula distance check
          const dist = haversineDistance(userLoc.lat, userLoc.lng, post.lat, post.lng);
          return dist <= 50; // Only objects within 50 meters
        });
        
        // 9. NEARBY POSTS UI COUNT
        setNearbyCount(nearbyPosts.length);
        console.log(`[Day-3 AR Load] Found ${nearbyPosts.length} nearby posts.`);
        
        // Spawn filtered objects into the local-floor scene
        nearbyPosts.forEach(post => {
          addARObject(post, scene);
        });
      });
    };

    if (scene.hasLoaded) initScene();
    else scene.addEventListener('loaded', initScene, { once: true });

    // Handle AR hit-test placement requests
    const onPlaceRequest = (e) => handleHitTestPlacement(e.detail.position);
    scene.addEventListener('webxr-place-request', onPlaceRequest);
    
    scene.addEventListener('enter-vr', () => setArActive(true));
    scene.addEventListener('exit-vr', () => setArActive(false));

    return () => {
      scene.removeEventListener('webxr-place-request', onPlaceRequest);
    };
  }, [ready, userLoc]);

  /* ─────────────────────────────────────────
     4. AR OBJECT SPAWNING
     ───────────────────────────────────────── */
  function addARObject(post, sceneEl) {
    // Prevent duplicate spawning logic
    const existing = document.getElementById(`post-${post._id || Date.now()}`);
    if (existing) return;

    // Create A-Frame entity
    const entity = document.createElement('a-entity');
    if (post._id) entity.setAttribute('id', `post-${post._id}`);

    // Create image element from canvas to display emoji
    const img = document.createElement('a-image');
    img.setAttribute('src', emojiToDataURL(post.emoji));
    img.setAttribute('width', '0.4');
    img.setAttribute('height', '0.4');
    
    // Make emoji billboarded (face camera)
    img.setAttribute('look-at', '[camera]');

    // 6. OBJECT STABILITY: Set correct position USING post.x, post.y, post.z
    // Add small Y offset (0.1) so it doesn't clip into the world floor.
    entity.setAttribute("position", {
      x: post.x,
      y: post.y + 0.1, 
      z: post.z
    });
    
    // Add scale
    entity.setAttribute('scale', '1 1 1');

    entity.appendChild(img);
    // Append to <a-scene>
    sceneEl.appendChild(entity);
    return entity;
  }

  /* ─────────────────────────────────────────
     7. HIT TEST PLACEMENT
     ───────────────────────────────────────── */
  function handleHitTestPlacement(position) {
    if (!userLoc) return;
    setStatus('Saving emoji...');

    // 1. Create Post Object Locally
    const newPost = {
      emoji: draftEmoji,
      x: position.x,
      y: position.y,
      z: position.z,
      lat: userLoc.lat,
      lng: userLoc.lng
    };

    // 2. Spawn immediately into local AR view
    const scene = sceneRef.current;
    if (scene) addARObject(newPost, scene);

    // 3. Send to backend DB
    createPost(newPost)
      .then(savedPost => {
        setStatus('Saved! ✓');
        setNearbyCount(prev => prev + 1);
        setTimeout(() => setStatus(''), 2500);
      })
      .catch(err => {
        console.error('Failed to save post', err);
        setStatus('Failed to save. Network error.');
      });
  }

  const enterAR = useCallback(async () => {
    const s = sceneRef.current;
    if (!s) return;
    try {
      if (s.enterAR) await s.enterAR();
      else if (s.enterVR) await s.enterVR(); // Fallback
    } catch (err) {
      console.error(err);
      setStatus('Could not enter AR.');
    }
  }, []);

  return (
    <section className="camera-stage">
      {ready && (
        <a-scene
          ref={sceneRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          renderer="colorManagement: true"
          vr-mode-ui="enabled: false"
          xr-mode-ui="enabled: true"
          webxr="requiredFeatures: hit-test,local-floor; optionalFeatures: dom-overlay; overlayElement: #ar-overlay"
          webxr-hit-test="reticle: #reticle"
        >
          {/* Billboard plugin if needed */}
          {/* <a-entity id="xr-camera" camera look-controls position="0 1.6 0" /> */}
          <a-camera id="xr-camera" position="0 1.6 0"></a-camera>

          {/* Hit Test Reticle */}
          <a-entity
            id="reticle"
            geometry="primitive: ring; radiusInner: 0.04; radiusOuter: 0.055"
            material="color: #ff3dca; shader: flat; opacity: 0.9"
            visible="false"
            rotation="-90 0 0"
          >
            <a-entity
              geometry="primitive: circle; radius: 0.008"
              material="color: #ffffff; shader: flat"
            />
          </a-entity>
        </a-scene>
      )}

      {/* AR DOM Overlay */}
      <div id="ar-overlay" className="ar-overlay-container">
        
        {/* 9. NEARBY POSTS UI */}
        <div className="nearby-counter">
          🔥 {nearbyCount} AR posts nearby
        </div>

        {/* Status indicator */}
        {status && <div className="status-pill">{status}</div>}

        {/* Controls */}
        {!arActive ? (
          <div className="enter-ar-wrap">
            <button className="enter-ar-btn" onClick={enterAR}>
              <span className="enter-ar-icon">⬡</span>
              Enter AR
            </button>
          </div>
        ) : (
          <div className="place-btn-wrap">
            {/* The hit test mechanic runs automatically when user touches overlay,
                but we can also trigger from JS button via reticle click.
                A-Frame dom-overlay natively catches taps and emits selects. */}
             <div className="emoji-picker-row" style={{ marginTop: '-40px' }}>
                {['😀','❤️','🔥','🎉','🌟'].map((em) => (
                  <button
                    key={em}
                    className={`emoji-btn ${draftEmoji === em ? 'emoji-btn--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setDraftEmoji(em); setStatus(`Selected ${em}`); }}
                  >
                    {em}
                  </button>
                ))}
            </div>
            <button 
              className="place-btn" 
              onClick={(e) => {
                 e.stopPropagation();
                 const reticle = document.getElementById('reticle');
                 if (reticle && reticle.getAttribute('visible')) {
                    const rPos = reticle.object3D.position.clone();
                    handleHitTestPlacement({x: rPos.x, y: rPos.y, z: rPos.z});
                 } else {
                    setStatus('No surface found. Move phone.');
                 }
              }}
            >
              Place {draftEmoji} Here
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
