import { useCallback, useEffect, useRef, useState } from 'react';
import CreatePost from './CreatePost.jsx';
import PostLoader from './PostLoader.jsx';
import { createPost } from '../services/api.js';

const AF_FRAME_SRC = 'https://aframe.io/releases/1.4.2/aframe.min.js';
const AR_JS_SRC = 'https://raw.githack.com/AR-js-org/AR.js/master/aframe/build/aframe-ar.js';
const EMOJI_TEXTURES = {
  '🔥': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f525.png',
  '😂': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f602.png',
  '🍕': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f355.png',
  '🎉': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f389.png',
};

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

function toWorldPosition(userLocation, post) {
  if (!userLocation) {
    return { x: 0, y: 1.6, z: -2.5 };
  }

  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos((userLocation.latitude * Math.PI) / 180);

  const deltaX = (post.longitude - userLocation.longitude) * metersPerDegreeLng;
  const deltaZ = -(post.latitude - userLocation.latitude) * metersPerDegreeLat;

  const distanceMeters = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  if (distanceMeters < 1.0) {
    return { x: 0, y: 1.6, z: -2.5 };
  }

  return {
    x: Number(deltaX.toFixed(2)),
    y: 1.6,
    z: Number(deltaZ.toFixed(2)),
  };
}

function ARScene() {
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const placementSurfaceRef = useRef(null);
  const renderedPostIdsRef = useRef(new Set());
  const placedPositionsRef = useRef([]);
  const [sceneReady, setSceneReady] = useState(false);
  const [scriptsReady, setScriptsReady] = useState(false);
  const [status, setStatus] = useState('Preparing AR camera...');
  const [location, setLocation] = useState(null);
  const [refreshKey] = useState(0);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [pendingPlacement, setPendingPlacement] = useState(null);

  const getOffsetPosition = useCallback((basePosition) => {
    const minDistance = 0.55;
    const maxAttempts = 12;

    for (let index = 0; index < maxAttempts; index += 1) {
      const radius = Math.floor(index / 4) * 0.18;
      const angle = (index % 4) * (Math.PI / 2);
      const candidate = {
        x: Number((basePosition.x + Math.cos(angle) * radius).toFixed(2)),
        y: basePosition.y,
        z: Number((basePosition.z + Math.sin(angle) * radius).toFixed(2)),
      };

      const isOverlapping = placedPositionsRef.current.some((position) => {
        const dx = position.x - candidate.x;
        const dz = position.z - candidate.z;
        return Math.sqrt(dx * dx + dz * dz) < minDistance;
      });

      if (!isOverlapping) {
        placedPositionsRef.current.push(candidate);
        return candidate;
      }
    }

    const fallback = {
      x: Number((basePosition.x + 0.25).toFixed(2)),
      y: basePosition.y,
      z: Number((basePosition.z + 0.2).toFixed(2)),
    };
    placedPositionsRef.current.push(fallback);
    return fallback;
  }, []);

  const showReticle = useCallback((position) => {
    const sceneEl = sceneRef.current;
    if (!sceneEl) return;

    const ring = document.createElement('a-ring');
    ring.setAttribute('position', `${position.x} ${position.y} ${position.z}`);
    ring.setAttribute('rotation', '-90 0 0');
    ring.setAttribute('radius-inner', '0.06');
    ring.setAttribute('radius-outer', '0.14');
    ring.setAttribute('color', '#00e5ff');
    ring.setAttribute('opacity', '0.9');
    ring.setAttribute('material', 'side: double; shader: flat');
    ring.setAttribute(
      'animation__fade',
      'property: components.material.material.opacity; from: 0.9; to: 0; dur: 900; easing: easeInQuad'
    );
    ring.setAttribute(
      'animation__scale',
      'property: scale; from: 0.5 0.5 0.5; to: 1.6 1.6 1.6; dur: 900; easing: easeOutQuad'
    );
    sceneEl.appendChild(ring);
    setTimeout(() => ring.parentNode && ring.parentNode.removeChild(ring), 950);
  }, []);

  // Imperatively append A-Frame entities to avoid React/A-Frame timing issues in AR mode.
  const addPostToScene = useCallback((post, explicitPosition, stackIndex = 0) => {
    const sceneEl = sceneRef.current;
    if (!sceneEl) return null;

    if (post._id && renderedPostIdsRef.current.has(post._id)) {
      return null;
    }

    const basePosition = explicitPosition || toWorldPosition(location, post);
    const spreadStep = 0.35;
    const spread = stackIndex * spreadStep;
    const spreadPosition = {
      x: Number((basePosition.x + spread).toFixed(2)),
      y: basePosition.y,
      z: Number((basePosition.z - spread * 0.25).toFixed(2)),
    };
    const position = getOffsetPosition(spreadPosition);
    const wrapper = document.createElement('a-entity');
    wrapper.setAttribute('position', `${position.x} ${position.y} ${position.z}`);
    wrapper.setAttribute('data-post-id', post._id || `local-${Date.now()}`);
    wrapper.setAttribute('look-at', '#camera-rig');

    if (post.type === 'emoji') {
      wrapper.setAttribute('scale', '0.2 0.2 0.2');
      wrapper.setAttribute(
        'animation__pop',
        'property: scale; from: 0.2 0.2 0.2; to: 1 1 1; dur: 220; easing: easeOutBack'
      );

      const emojiImage = document.createElement('a-image');
      emojiImage.setAttribute('width', '0.8');
      emojiImage.setAttribute('height', '0.8');
      emojiImage.setAttribute('position', '0 0 0');
      emojiImage.setAttribute('material', 'side: double; transparent: true; alphaTest: 0.1');

      const textureSrc = EMOJI_TEXTURES[post.content];
      if (textureSrc) {
        emojiImage.setAttribute('src', textureSrc);
        wrapper.appendChild(emojiImage);
      } else {
        const fallbackLabel = document.createElement('a-text');
        fallbackLabel.setAttribute('align', 'center');
        fallbackLabel.setAttribute('color', '#F6FCFF');
        fallbackLabel.setAttribute('side', 'double');
        fallbackLabel.setAttribute('value', post.content);
        fallbackLabel.setAttribute('width', '3');
        fallbackLabel.setAttribute('scale', '1 1 1');
        wrapper.appendChild(fallbackLabel);
      }
    } else {
      const label = document.createElement('a-text');
      label.setAttribute('align', 'center');
      label.setAttribute('color', '#F6FCFF');
      label.setAttribute('side', 'double');
      label.setAttribute('value', post.content);
      label.setAttribute('width', '3.6');
      label.setAttribute('wrap-count', '18');
      label.setAttribute('scale', '0.9 0.9 0.9');
      wrapper.appendChild(label);
    }

    sceneEl.appendChild(wrapper);
    if (post._id) {
      renderedPostIdsRef.current.add(post._id);
    }

    return wrapper;
  }, [getOffsetPosition, location, showReticle]);

  useEffect(() => {
    let mounted = true;

    async function prepareAR() {
      try {
        await loadScript(AF_FRAME_SRC);
        await loadScript(AR_JS_SRC);
        if (!mounted) return;
        setScriptsReady(true);
        setStatus('Camera is live. Tap screen to place an AR post.');
      } catch (error) {
        if (!mounted) return;
        setStatus(error.message);
      }
    }

    prepareAR();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        setStatus('Location denied. Posts can still be created from default position.');
      },
      { enableHighAccuracy: true }
    );
  }, []);

  useEffect(() => {
    if (!scriptsReady || !sceneRef.current) return;

    const sceneEl = sceneRef.current;
    const placementSurfaceEl = placementSurfaceRef.current;

    const handleLoaded = () => {
      setSceneReady(true);
    };

    const handleTap = (event) => {
      const intersection = event?.detail?.intersection;
      const point = intersection?.point;
      if (!point) {
        setStatus('Tap on the ground to choose where your AR post should appear.');
        return;
      }

      const placement = {
        x: Number(point.x.toFixed(2)),
        y: Number((point.y + 0.05).toFixed(2)),
        z: Number(point.z.toFixed(2)),
      };
      showReticle(placement);
      setPendingPlacement(placement);
      setIsComposerOpen(true);
      setStatus('Placement selected. Choose emoji or text and save.');
    };

    const handleCameraInit = () => {
      setStatus('Camera ready. Tap the ground to place an AR post.');
    };

    const handleCameraError = () => {
      setStatus('Camera blocked or unavailable. Allow camera permission for this site.');
    };

    sceneEl.addEventListener('loaded', handleLoaded);
    placementSurfaceEl?.addEventListener('click', handleTap);
    sceneEl.addEventListener('camera-init', handleCameraInit);
    sceneEl.addEventListener('camera-error', handleCameraError);

    return () => {
      sceneEl.removeEventListener('loaded', handleLoaded);
      placementSurfaceEl?.removeEventListener('click', handleTap);
      sceneEl.removeEventListener('camera-init', handleCameraInit);
      sceneEl.removeEventListener('camera-error', handleCameraError);
    };
  }, [scriptsReady]);

  const handlePostsLoaded = useCallback((loadedPosts) => {
    loadedPosts.forEach((post, index) => {
      addPostToScene(post, undefined, index % 4);
    });
  }, [addPostToScene]);

  const handlePostSubmit = useCallback(
    async ({ type, content }) => {
      const latitude = location?.latitude ?? 0;
      const longitude = location?.longitude ?? 0;

      if (!pendingPlacement) {
        setStatus('Tap on the ground first to choose a placement point.');
        return;
      }

      const optimisticPost = {
        _id: `local-${Date.now()}`,
        type,
        content,
      };

      const placedEntity = addPostToScene(optimisticPost, pendingPlacement, 0);
      setIsComposerOpen(false);
      setPendingPlacement(null);
      setStatus('Placed instantly. Syncing to server...');

      try {
        const savedPost = await createPost({ type, content, latitude, longitude });
        if (savedPost?._id) {
          placedEntity?.setAttribute('data-post-id', savedPost._id);
          renderedPostIdsRef.current.add(savedPost._id);
        }
        setStatus('Post saved. Tap again to place another one.');
      } catch (_error) {
        placedEntity?.remove();
        setStatus('Failed to save post. Post was removed. Check backend/API status.');
      }
    },
    [addPostToScene, location, pendingPlacement]
  );

  return (
    <section className="camera-stage">
      <PostLoader
        refreshKey={refreshKey}
        onLoaded={handlePostsLoaded}
        onError={() => setStatus('Unable to load nearby posts from API.')}
      />

      {scriptsReady ? (
        <a-scene
          ref={sceneRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          embedded
          renderer="alpha: true; antialias: true"
          vr-mode-ui="enabled: false"
          arjs="sourceType: webcam; videoTexture: true; debugUIEnabled: false;"
        >
          <a-entity
            id="camera-rig"
            ref={cameraRef}
            camera
            look-controls
            cursor="rayOrigin: mouse"
            raycaster="objects: .placement-surface; far: 100"
            position="0 1.6 0"
          />
          <a-plane
            ref={placementSurfaceRef}
            class="placement-surface"
            position="0 0 -6"
            rotation="-90 0 0"
            width="40"
            height="40"
            material="color: #ffffff; transparent: true; opacity: 0"
          />
        </a-scene>
      ) : null}

      <div className="status-pill">{status}</div>

      <CreatePost
        isOpen={isComposerOpen}
        onCancel={() => {
          setIsComposerOpen(false);
        }}
        onSubmit={handlePostSubmit}
      />
    </section>
  );
}

export default ARScene;
