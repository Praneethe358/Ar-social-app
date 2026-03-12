import { useCallback, useEffect, useRef, useState } from 'react';
import CreatePost from './CreatePost.jsx';
import { createPost } from '../services/api.js';

const AFRAME_SRC = 'https://aframe.io/releases/1.4.2/aframe.min.js';
const MAX_POSTS = 80;

const EMOJI_CONTENT = ['🔥', '😂', '🍕', '🎉'];

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

  window.AFRAME.registerComponent('webxr-hit-test', {
    schema: {
      reticle: { type: 'selector' },
    },

    init() {
      this.viewerSpace = null;
      this.localSpace = null;
      this.hitTestSource = null;
      this.lastHitPose = null;
      this.onSessionEnd = this.onSessionEnd.bind(this);
      this.onEnterVR = this.onEnterVR.bind(this);
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
        sceneEl.emit('webxr-hit-status', { message: 'Surface scanning active. Move device slowly.' });
        session.addEventListener('end', this.onSessionEnd, { once: true });
      } catch (_error) {
        sceneEl.emit('webxr-hit-status', { message: 'Hit test unavailable on this device/browser.' });
      }
    },

    onSessionEnd() {
      this.hitTestSource = null;
      this.viewerSpace = null;
      this.localSpace = null;
      this.lastHitPose = null;
      if (this.data.reticle) {
        this.data.reticle.object3D.visible = false;
      }
    },

    tick(_time, _delta, xrFrame) {
      const sceneEl = this.el.sceneEl;
      if (!sceneEl.is('ar-mode') || !xrFrame || !this.hitTestSource || !this.localSpace) {
        return;
      }

      const results = xrFrame.getHitTestResults(this.hitTestSource);
      const reticleEl = this.data.reticle;

      if (!results.length) {
        if (reticleEl) reticleEl.object3D.visible = false;
        return;
      }

      const pose = results[0].getPose(this.localSpace);
      if (!pose) {
        if (reticleEl) reticleEl.object3D.visible = false;
        return;
      }

      const matrix = new window.THREE.Matrix4().fromArray(pose.transform.matrix);
      const position = new window.THREE.Vector3();
      const quaternion = new window.THREE.Quaternion();
      const scale = new window.THREE.Vector3();
      matrix.decompose(position, quaternion, scale);

      this.lastHitPose = {
        position: {
          x: Number(position.x.toFixed(3)),
          y: Number(position.y.toFixed(3)),
          z: Number(position.z.toFixed(3)),
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
        reticleEl.object3D.visible = true;
        reticleEl.object3D.position.copy(position);
        reticleEl.object3D.quaternion.copy(quaternion);
      }
    },

    remove() {
      this.el.sceneEl.removeEventListener('enter-vr', this.onEnterVR);
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
  const [status, setStatus] = useState('Loading WebXR AR runtime...');
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [draftPost, setDraftPost] = useState({ type: 'emoji', content: '🔥' });
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

  const buildEmojiEntity = useCallback((content) => {
    const emojiText = document.createElement('a-text');
    emojiText.setAttribute('value', EMOJI_CONTENT.includes(content) ? content : '🔥');
    emojiText.setAttribute('align', 'center');
    emojiText.setAttribute('color', '#FFFFFF');
    emojiText.setAttribute('width', '1.2');
    emojiText.setAttribute('side', 'double');
    return emojiText;
  }, []);

  const buildTextEntity = useCallback((content) => {
    const text = document.createElement('a-text');
    text.setAttribute('value', content);
    text.setAttribute('align', 'center');
    text.setAttribute('color', '#FFFFFF');
    text.setAttribute('width', '2.4');
    text.setAttribute('wrap-count', '20');
    text.setAttribute('side', 'double');
    return text;
  }, []);

  const spawnPost = useCallback(
    (post, hitPose) => {
      const sceneEl = sceneRef.current;
      if (!sceneEl || !hitPose) return null;

      const position = getOffsetPosition({
        x: hitPose.position.x,
        y: Number((hitPose.position.y + 0.03).toFixed(3)),
        z: hitPose.position.z,
      });

      const root = document.createElement('a-entity');
      root.setAttribute('position', `${position.x} ${position.y} ${position.z}`);
      root.setAttribute('scale', '0.2 0.2 0.2');
      root.setAttribute(
        'animation__pop',
        'property: scale; from: 0.2 0.2 0.2; to: 1 1 1; dur: 220; easing: easeOutBack'
      );
      root.setAttribute('data-post-id', `local-${Date.now()}`);

      const body = post.type === 'emoji' ? buildEmojiEntity(post.content) : buildTextEntity(post.content);
      root.appendChild(body);

      sceneEl.appendChild(root);
      placedEntitiesRef.current.push(root);
      pruneOldPosts();
      return root;
    },
    [buildEmojiEntity, buildTextEntity, getOffsetPosition, pruneOldPosts]
  );

  useEffect(() => {
    let mounted = true;

    async function prepare() {
      appendDebug('Running WebXR capability check...');

      if (!navigator.xr) {
        appendDebug('WebXR not supported in this browser');
        if (!mounted) return;
        setStatus('WebXR not supported in this browser. Use Android Chrome over HTTPS.');
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

    const handleTap = () => {
      const now = Date.now();
      if (now - lastPlacementAtRef.current < 220) {
        return;
      }

      if (!sceneEl.is('ar-mode')) {
        setStatus('Enter AR mode first, then tap on a detected surface.');
        return;
      }

      const reticleObject = reticleRef.current?.object3D;
      const hitPose = latestHitRef.current;

      if (!reticleObject?.visible || !hitPose) {
        setStatus('No surface detected yet. Move phone slowly to scan a plane.');
        return;
      }

      const reticlePose = {
        position: {
          x: Number(reticleObject.position.x.toFixed(3)),
          y: Number(reticleObject.position.y.toFixed(3)),
          z: Number(reticleObject.position.z.toFixed(3)),
        },
      };

      const localPost = {
        type: draftPost.type,
        content: draftPost.content,
      };

      const placedEntity = spawnPost(localPost, reticlePose);
      if (!placedEntity) return;

      lastPlacementAtRef.current = now;

      setStatus('Placed instantly. Syncing post...');
      createPost({
        type: localPost.type,
        content: localPost.content,
        latitude: 0,
        longitude: 0,
      })
        .then((savedPost) => {
          if (savedPost?._id) {
            placedEntity.setAttribute('data-post-id', savedPost._id);
          }
          setStatus('Post saved. Tap another surface point to place more.');
        })
        .catch(() => {
          placedEntity.remove();
          setStatus('API save failed. Removed local post to keep scene consistent.');
        });
    };

    const handleARStart = () => {
      setStatus('AR started. Scan a surface and tap to place.');
    };

    const handleAREnd = () => {
      latestHitRef.current = null;
      setStatus('AR session ended. Tap Enter AR to resume placement.');
    };

    sceneEl.addEventListener('webxr-hit-test', handleHitPose);
    sceneEl.addEventListener('webxr-hit-status', handleStatus);
    sceneEl.addEventListener('click', handleTap);
    sceneEl.addEventListener('touchstart', handleTap, { passive: true });
    sceneEl.addEventListener('enter-vr', handleARStart);
    sceneEl.addEventListener('exit-vr', handleAREnd);

    return () => {
      sceneEl.removeEventListener('webxr-hit-test', handleHitPose);
      sceneEl.removeEventListener('webxr-hit-status', handleStatus);
      sceneEl.removeEventListener('click', handleTap);
      sceneEl.removeEventListener('touchstart', handleTap);
      sceneEl.removeEventListener('enter-vr', handleARStart);
      sceneEl.removeEventListener('exit-vr', handleAREnd);
    };
  }, [draftPost, sceneLoaded, scriptsReady, spawnPost]);

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

  const handleDraftSubmit = useCallback(({ type, content }) => {
    setDraftPost({ type, content });
    setIsComposerOpen(false);
    setStatus(`Draft updated: ${type === 'emoji' ? 'emoji' : 'text'}. Tap in AR to place.`);
  }, []);

  return (
    <section className="camera-stage">
      {scriptsReady ? (
        <a-scene
          ref={sceneRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          renderer="logarithmicDepthBuffer: true;"
          vr-mode-ui="enabled: false"
          xr-mode-ui="enabled: true"
          webxr="requiredFeatures: hit-test,local-floor; optionalFeatures: dom-overlay"
          webxr-hit-test="reticle: #xr-reticle"
        >
          <a-entity id="xr-camera" camera look-controls position="0 1.6 0" />
          <a-ring
            id="xr-reticle"
            ref={reticleRef}
            visible="false"
            radius-inner="0.04"
            radius-outer="0.06"
            rotation="-90 0 0"
            material="shader: flat; color: #00E5FF; opacity: 0.85; side: double"
          />
        </a-scene>
      ) : null}

      <div className="status-pill">{status}</div>

      <div className="debug-panel">
        <strong style={{ display: 'block', marginBottom: 6 }}>WebXR Debug</strong>
        {debugMessages.length === 0 ? <div>Waiting for checks...</div> : null}
        {debugMessages.map((message, index) => (
          <div key={`${message}-${index}`}>• {message}</div>
        ))}
      </div>

      <div className="top-controls">
        <button type="button" className="primary-btn" onClick={handleEnterAR}>
          Enter AR
        </button>
        <button type="button" className="primary-btn" onClick={() => setIsComposerOpen(true)}>
          Edit Post Draft
        </button>
      </div>

      <CreatePost
        isOpen={isComposerOpen}
        onCancel={() => setIsComposerOpen(false)}
        onSubmit={handleDraftSubmit}
      />
    </section>
  );
}

export default ARScene;
