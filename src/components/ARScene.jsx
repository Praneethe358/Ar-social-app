import { useCallback, useEffect, useRef, useState } from 'react';
import { createPost, fetchNearbyPosts } from '../services/api.js';

const AFRAME_SRC = 'https://aframe.io/releases/1.4.2/aframe.min.js';
const MAX_POSTS = 80;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-script-src="${src}"]`);
    if (existing?.dataset.loaded === '1') {
      resolve();
      return;
    }

    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.scriptSrc = src;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function registerWebXRHitTestComponent() {
  if (!window.AFRAME || window.AFRAME.components['webxr-hit-test']) {
    return;
  }

  window.AFRAME.registerComponent('always-face-camera', {
    tick() {
      const camera = this.el.sceneEl?.camera;
      if (camera) {
        const cameraPos = new window.THREE.Vector3();
        camera.getWorldPosition(cameraPos);
        // Ensure text is kept upright
        cameraPos.y = this.el.object3D.position.y;
        this.el.object3D.lookAt(cameraPos);
      }
    }
  });

  window.AFRAME.registerComponent('webxr-hit-test', {
    schema: {
      reticle: { type: 'selector' },
    },

    init() {
      this.viewerSpace = null;
      this.localSpace = null;
      this.hitTestSource = null;
      this.lastHitPose = null;
      this.session = null;
      this.onSessionEnd = this.onSessionEnd.bind(this);
      this.onEnterVR = this.onEnterVR.bind(this);
      this.onXRSelect = this.onXRSelect.bind(this);
      this.el.sceneEl.addEventListener('enter-vr', this.onEnterVR);
    },

    async onEnterVR() {
      const sceneEl = this.el.sceneEl;
      if (!sceneEl.is('ar-mode') || !sceneEl.renderer?.xr) return;

      try {
        const session = sceneEl.renderer.xr.getSession();
        if (!session) {
          sceneEl.emit('webxr-hit-status', { message: 'Unable to access active AR session.' });
          return;
        }

        try {
          this.localSpace = await session.requestReferenceSpace('local-floor');
        } catch (_floorError) {
          this.localSpace = await session.requestReferenceSpace('local');
        }

        this.viewerSpace = await session.requestReferenceSpace('viewer');
        this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
        this.session = session;
        this.session.addEventListener('select', this.onXRSelect);
        sceneEl.emit('webxr-hit-status', { message: 'Surface scanning active. Move device slowly.' });
        session.addEventListener('end', this.onSessionEnd, { once: true });
      } catch (_error) {
        sceneEl.emit('webxr-hit-status', { message: 'Hit test unavailable on this device/browser.' });
      }
    },

    onXRSelect() {
      const sceneEl = this.el.sceneEl;
      if (!this.lastHitPose) {
        sceneEl.emit('webxr-hit-status', { message: 'No surface detected yet. Move phone slowly.' });
        return;
      }

      sceneEl.emit('webxr-place-request', this.lastHitPose);
    },

    onSessionEnd() {
      if (this.session) {
        this.session.removeEventListener('select', this.onXRSelect);
      }
      this.session = null;
      this.hitTestSource = null;
      this.viewerSpace = null;
      this.localSpace = null;
      this.lastHitPose = null;
      const reticleEl = document.getElementById('reticle');
      if (reticleEl) {
        reticleEl.object3D.visible = false;
      }
    },

    tick() {
      const sceneEl = this.el.sceneEl;
      const xrFrame = sceneEl.frame;
      if (!sceneEl.is('ar-mode') || !xrFrame || !this.hitTestSource || !this.localSpace) {
        return;
      }

      const results = xrFrame.getHitTestResults(this.hitTestSource);
      const reticleEl = document.getElementById('reticle');

      if (!results.length) {
        if (reticleEl && reticleEl.object3D.visible) {
          reticleEl.object3D.visible = false;
          sceneEl.emit('webxr-hit-status', { message: 'Move phone slowly to detect surface.' });
        }
        return;
      }

      const pose = results[0].getPose(this.localSpace);
      if (!pose) {
        if (reticleEl && reticleEl.object3D.visible) {
          reticleEl.object3D.visible = false;
        }
        return;
      }

      const matrix = new window.THREE.Matrix4().fromArray(pose.transform.matrix);
      const position = new window.THREE.Vector3();
      const quaternion = new window.THREE.Quaternion();
      const scale = new window.THREE.Vector3();
      matrix.decompose(position, quaternion, scale);

      this.lastHitPose = {
        position: {
          x: position.x,
          y: position.y,
          z: position.z,
        },
        quaternion: {
          x: quaternion.x,
          y: quaternion.y,
          z: quaternion.z,
          w: quaternion.w,
        },
      };

      sceneEl.emit('webxr-hit-test', this.lastHitPose);
      if (reticleEl) {
        if (!reticleEl.object3D.visible) {
          sceneEl.emit('webxr-hit-status', { message: 'Surface detected! Tap anywhere to place.' });
        }
        reticleEl.object3D.visible = true;
        reticleEl.object3D.position.copy(position);
        reticleEl.object3D.quaternion.copy(quaternion);
      }
    },

    remove() {
      const sceneEl = this.el.sceneEl;
      sceneEl.removeEventListener('enter-vr', this.onEnterVR);
      this.onSessionEnd();
    },
  });
}

function ARScene() {
  const sceneRef = useRef(null);
  const reticleRef = useRef(null);
  const latestHitRef = useRef(null);
  const placedPositionsRef = useRef([]);
  const placedEntitiesRef = useRef([]);
  const lastPlacementAtRef = useRef(0);

  const [scriptsReady, setScriptsReady] = useState(false);
  const [sceneLoaded, setSceneLoaded] = useState(false);
  const [isARActive, setIsARActive] = useState(false);
  const [status, setStatus] = useState('Loading WebXR AR runtime...');
  const [draftPost, setDraftPost] = useState({ type: 'emoji', content: '😀' });
  const [debugMessages, setDebugMessages] = useState([]);

  const appendDebug = useCallback((message) => {
    console.log(`[WebXR Debug] ${message}`);
    setDebugMessages((previous) => [...previous, message]);
  }, []);

  const getOffsetPosition = useCallback((basePosition) => {
    const minDistance = 0.36;
    const attempts = 10;

    for (let index = 0; index < attempts; index += 1) {
      const radius = Math.floor(index / 4) * 0.14;
      const angle = (index % 4) * (Math.PI / 2);
      const candidate = {
        x: Number((basePosition.x + Math.cos(angle) * radius).toFixed(3)),
        y: basePosition.y,
        z: Number((basePosition.z + Math.sin(angle) * radius).toFixed(3)),
      };

      const overlap = placedPositionsRef.current.some((position) => {
        const dx = position.x - candidate.x;
        const dz = position.z - candidate.z;
        return Math.sqrt(dx * dx + dz * dz) < minDistance;
      });

      if (!overlap) {
        placedPositionsRef.current.push(candidate);
        return candidate;
      }
    }

    const fallback = {
      x: Number((basePosition.x + 0.18).toFixed(3)),
      y: basePosition.y,
      z: Number((basePosition.z + 0.14).toFixed(3)),
    };
    placedPositionsRef.current.push(fallback);
    return fallback;
  }, []);

  const pruneOldPosts = useCallback(() => {
    while (placedEntitiesRef.current.length > MAX_POSTS) {
      const oldest = placedEntitiesRef.current.shift();
      oldest?.remove();
    }
    if (placedPositionsRef.current.length > MAX_POSTS) {
      placedPositionsRef.current = placedPositionsRef.current.slice(-MAX_POSTS);
    }
  }, []);

  /**
   * Builds an A-Frame entity for an emoji post.
   * Uses <a-text> as requested for AR visibility.
   */
  const buildEmojiEntity = useCallback((content) => {
    // We use a transparent image service for high-quality emojis in WebXR
    const emojiCode = content.codePointAt(0).toString(16);
    const imgSrc = `https://emojicdn.elk.sh/${content}?style=apple`;
    
    const emojiImg = document.createElement('a-image');
    emojiImg.setAttribute('src', imgSrc);
    emojiImg.setAttribute('width', '0.5');
    emojiImg.setAttribute('height', '0.5');
    emojiImg.setAttribute('transparent', 'true');
    emojiImg.setAttribute('shader', 'flat');
    emojiImg.setAttribute('crossorigin', 'anonymous');
    emojiImg.setAttribute('always-face-camera', ''); 
    return emojiImg;
  }, []);

  /**
   * Builds an A-Frame entity for a text post.
   */
  const buildTextEntity = useCallback((content) => {
    const text = document.createElement('a-text');
    text.setAttribute('value', content);
    text.setAttribute('align', 'center');
    text.setAttribute('color', '#59f2c7'); // Brand color
    text.setAttribute('width', '4'); // Larger width for visibility
    text.setAttribute('side', 'double');
    text.setAttribute('always-face-camera', '');
    return text;
  }, []);

  /**
   * Spawns a post that was retrieved from the backend.
   */
  const spawnSavedPost = useCallback((post) => {
    const sceneEl = sceneRef.current;
    if (!sceneEl || !post.position) return null;

    const root = document.createElement('a-entity');
    root.setAttribute('position', `${post.position.x} ${post.position.y} ${post.position.z}`);
    
    if (post.rotation && window.THREE) {
      try {
        const rotation = new window.THREE.Euler().setFromQuaternion(
          new window.THREE.Quaternion(post.rotation.x, post.rotation.y, post.rotation.z, post.rotation.w)
        );
        const degX = (rotation.x * 180) / Math.PI;
        const degY = (rotation.y * 180) / Math.PI;
        const degZ = (rotation.z * 180) / Math.PI;
        root.setAttribute('rotation', `${degX} ${degY} ${degZ}`);
      } catch (e) {
        appendDebug(`Rotation error: ${e.message}`);
      }
    }
    
    root.setAttribute('scale', '1 1 1');
    root.setAttribute('data-post-id', post._id);

    const body = post.type === 'emoji' ? buildEmojiEntity(post.content) : buildTextEntity(post.content);
    root.appendChild(body);

    sceneEl.appendChild(root);
    placedEntitiesRef.current.push(root);
    pruneOldPosts();
    return root;
  }, [buildEmojiEntity, buildTextEntity, pruneOldPosts]);

  /**
   * Spawns a new post at the current hit-test position (reticle).
   */
  const spawnPost = useCallback(
    (post, hitPose) => {
      const sceneEl = sceneRef.current;
      if (!sceneEl || !hitPose) return null;

      const position = {
        x: hitPose.position.x,
        y: hitPose.position.y,
        z: hitPose.position.z,
      };

      appendDebug(`Spawning ${post.type} at ${position.x}, ${position.y}, ${position.z}`);
      const root = document.createElement('a-entity');
      root.setAttribute('position', `${position.x} ${position.y} ${position.z}`);
      
      if (hitPose.quaternion && window.THREE) {
        try {
          const rotation = new window.THREE.Euler().setFromQuaternion(
            new window.THREE.Quaternion(hitPose.quaternion.x, hitPose.quaternion.y, hitPose.quaternion.z, hitPose.quaternion.w)
          );
          const degX = (rotation.x * 180) / Math.PI;
          const degY = (rotation.y * 180) / Math.PI;
          const degZ = (rotation.z * 180) / Math.PI;
          root.setAttribute('rotation', `${degX} ${degY} ${degZ}`);
        } catch (e) {
          appendDebug(`Placement rotation error: ${e.message}`);
        }
      }
      
      root.setAttribute('scale', '1 1 1');
      root.setAttribute('data-post-id', `local-${Date.now()}`);

      const body = post.type === 'emoji' ? buildEmojiEntity(post.content) : buildTextEntity(post.content);
      root.appendChild(body);

      sceneEl.appendChild(root);
      placedEntitiesRef.current.push(root);
      pruneOldPosts();
      
      return { root, position, rotation: hitPose.quaternion };
    },
    [buildEmojiEntity, buildTextEntity, pruneOldPosts]
  );

  useEffect(() => {
    let mounted = true;

    async function prepare() {
      appendDebug('Running WebXR capability check...');

      if (!navigator.xr) {
        appendDebug('WebXR not supported in this browser');
        if (!mounted) return;
        setStatus('WebXR not supported. Use Android Chrome over HTTPS.');
        return;
      }

      appendDebug('navigator.xr exists: true');

      let immersiveArSupported = false;
      try {
        immersiveArSupported = await navigator.xr.isSessionSupported('immersive-ar');
        appendDebug(`Immersive AR supported: ${immersiveArSupported}`);
      } catch (error) {
        appendDebug(`Immersive AR check failed: ${error.message}`);
      }

      if (!immersiveArSupported) {
        if (!mounted) return;
        setStatus('Immersive AR supported: false. Check Chrome + ARCore + HTTPS.');
        return;
      }

      try {
        await loadScript(AFRAME_SRC);
        registerWebXRHitTestComponent();
        if (!mounted) return;
        setScriptsReady(true);
        appendDebug('A-Frame loaded successfully.');
        setStatus('Tap Enter AR, then tap a real-world surface to place posts.');
      } catch (error) {
        appendDebug(`A-Frame load error: ${error.message}`);
        if (!mounted) return;
        setStatus(error.message);
      }
    }

    prepare();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!scriptsReady || !sceneRef.current) return;

    const sceneEl = sceneRef.current;
    const markSceneReady = () => {
      setSceneLoaded(true);
      setStatus('Scene ready. Tap Enter AR to start camera and hit-test.');
      appendDebug('A-Frame scene is ready.');
    };

    if (sceneEl.hasLoaded || sceneEl.renderer) {
      markSceneReady();
      return undefined;
    }

    const handleSceneLoaded = () => {
      markSceneReady();
    };

    sceneEl.addEventListener('loaded', handleSceneLoaded, { once: true });
    return () => {
      sceneEl.removeEventListener('loaded', handleSceneLoaded);
    };
  }, [appendDebug, scriptsReady]);

  // Load nearby posts when scene boots up
  useEffect(() => {
    if (!sceneLoaded) return;
    
    async function loadInitialPosts() {
      appendDebug('Fetching nearby AR posts from backend...');
      try {
        const posts = await fetchNearbyPosts();
        if (posts && posts.length > 0) {
          appendDebug(`Found ${posts.length} prior posts. Submitting to engine...`);
          posts.forEach((post) => spawnSavedPost(post));
          setStatus(`Loaded ${posts.length} historical posts.`);
        }
      } catch (err) {
        appendDebug('Failed loading nearby posts.');
      }
    }
    
    loadInitialPosts();
  }, [sceneLoaded, appendDebug, spawnSavedPost]);

  const placePostAtPose = useCallback((hitPose) => {
    appendDebug(`placePostAtPose triggered. Pose: ${JSON.stringify(hitPose.position)}`);
    const now = Date.now();
    if (now - lastPlacementAtRef.current < 450) { // Slight throttle increase
      return;
    }

    const localPost = {
      type: draftPost.type,
      content: draftPost.content,
    };

    const { root: placedEntity, position, rotation } = spawnPost(localPost, hitPose) || {};
    if (!placedEntity) return;

    lastPlacementAtRef.current = now;

    setStatus('Placed instantly. Syncing post...');
    createPost({
      type: localPost.type,
      content: localPost.content,
      position,
      rotation,
      timestamp: new Date().toISOString()
    })
      .then((savedPost) => {
        if (savedPost && savedPost._id) {
          placedEntity.setAttribute('data-post-id', savedPost._id);
        }
        setStatus('Post saved successfully!');
      })
      .catch((error) => {
        console.error(error);
        placedEntity.setAttribute('data-post-id', `offline-${Date.now()}`);
        setStatus('Placed locally. API sync failed; object stays in AR scene.');
      });
  }, [draftPost.type, draftPost.content, spawnPost, appendDebug]);

  useEffect(() => {
    if (!scriptsReady || !sceneLoaded || !sceneRef.current) return;

    const sceneEl = sceneRef.current;

    const handleHitPose = (event) => {
      latestHitRef.current = event.detail;
    };

    const handleStatus = (event) => {
      if (event.detail?.message) {
        setStatus(event.detail.message);
      }
    };

    const handleXRPlaceRequest = (event) => {
      if (!sceneEl.is('ar-mode')) return;
      // In AR mode, event.detail is the hitPose
      placePostAtPose(event.detail);
    };

    const handleSceneClick = (event) => {
      if (!sceneEl.is('ar-mode')) {
        appendDebug('Scene click ignored: not in AR mode');
        return;
      }
      const reticle = document.getElementById('reticle');
      if (latestHitRef.current && reticle?.object3D.visible) {
        appendDebug('Scene click: Triggering placement');
        placePostAtPose(latestHitRef.current);
      } else {
        appendDebug('Scene click ignored: no hit result or reticle hidden');
      }
    };

    const handleARStart = () => {
      appendDebug('AR session started (enter-vr event)');
      setIsARActive(true);
      setStatus('AR started. Move device slowly to scan surface.');
    };

    const handleAREnd = () => {
      appendDebug('AR session ended (exit-vr event)');
      setIsARActive(false);
      latestHitRef.current = null;
      setStatus('AR session ended. Tap Enter AR to resume placement.');
    };

    sceneEl.addEventListener('webxr-hit-test', handleHitPose);
    sceneEl.addEventListener('webxr-hit-status', handleStatus);
    sceneEl.addEventListener('webxr-place-request', handleXRPlaceRequest);
    sceneEl.addEventListener('click', handleSceneClick);
    sceneEl.addEventListener('enter-vr', handleARStart);
    sceneEl.addEventListener('exit-vr', handleAREnd);

    // Periodically sync isARActive state for React UI reliability
    const syncState = setInterval(() => {
      const active = sceneEl.is('ar-mode');
      if (active !== isARActive) {
        setIsARActive(active);
      }
    }, 1000);

    return () => {
      clearInterval(syncState);
      sceneEl.removeEventListener('webxr-hit-test', handleHitPose);
      sceneEl.removeEventListener('webxr-hit-status', handleStatus);
      sceneEl.removeEventListener('webxr-place-request', handleXRPlaceRequest);
      sceneEl.removeEventListener('click', handleSceneClick);
      sceneEl.removeEventListener('enter-vr', handleARStart);
      sceneEl.removeEventListener('exit-vr', handleAREnd);
    };
  }, [placePostAtPose, sceneLoaded, scriptsReady]);

  const handleEnterAR = useCallback(async () => {
    const sceneEl = sceneRef.current;
    if (!sceneEl) {
      setStatus('Scene not ready yet.');
      return;
    }

    if (!sceneLoaded) {
      setStatus('Scene loading… wait a moment and tap Enter AR again.');
      return;
    }

    try {
      appendDebug('Enter AR button tapped. Requesting immersive-ar session...');
      await sceneEl.enterAR();
      setStatus('AR session requested. If prompted, allow camera access.');
    } catch (error) {
      appendDebug(`enterAR failed: ${error.message}`);
      setStatus('Failed to start AR session. Check camera permission and Chrome settings.');
    }
  }, [appendDebug, sceneLoaded]);



  const handleManualPlacement = useCallback((e) => {
    e.stopPropagation();
    if (!isARActive) return;
    const reticle = document.getElementById('reticle');
    if (latestHitRef.current && reticle?.object3D.visible) {
      appendDebug('Manual placement triggered');
      placePostAtPose(latestHitRef.current);
    } else {
      setStatus('No surface detected. Move phone slowly.');
    }
  }, [isARActive, placePostAtPose]);

  return (
    <section className="camera-stage">
      {scriptsReady ? (
        <a-scene
          ref={sceneRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          renderer="logarithmicDepthBuffer: true;"
          vr-mode-ui="enabled: false"
          xr-mode-ui="enabled: true"
          webxr="requiredFeatures: hit-test,local-floor; optionalFeatures: dom-overlay; overlayElement: #ar-overlay"
          webxr-hit-test="reticle: #reticle"
          cursor="rayOrigin: mouse; fuse: false"
          raycaster="objects: .clickable"
        >
          <a-entity id="xr-camera" camera look-controls position="0 1.6 0" />
          <a-entity
            id="reticle"
            ref={reticleRef}
            geometry="primitive: ring; radiusInner: 0.04; radiusOuter: 0.05"
            material="color: #59f2c7; shader: flat; opacity: 0.8"
            visible="false"
            rotation="-90 0 0"
          >
            <a-entity
              geometry="primitive: circle; radius: 0.005"
              material="color: #59f2c7; shader: flat"
            />
          </a-entity>
        </a-scene>
      ) : null}

      <div id="ar-overlay" className="ar-overlay-container">
        <div className="status-pill">{status}</div>

        <div className="debug-panel">
          <strong style={{ display: 'block', marginBottom: 6 }}>WebXR Debug</strong>
          {debugMessages.length === 0 ? <div>Waiting for checks...</div> : null}
          {debugMessages.map((message, index) => (
            <div key={`${message}-${index}`}>• {message}</div>
          ))}
        </div>

        <div className="top-controls">
          {!isARActive && (
            <button type="button" className="primary-btn" onClick={handleEnterAR}>
              Enter AR
            </button>
          )}
        </div>

        <div className="bottom-ar-ui">
          <div className="create-post-label">
            <div className="status-pill" style={{position:'static', marginBottom: '10px'}}>{draftPost.type === 'emoji' ? `Placing: ${draftPost.content}` : 'Placing text'}</div>
            {isARActive && (
              <button 
                className="primary-btn pulse-glow" 
                onClick={handleManualPlacement}
                style={{marginBottom: '10px', width: '100%', borderRadius: '12px'}}
              >
                👇 Place Here
              </button>
            )}
          </div>
          <div className="emoji-picker-row">
            {['😀', '😂', '❤️', '🔥', '🎉'].map((emoji) => (
              <button
                key={emoji}
                className={`emoji-btn ${draftPost.content === emoji ? 'emoji-btn--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setDraftPost({ type: 'emoji', content: emoji }); setStatus(`Selected ${emoji}. Tap to place!`); }}
              >
                {emoji}
              </button>
            ))}
            <button
              className="emoji-btn text-btn"
              onClick={(e) => {
                e.stopPropagation();
                const text = window.prompt('Enter text message:');
                if (text) {
                  setDraftPost({ type: 'text', content: text });
                  setStatus('Selected text. Tap to place!');
                }
              }}
            >
              ✍️ Text
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ARScene;
