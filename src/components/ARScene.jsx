import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createPost, fetchNearbyPosts } from '../services/api.js';
import { getGPSLocation, haversineDistance, calculateGPSOffset } from '../utils/geo.js';

const AFRAME_CDN = 'https://aframe.io/releases/1.4.2/aframe.min.js';
const ENV_CDN = 'https://unpkg.com/aframe-environment-component@1.3.1/dist/aframe-environment-component.min.js';

const EMOJI_SCALE = 0.3;

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
   A-Frame custom components for stability
   ───────────────────────────────────────── */
function registerStabilityComponents() {
  if (!window.AFRAME) return;
  
  // Custom Billboard: Stable face-camera logic
  if (!window.AFRAME.components['billboard']) {
    window.AFRAME.registerComponent('billboard', {
      tick() {
        const cam = this.el.sceneEl.camera;
        if (!cam) return;
        const target = new window.THREE.Vector3();
        cam.getWorldPosition(target);
        target.y = this.el.object3D.position.y; // Keep vertical
        this.el.object3D.lookAt(target);
      }
    });
  }

  // Float animation: subtle movement
  if (!window.AFRAME.components['float']) {
    window.AFRAME.registerComponent('float', {
      schema: { speed: { default: 1 }, height: { default: 0.1 } },
      init() { this.baseY = this.el.object3D.position.y; this.time = 0; },
      tick(t, dt) {
        this.time += dt * 0.001 * this.data.speed;
        this.el.object3D.position.y = this.baseY + Math.sin(this.time) * this.data.height;
      }
    });
  }

  // Click handler component
  if (!window.AFRAME.components['emoji-click']) {
    window.AFRAME.registerComponent('emoji-click', {
      schema: { postData: { type: 'string' } },
      init() {
        this.el.addEventListener('click', () => {
          const data = JSON.parse(this.data.postData);
          this.el.sceneEl.emit('post-selected', { post: data });
        });
      }
    });
  }
}

/* ─────────────────────────────────────────
   ARScene Component
   ───────────────────────────────────────── */
export default function ARScene() {
  const sceneRef = useRef(null);
  const socketRef = useRef(null);
  const latestHitRef = useRef(null);
  const lastPlaceTime = useRef(0); 
  const lockedHeading = useRef(0);
  const existingPostIds = useRef(new Set()); // Duplicate protection

  const [ready, setReady] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [status, setStatus] = useState('Initializing GPS…');
  const [userLoc, setUserLoc] = useState(null);
  const [heading, setHeading] = useState(0); 
  const [nearbyCount, setNearbyCount] = useState(0);
  const [draftEmoji, setDraftEmoji] = useState('🔥');
  const [selectedPost, setSelectedPost] = useState(null);

  useEffect(() => {
    let alive = true;

    // Detect compass heading
    const handleOrient = (e) => {
      let h = e.alpha;
      if (e.absolute === false && e.webkitCompassHeading) h = e.webkitCompassHeading;
      if (h !== null && alive) setHeading(h);
    };
    window.addEventListener('deviceorientationabsolute', handleOrient, true);
    window.addEventListener('deviceorientation', handleOrient, true);

    (async () => {
      try {
        const loc = await getGPSLocation();
        if (!alive) return;
        setUserLoc(loc);

        await new Promise((resolve) => {
          if (window.AFRAME) return resolve();
          const script = document.createElement('script');
          script.src = AFRAME_CDN;
          script.onload = () => {
             // Load environment component after A-Frame
             const envScript = document.createElement('script');
             envScript.src = ENV_CDN;
             envScript.onload = resolve;
             document.head.appendChild(envScript);
          };
          document.head.appendChild(script);
        });

        registerStabilityComponents();

        if (!window.AFRAME.components['webxr-hit-test']) {
          window.AFRAME.registerComponent('webxr-hit-test', {
            init() {
              this.el.sceneEl.addEventListener('enter-vr', async () => {
                if (!this.el.sceneEl.is('ar-mode')) return;
                const session = this.el.sceneEl.renderer?.xr.getSession();
                if (!session) return;
                
                // 1. Enforce stable reference space
                if (this.el.sceneEl.renderer && this.el.sceneEl.renderer.xr.setReferenceSpaceType) {
                  this.el.sceneEl.renderer.xr.setReferenceSpaceType('local-floor');
                }

                this.localSpace = await session.requestReferenceSpace('local-floor');
                this.viewerSpace = await session.requestReferenceSpace('viewer');
                this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
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
                  latestHitRef.current = { x: p.x, y: p.y, z: p.z };
                }
              } else if (reticle) {
                reticle.object3D.visible = false;
              }
            }
          });
        }

        // Initialize Socket.io
        const socketPath = window.location.hostname === 'localhost' ? 'http://localhost:5000' : window.location.origin;
        const socket = io(socketPath);
        socketRef.current = socket;

        setReady(true);
        setStatus('Ready — Enter AR');
      } catch (err) { setStatus(`Error: ${err}`); }
    })();

    return () => { 
      alive = false; 
      window.removeEventListener('deviceorientationabsolute', handleOrient);
      window.removeEventListener('deviceorientation', handleOrient);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!ready || !sceneRef.current || !userLoc) return;
    const scene = sceneRef.current;
    
    // Join the spatial zone for real-time social updates
    if (socketRef.current) {
      socketRef.current.emit('join-zone', { lat: userLoc.lat, lng: userLoc.lng });
      socketRef.current.on('new-post', (post) => {
        console.log('[Socket] New real-time emoji received:', post.emoji);
        spawnEmoji(post, scene);
      });
    }

    const initScene = () => {
      // Fetch high-performance filtered posts from backend
      fetchNearbyPosts(userLoc.lat, userLoc.lng).then(posts => {
        if (!Array.isArray(posts)) return;
        setNearbyCount(posts.length);
        posts.forEach(p => spawnEmoji(p, scene));
      });
    };

    const handlePostSelected = (e) => {
      const post = e.detail.post;
      // Calculate real-time distance
      if (userLoc) {
        post.currentDistance = haversineDistance(userLoc.lat, userLoc.lng, post.lat, post.lng);
      }
      setSelectedPost(post);
    };
    scene.addEventListener('post-selected', handlePostSelected);

    if (scene.hasLoaded) initScene();
    else scene.addEventListener('loaded', initScene, { once: true });
    
    scene.addEventListener('enter-vr', () => {
      setArActive(true);
      lockedHeading.current = heading;
      console.log(`[Day-3] AR Started - Heading Locked: ${heading.toFixed(1)}°`);
    });
    scene.addEventListener('exit-vr', () => setArActive(false));

    return () => {
      if (socketRef.current) socketRef.current.off('new-post');
      scene.removeEventListener('post-selected', handlePostSelected);
    }
  }, [ready, userLoc, heading]);

  function spawnEmoji(post, sceneEl) {
    const isTemp = !post._id;
    const id = post._id || `temp-${Math.random()}`;
    
    // Duplicate Protection
    if (existingPostIds.current.has(id)) return;
    if (document.getElementById(`post-${id}`)) return;
    existingPostIds.current.add(id);

    // Cleanup Temporary local version if REAL version arrives
    if (!isTemp) {
      const temps = document.querySelectorAll('[data-temp="true"]');
      temps.forEach(t => {
        const dist = Math.hypot(t.object3D.position.x - post.x, t.object3D.position.z - post.z);
        if (dist < 1) {
           t.parentNode.removeChild(t);
           existingPostIds.current.delete(t.id.replace('post-', ''));
        }
      });
    }

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('id', `post-${id}`);
    if (isTemp) wrapper.setAttribute('data-temp', 'true');
    wrapper.classList.add('raycastable');
    
    // Position anchoring logic: Apply COMPASS-STABLE GPS offset using the LOCKED heading
    const pos = post.lat && post.lng && post._id
      ? calculateGPSOffset(userLoc.lat, userLoc.lng, post.lat, post.lng, { x: post.x, y: post.y, z: post.z }, lockedHeading.current)
      : { x: post.x, y: post.y, z: post.z };

    // Set stable world position with 0.1 offset to avoid clipping
    wrapper.setAttribute("position", { x: pos.x, y: pos.y + 0.1, z: pos.z });
    wrapper.setAttribute('billboard', '');
    wrapper.setAttribute('float', 'speed: 0.6; height: 0.08');
    
    // Scale Spawn Animation
    wrapper.setAttribute('scale', '0 0 0');
    wrapper.setAttribute('animation', {
      property: 'scale',
      from: '0 0 0',
      to: `${EMOJI_SCALE} ${EMOJI_SCALE} ${EMOJI_SCALE}`,
      dur: 400,
      easing: 'easeOutBack'
    });

    // Metadata for clicks
    wrapper.setAttribute('emoji-click', { postData: JSON.stringify(post) });

    const img = document.createElement('a-image');
    img.setAttribute('src', emojiToDataURL(post.emoji));
    img.setAttribute('width', '1');
    img.setAttribute('height', '1');
    img.setAttribute('material', 'emissive: #ffffff; emissiveIntensity: 0.2');
    
    // Add small point light for GLOW effect
    const glow = document.createElement('a-entity');
    glow.setAttribute('light', {
      type: 'point',
      intensity: 0.5,
      distance: 2,
      color: '#ffffff'
    });
    glow.setAttribute('position', '0 0 0.1');

    wrapper.appendChild(img);
    wrapper.appendChild(glow);

    // 7. Spawn Debug Visualization (Set 'true' to see red anchors at base)
    const DEBUG_STABILITY = false;
    if (DEBUG_STABILITY) {
      const debugSphere = document.createElement('a-sphere');
      debugSphere.setAttribute('radius', '0.02');
      debugSphere.setAttribute('color', 'red');
      debugSphere.setAttribute('position', '0 -0.1 0'); // At the hit point
      wrapper.appendChild(debugSphere);
    }

    sceneEl.appendChild(wrapper);

    // Sync nearby count with unique post IDs
    setNearbyCount(existingPostIds.current.size);

    return wrapper;
  }

  function handleHitTestPlacement(position) {
    // 500ms placement debounce
    const now = Date.now();
    if (now - lastPlaceTime.current < 500) return;
    lastPlaceTime.current = now;

    if (!userLoc) return;
    setStatus('Saving…');

    const newPost = { emoji: draftEmoji, x: position.x, y: position.y, z: position.z, lat: userLoc.lat, lng: userLoc.lng };
    const scene = sceneRef.current;
    if (scene) spawnEmoji(newPost, scene); // Add local temp version immediately

    createPost(newPost)
      .then(saved => {
        setStatus('Saved!');
        // Note: Count is updated by the socket event 'new-post' to stay in sync
        setTimeout(() => setStatus(''), 2000);
      })
      .catch((err) => {
        setStatus(err.status === 409 ? 'Already exists!' : 'Network Error');
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
          cursor="rayOrigin: mouse; fuse: false"
          raycaster="objects: .raycastable"
        >
          {/* Advanced Lighting & Environment */}
          <a-entity light="type: ambient; intensity: 0.6"></a-entity>
          <a-entity light="type: directional; intensity: 0.8; castShadow: true; position: -1 2 1"></a-entity>
          <a-entity environment="preset: contact; ground: none; lighting: none; skyType: none;"></a-entity>

          <a-camera id="xr-camera" position="0 1.6 0">
            <a-entity 
              cursor="fuse: false; fuseTimeout: 500"
              position="0 0 -1"
              geometry="primitive: ring; radiusInner: 0.02; radiusOuter: 0.03"
              material="color: #3dffca; shader: flat"
              raycaster="objects: .raycastable"
              visible={arActive}
            ></a-entity>
          </a-camera>

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
          {userLoc?.accuracy && (
            <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '4px' }}>
              GPS Accuracy: {userLoc.accuracy.toFixed(1)}m
            </div>
          )}
        </div>

        {/* 8. GPS Accuracy Warning */}
        {userLoc?.accuracy > 20 && (
          <div className="status-pill status-pill--warning" style={{ top: '120px' }}>
            ⚠️ Move slightly to improve GPS accuracy ({userLoc.accuracy.toFixed(0)}m)
          </div>
        )}

        {/* Status indicator */}
        {status && <div className="status-pill">{status}</div>}

        {/* Post Info Popup */}
        {selectedPost && (
          <div className="post-info-popup pulse-glow">
            <div className="info-header">
              <span className="info-emoji">{selectedPost.emoji}</span>
              <button className="close-info" onClick={() => setSelectedPost(null)}>✕</button>
            </div>
            <div className="info-body">
              <p>Placed {new Date(selectedPost.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              {selectedPost.currentDistance && (
                <p>📍 {selectedPost.currentDistance.toFixed(1)}m away</p>
              )}
            </div>
          </div>
        )}

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
