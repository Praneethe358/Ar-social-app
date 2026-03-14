import { useCallback, useEffect, useRef, useState } from 'react';
import { createPost, fetchNearbyPosts } from '../services/api.js';

/* ─────────────────────────────────────────
   Constants
   ───────────────────────────────────────── */
const AFRAME_CDN = 'https://aframe.io/releases/1.4.2/aframe.min.js';
const MAX_POSTS  = 80;

const EMOJI_LIST = ['😀','😂','❤️','🔥','🎉','✨','🌟','💯','🚀','🎶'];

/* ─────────────────────────────────────────
   Helpers
   ───────────────────────────────────────── */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.querySelector(`script[data-src="${src}"]`);
    if (tag?.dataset.ready === '1') { resolve(); return; }
    if (tag) { tag.addEventListener('load', resolve, { once: true }); return; }
    const s = document.createElement('script');
    s.src = src;  s.async = true;  s.dataset.src = src;
    s.onload  = () => { s.dataset.ready = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Render an emoji onto an off-screen canvas and return a data-URL.
 * This is the ONLY reliable way to show emoji in A-Frame/WebGL.
 */
function emojiToDataURL(emoji, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.font = `${size * 0.72}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  return canvas.toDataURL();
}

/* ─────────────────────────────────────────
   A-Frame component registration (once)
   ───────────────────────────────────────── */
function registerComponents() {
  const AF = window.AFRAME;
  if (!AF || AF.components['webxr-hit-test']) return;

  /* Billboard: always face camera */
  AF.registerComponent('always-face-camera', {
    tick() {
      const cam = this.el.sceneEl?.camera;
      if (!cam) return;
      const cp = new window.THREE.Vector3();
      cam.getWorldPosition(cp);
      cp.y = this.el.object3D.position.y;
      this.el.object3D.lookAt(cp);
    },
  });

  /* Subtle float animation for placed emojis */
  AF.registerComponent('float-anim', {
    schema: { speed: { default: 1 }, amp: { default: 0.04 } },
    init() { this._baseY = null; this._t = Math.random() * Math.PI * 2; },
    tick(_, dt) {
      if (this._baseY === null) this._baseY = this.el.object3D.position.y;
      this._t += dt * 0.001 * this.data.speed;
      this.el.object3D.position.y = this._baseY + Math.sin(this._t) * this.data.amp;
    },
  });

  /* WebXR hit-test: drives the reticle */
  AF.registerComponent('webxr-hit-test', {
    schema: { reticle: { type: 'selector' } },
    init() {
      this.viewerSpace = this.localSpace = this.hitTestSource = this.lastHitPose = this.session = null;
      this._onEnterVR    = this._onEnterVR.bind(this);
      this._onSessionEnd = this._onSessionEnd.bind(this);
      this._onXRSelect   = this._onXRSelect.bind(this);
      this.el.sceneEl.addEventListener('enter-vr', this._onEnterVR);
    },
    async _onEnterVR() {
      const scene = this.el.sceneEl;
      if (!scene.is('ar-mode') || !scene.renderer?.xr) return;
      try {
        const session = scene.renderer.xr.getSession();
        if (!session) return;
        try   { this.localSpace = await session.requestReferenceSpace('local-floor'); }
        catch { this.localSpace = await session.requestReferenceSpace('local'); }
        this.viewerSpace   = await session.requestReferenceSpace('viewer');
        this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
        this.session = session;
        session.addEventListener('select', this._onXRSelect);
        session.addEventListener('end', this._onSessionEnd, { once: true });
        scene.emit('webxr-hit-status', { message: 'Scanning… move device slowly.' });
      } catch (e) {
        scene.emit('webxr-hit-status', { message: 'Hit-test unavailable.' });
        console.warn('[HitTest] init error', e);
      }
    },
    _onXRSelect() {
      if (!this.lastHitPose) {
        this.el.sceneEl.emit('webxr-hit-status', { message: 'No surface yet — keep scanning.' });
        return;
      }
      this.el.sceneEl.emit('webxr-place-request', JSON.parse(JSON.stringify(this.lastHitPose)));
    },
    _onSessionEnd() {
      if (this.session) this.session.removeEventListener('select', this._onXRSelect);
      this.session = this.hitTestSource = this.viewerSpace = this.localSpace = this.lastHitPose = null;
      const r = document.getElementById('reticle');
      if (r) r.object3D.visible = false;
    },
    tick() {
      const scene = this.el.sceneEl;
      const frame = scene.frame;
      if (!scene.is('ar-mode') || !frame || !this.hitTestSource || !this.localSpace) return;
      const results = frame.getHitTestResults(this.hitTestSource);
      const reticle = document.getElementById('reticle');
      if (!results.length) {
        if (reticle?.object3D.visible) {
          reticle.object3D.visible = false;
          scene.emit('webxr-hit-status', { message: 'Surface lost — keep scanning.' });
        }
        return;
      }
      const pose = results[0].getPose(this.localSpace);
      if (!pose) return;
      const m = new window.THREE.Matrix4().fromArray(pose.transform.matrix);
      const p = new window.THREE.Vector3();
      const q = new window.THREE.Quaternion();
      const s = new window.THREE.Vector3();
      m.decompose(p, q, s);
      this.lastHitPose = {
        position:   { x: p.x, y: p.y, z: p.z },
        quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
      };
      if (reticle) {
        if (!reticle.object3D.visible) {
          scene.emit('webxr-hit-status', { message: 'Surface found! Tap Place.' });
        }
        reticle.object3D.visible = true;
        reticle.object3D.position.set(p.x, p.y, p.z);
        reticle.object3D.quaternion.set(q.x, q.y, q.z, q.w);
      }
    },
    remove() {
      this.el.sceneEl.removeEventListener('enter-vr', this._onEnterVR);
      this._onSessionEnd();
    },
  });
}

/* ─────────────────────────────────────────
   Scene entity builders
   Uses <a-image> + canvas dataURL — the only
   reliable way to render emoji in WebGL/A-Frame
   ───────────────────────────────────────── */
function addEmojiToScene(sceneEl, emoji, pos, id) {
  console.log(`[Place] addEmoji "${emoji}" @ (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);

  // Render emoji to canvas texture
  const dataURL = emojiToDataURL(emoji, 256);

  // Wrapper entity (for float + billboard)
  const wrapper = document.createElement('a-entity');
  wrapper.setAttribute('position', `${pos.x} ${pos.y + 0.2} ${pos.z}`);
  wrapper.setAttribute('always-face-camera', '');
  wrapper.setAttribute('float-anim', 'speed: 0.8; amp: 0.04');
  wrapper.setAttribute('data-post-id', id || `local-${Date.now()}`);

  // Image plane using the canvas dataURL
  const img = document.createElement('a-image');
  img.setAttribute('src', dataURL);
  img.setAttribute('width', '0.4');
  img.setAttribute('height', '0.4');
  img.setAttribute('transparent', 'true');
  img.setAttribute('side', 'double');

  // Glow ring beneath the emoji
  const ring = document.createElement('a-entity');
  ring.setAttribute('geometry', 'primitive: ring; radiusInner: 0.18; radiusOuter: 0.2');
  ring.setAttribute('material', 'color: #59f2c7; shader: flat; opacity: 0.6; transparent: true');
  ring.setAttribute('rotation', '-90 0 0');
  ring.setAttribute('position', '0 -0.22 0');

  wrapper.appendChild(img);
  wrapper.appendChild(ring);
  sceneEl.appendChild(wrapper);
  return wrapper;
}

function addTextToScene(sceneEl, text, pos, id) {
  console.log(`[Place] addText "${text}" @ (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);

  const wrapper = document.createElement('a-entity');
  wrapper.setAttribute('position', `${pos.x} ${pos.y + 0.2} ${pos.z}`);
  wrapper.setAttribute('always-face-camera', '');
  wrapper.setAttribute('float-anim', 'speed: 0.6; amp: 0.03');
  wrapper.setAttribute('data-post-id', id || `local-${Date.now()}`);

  // Background plane
  const bg = document.createElement('a-plane');
  bg.setAttribute('width', '0.8');
  bg.setAttribute('height', '0.16');
  bg.setAttribute('color', '#0d1828');
  bg.setAttribute('opacity', '0.82');
  bg.setAttribute('side', 'double');

  const textEl = document.createElement('a-text');
  textEl.setAttribute('value', text);
  textEl.setAttribute('align', 'center');
  textEl.setAttribute('side', 'double');
  textEl.setAttribute('width', '2.2');
  textEl.setAttribute('color', '#59f2c7');
  textEl.setAttribute('position', '0 0 0.005');

  wrapper.appendChild(bg);
  wrapper.appendChild(textEl);
  sceneEl.appendChild(wrapper);
  return wrapper;
}

/* ─────────────────────────────────────────
   Persistence helpers
   ───────────────────────────────────────── */
async function savePost(content, position, type = 'emoji') {
  try {
    const saved = await createPost({
      type,
      content,
      position:  { x: position.x, y: position.y, z: position.z },
      rotation:  { x: 0, y: 0, z: 0, w: 1 },
      timestamp: new Date().toISOString(),
    });
    console.log('[Save] success', saved?._id);
    return saved;
  } catch (err) {
    console.error('[Save] failed', err.message);
    return null;
  }
}

import { getGPSLocation, haversineDistance, isWithinRadius } from '../utils/geo.js';

/* ─────────────────────────────────────────
   Persistence helpers
   ───────────────────────────────────────── */
async function savePost(content, position, userLoc, type = 'emoji') {
  try {
    const saved = await createPost({
      type,
      content,
      latitude:  userLoc.latitude,
      longitude: userLoc.longitude,
      position:  { x: position.x, y: position.y, z: position.z },
      rotation:  { x: 0, y: 0, z: 0, w: 1 },
      timestamp: new Date().toISOString(),
    });
    console.log('[Save] success', saved?._id);
    return saved;
  } catch (err) {
    console.error('[Save] failed', err.message);
    return null;
  }
}

async function loadPosts(sceneEl, entitiesRef, userLoc, setNearbyCount, debugFn) {
  debugFn('Fetching all posts from server…');
  try {
    const allPosts = await fetchNearbyPosts();
    if (!allPosts?.length) { debugFn('No posts found.'); return; }

    // Filter posts within 50 meters
    const nearby = allPosts.filter(p => 
      isWithinRadius(userLoc.latitude, userLoc.longitude, p.latitude, p.longitude, 50)
    );

    setNearbyCount(nearby.length);
    debugFn(`Found ${nearby.length} posts within 50m.`);

    nearby.forEach((p) => {
      if (!p.position) return;
      const entity = p.type === 'text'
        ? addTextToScene(sceneEl, p.content, p.position, p._id)
        : addEmojiToScene(sceneEl, p.content, p.position, p._id);
      entitiesRef.current.push(entity);
    });
  } catch (err) {
    debugFn('Failed to load posts.');
    console.error('[Load] error', err);
  }
}

/* ─────────────────────────────────────────
   React component
   ───────────────────────────────────────── */
export default function ARScene() {
  const sceneRef          = useRef(null);
  const latestHitRef      = useRef(null);
  const placedEntitiesRef = useRef([]);
  const lastPlaceTime     = useRef(0);

  const [ready, setReady]               = useState(false);
  const [sceneLoaded, setSceneLoaded]   = useState(false);
  const [arActive, setArActive]         = useState(false);
  const [status, setStatus]             = useState('Initializing GPS…');
  const [userLoc, setUserLoc]           = useState(null);
  const [nearbyCount, setNearbyCount]   = useState(0);
  const [draft, setDraft]               = useState({ type: 'emoji', content: '🔥' });
  const [logs, setLogs]                 = useState([]);
  const [showDebug, setShowDebug]       = useState(false);
  const [saveState, setSaveState]       = useState('idle');
  const [textInput, setTextInput]       = useState('');
  const [showTextInput, setShowTextInput] = useState(false);

  const log = useCallback((msg) => {
    console.log(`[AR] ${msg}`);
    setLogs((p) => [...p.slice(-40), msg]);
  }, []);

  /* 1. Boot: GPS + A-Frame */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        log('Requesting GPS location…');
        const loc = await getGPSLocation();
        if (!alive) return;
        setUserLoc(loc);
        log(`GPS Fixed: ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`);

        log('Checking WebXR support…');
        if (!navigator.xr) { setStatus('WebXR not supported.'); return; }
        const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
        if (!ok) { setStatus('AR not supported.'); return; }

        await loadScript(AFRAME_CDN);
        registerComponents();
        setReady(true);
        setStatus('Tap "Enter AR" to begin.');
      } catch (err) {
        setStatus(`Error: ${err}`);
        log(`Init failed: ${err}`);
      }
    })();
    return () => { alive = false; };
  }, [log]);

  /* 2. Wait for scene */
  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    const s = sceneRef.current;
    const done = () => { setSceneLoaded(true); log('A-Frame scene ready.'); };
    if (s.hasLoaded || s.renderStarted) { done(); return; }
    s.addEventListener('loaded', done, { once: true });
    return () => s.removeEventListener('loaded', done);
  }, [ready, log]);

  /* 3. Load location-filtered posts */
  useEffect(() => {
    if (!sceneLoaded || !sceneRef.current || !userLoc) return;
    loadPosts(sceneRef.current, placedEntitiesRef, userLoc, setNearbyCount, log);
  }, [sceneLoaded, userLoc, log]);

  /* 4. Wire A-Frame events */
  useEffect(() => {
    if (!ready || !sceneLoaded || !sceneRef.current) return;
    const scene = sceneRef.current;
    const onHitPose = (e) => { latestHitRef.current = JSON.parse(JSON.stringify(e.detail)); };
    const onStatus  = (e) => { if (e.detail?.message) setStatus(e.detail.message); };
    const onEnter   = () => { setArActive(true);  log('AR session started.'); };
    const onExit    = () => { setArActive(false); latestHitRef.current = null; log('AR session ended.'); setStatus('AR ended.'); };
    const onXRPlace = (e) => { if (scene.is('ar-mode')) handlePlace(e.detail); };
    scene.addEventListener('webxr-hit-test',      onHitPose);
    scene.addEventListener('webxr-hit-status',    onStatus);
    scene.addEventListener('enter-vr',            onEnter);
    scene.addEventListener('exit-vr',             onExit);
    scene.addEventListener('webxr-place-request', onXRPlace);
    return () => {
      scene.removeEventListener('webxr-hit-test',      onHitPose);
      scene.removeEventListener('webxr-hit-status',    onStatus);
      scene.removeEventListener('enter-vr',            onEnter);
      scene.removeEventListener('exit-vr',             onExit);
      scene.removeEventListener('webxr-place-request', onXRPlace);
    };
  }); // no deps — always latest closures

  /* Core placement */
  function handlePlace(hitPose) {
    if (!hitPose?.position) { log('handlePlace: no pose'); return; }
    const now = Date.now();
    if (now - lastPlaceTime.current < 500) return;
    lastPlaceTime.current = now;

    const pos = { x: hitPose.position.x, y: hitPose.position.y, z: hitPose.position.z };
    const scene = sceneRef.current;
    if (!scene) return;

    log(`Placing ${draft.type} "${draft.content}" @ (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);

    const entity = draft.type === 'text'
      ? addTextToScene(scene, draft.content, pos)
      : addEmojiToScene(scene, draft.content, pos);

    placedEntitiesRef.current.push(entity);
    while (placedEntitiesRef.current.length > MAX_POSTS) {
      placedEntitiesRef.current.shift()?.remove();
    }

    setSaveState('saving');
    // Persist to backend with GPS data
    savePost(draft.content, pos, userLoc, draft.type).then((saved) => {
      if (saved?._id) {
        entity.setAttribute('data-post-id', saved._id);
        setSaveState('saved');
        setNearbyCount(prev => prev + 1); // Increment counter immediately
        setStatus('Saved ✓');
        log(`Saved post ${saved._id}`);
        setTimeout(() => setSaveState('idle'), 2500);
      } else {
        setSaveState('error');
        setStatus('Placed locally (save failed).');
        log('Backend save failed — local only.');
        setTimeout(() => setSaveState('idle'), 3000);
      }
    });
  }

  const onPlaceHere = useCallback((e) => {
    e.stopPropagation();
    const reticle = document.getElementById('reticle');
    if (!latestHitRef.current || !reticle?.object3D.visible) {
      setStatus('No surface detected — move phone slowly.');
      return;
    }
    const rPos = reticle.object3D.position.clone();
    handlePlace({ position: { x: rPos.x, y: rPos.y, z: rPos.z } });
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const enterAR = useCallback(async () => {
    const s = sceneRef.current;
    if (!s || !sceneLoaded) { setStatus('Scene not ready yet.'); return; }
    try {
      log('Requesting immersive-ar session…');
      await s.enterAR();
    } catch (err) {
      log(`enterAR error: ${err.message}`);
      setStatus('Failed to start AR. Check camera permissions.');
    }
  }, [sceneLoaded, log]);

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    setDraft({ type: 'text', content: textInput.trim() });
    setShowTextInput(false);
    setTextInput('');
    setStatus(`Text ready: "${textInput.trim().substring(0, 20)}"`);
  };

  /* ── JSX ── */
  return (
    <section className="camera-stage">
      {ready && (
        <a-scene
          ref={sceneRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          renderer="logarithmicDepthBuffer: true"
          vr-mode-ui="enabled: false"
          xr-mode-ui="enabled: true"
          webxr="requiredFeatures: hit-test,local-floor; optionalFeatures: dom-overlay; overlayElement: #ar-overlay"
          webxr-hit-test="reticle: #reticle"
        >
          <a-entity id="xr-camera" camera look-controls position="0 1.6 0" />

          {/* Reticle */}
          <a-entity
            id="reticle"
            geometry="primitive: ring; radiusInner: 0.04; radiusOuter: 0.055"
            material="color: #59f2c7; shader: flat; opacity: 0.9"
            visible="false"
            rotation="-90 0 0"
          >
            <a-entity
              geometry="primitive: circle; radius: 0.008"
              material="color: #ffffff; shader: flat"
            />
            {/* Ripple rings */}
            <a-entity
              geometry="primitive: ring; radiusInner: 0.07; radiusOuter: 0.075"
              material="color: #59f2c7; shader: flat; opacity: 0.4"
            />
          </a-entity>
        </a-scene>
      )}

      {/* DOM Overlay */}
      <div id="ar-overlay" className="ar-overlay-container">

        {/* Top bar */}
        <div className="ar-top-bar">
          <div className="app-logo">
            <span className="logo-icon">✦</span>
            <span className="logo-text">ARSpace</span>
          </div>
          <div className="top-right-actions">
            <button
              className="icon-btn"
              onClick={() => setShowDebug(v => !v)}
              title="Toggle debug"
            >
              {showDebug ? '✕' : '🛠'}
            </button>
          </div>
        </div>

        {/* Nearby Counter (Day-3) */}
        <div className="nearby-counter">
          <span className="counter-icon">🔥</span>
          <span className="counter-text">{nearbyCount} AR posts nearby</span>
        </div>

        {/* Debug panel */}
        {showDebug && (
          <div className="debug-panel">
            <strong>WebXR Debug</strong>
            {logs.length === 0 && <div>Waiting…</div>}
            {logs.map((m, i) => <div key={i}>• {m}</div>)}
          </div>
        )}

        {/* Status pill */}
        <div className={`status-pill ${saveState === 'saved' ? 'status-pill--success' : saveState === 'error' ? 'status-pill--error' : ''}`}>
          {saveState === 'saving' && <span className="spinner" />}
          {status}
        </div>

        {/* Enter AR button — shown before session */}
        {!arActive && (
          <div className="enter-ar-wrap">
            <button className="enter-ar-btn" onClick={enterAR}>
              <span className="enter-ar-icon">⬡</span>
              Enter AR
            </button>
          </div>
        )}

        {/* Place button — shown only during session */}
        {arActive && (
          <div className="place-btn-wrap">
            <button className="place-btn pulse-glow" onClick={onPlaceHere}>
              <span>{draft.type === 'emoji' ? draft.content : '💬'}</span>
              Place Here
            </button>
          </div>
        )}

        {/* Text input modal */}
        {showTextInput && (
          <div className="text-input-modal">
            <div className="text-input-card">
              <p className="text-input-label">Enter your message</p>
              <input
                className="text-input-field"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTextSubmit()}
                placeholder="Type something…"
                autoFocus
                maxLength={60}
              />
              <div className="text-input-actions">
                <button className="text-cancel-btn" onClick={() => setShowTextInput(false)}>Cancel</button>
                <button className="text-confirm-btn" onClick={handleTextSubmit}>Confirm</button>
              </div>
            </div>
          </div>
        )}

        {/* Emoji picker + toolbar */}
        <div className="bottom-toolbar">
          <div className="selected-preview">
            <span className="preview-emoji">{draft.type === 'emoji' ? draft.content : '💬'}</span>
            <span className="preview-label">{draft.type === 'emoji' ? 'Emoji' : 'Text'} selected</span>
          </div>

          <div className="emoji-picker-row">
            {EMOJI_LIST.map((em) => (
              <button
                key={em}
                className={`emoji-btn ${draft.content === em && draft.type === 'emoji' ? 'emoji-btn--active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft({ type: 'emoji', content: em });
                  setStatus(`Selected ${em}`);
                }}
              >
                {em}
              </button>
            ))}
            <button
              className={`emoji-btn text-btn ${draft.type === 'text' ? 'emoji-btn--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowTextInput(true); }}
            >
              ✍️
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
