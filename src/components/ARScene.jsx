import { useCallback, useEffect, useRef, useState } from 'react';
import { createPost, fetchNearbyPosts } from '../services/api.js';
import { getGPSLocation, haversineDistance, calculateGPSOffset } from '../utils/geo.js';

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
      schema: { speed: { default: 1 }, height: { default: 0.05 } },
      init() { this.baseY = this.el.object3D.position.y; this.time = 0; },
      tick(t, dt) {
        this.time += dt * 0.001 * this.data.speed;
        this.el.object3D.position.y = this.baseY + Math.sin(this.time) * this.data.height;
      }
    });
  }
}

/* ─────────────────────────────────────────
   ARScene Component
   ───────────────────────────────────────── */
export default function ARScene() {
  const sceneRef = useRef(null);
  const latestHitRef = useRef(null);
  const lastPlaceTime = useRef(0); // For debouncing

  const [ready, setReady] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [status, setStatus] = useState('Initializing GPS…');
  const [userLoc, setUserLoc] = useState(null);
  const [heading, setHeading] = useState(0); // Compass orientation
  const [nearbyCount, setNearbyCount] = useState(0);
  const [draftEmoji, setDraftEmoji] = useState('🔥');

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
          script.onload = resolve;
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
        setReady(true);
        setStatus('Ready — Enter AR');
      } catch (err) { setStatus(`Error: ${err}`); }
    })();

    return () => { 
      alive = false; 
      window.removeEventListener('deviceorientationabsolute', handleOrient);
      window.removeEventListener('deviceorientation', handleOrient);
    };
  }, []);

  useEffect(() => {
    if (!ready || !sceneRef.current || !userLoc) return;
    const scene = sceneRef.current;
    
    const initScene = () => {
      fetchNearbyPosts().then(posts => {
        if (!Array.isArray(posts)) return;
        const nearby = posts.filter(p => {
          if (!p.lat || !p.lng) return false;
          // Filter "ghost" data that has invalid world coordinates
          if (typeof p.x !== 'number' || Math.abs(p.x) > 500) return false;
          return haversineDistance(userLoc.lat, userLoc.lng, p.lat, p.lng) <= 50;
        });
        setNearbyCount(nearby.length);
        nearby.forEach(p => addARObject(p, scene));
      });
    };

    if (scene.hasLoaded) initScene();
    else scene.addEventListener('loaded', initScene, { once: true });
    scene.addEventListener('enter-vr', () => setArActive(true));
    scene.addEventListener('exit-vr', () => setArActive(false));
  }, [ready, userLoc]);

  function addARObject(post, sceneEl) {
    const id = post._id || `temp-${Math.random()}`;
    if (document.getElementById(`post-${id}`)) return;

    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('id', `post-${id}`);
    
    // Position anchoring logic: Apply COMPASS-STABLE GPS offset
    const pos = post.lat && post.lng && post._id
      ? calculateGPSOffset(userLoc.lat, userLoc.lng, post.lat, post.lng, { x: post.x, y: post.y, z: post.z }, heading)
      : { x: post.x, y: post.y, z: post.z };

    wrapper.setAttribute("position", { x: pos.x, y: pos.y + 0.1, z: pos.z });
    wrapper.setAttribute('billboard', '');
    wrapper.setAttribute('float', 'speed: 1.5; height: 0.04');

    const img = document.createElement('a-image');
    img.setAttribute('src', emojiToDataURL(post.emoji));
    img.setAttribute('width', '0.4');
    img.setAttribute('height', '0.4');
    
    wrapper.appendChild(img);
    sceneEl.appendChild(wrapper);
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
    if (scene) addARObject(newPost, scene);

    createPost(newPost)
      .then(saved => {
        setStatus('Saved!');
        setNearbyCount(prev => prev + 1);
        setTimeout(() => setStatus(''), 2000);
      })
      .catch(() => setStatus('Network Error'));
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
          {userLoc?.accuracy && (
            <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '4px' }}>
              GPS Accuracy: {userLoc.accuracy.toFixed(1)}m
            </div>
          )}
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
