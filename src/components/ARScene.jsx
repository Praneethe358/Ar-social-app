import { useCallback, useEffect, useRef, useState } from 'react';
import { createPost, fetchNearbyPosts } from '../services/api.js';

/* ────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────── */
const AFRAME_CDN = 'https://aframe.io/releases/1.4.2/aframe.min.js';
const MAX_POSTS  = 80;

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */

/** Load an external script once, returning a Promise. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.querySelector(`script[data-src="${src}"]`);
    if (tag?.dataset.ready === '1') { resolve(); return; }
    if (tag) { tag.addEventListener('load', resolve, { once: true }); return; }

    const s  = document.createElement('script');
    s.src    = src;
    s.async  = true;
    s.dataset.src = src;
    s.onload = () => { s.dataset.ready = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

/* ────────────────────────────────────────────
   A-Frame component registration (runs once)
   ──────────────────────────────────────────── */
function registerComponents() {
  const AF = window.AFRAME;
  if (!AF || AF.components['webxr-hit-test']) return;

  /* ── Billboard: always face the user camera ── */
  AF.registerComponent('always-face-camera', {
    tick() {
      const cam = this.el.sceneEl?.camera;
      if (!cam) return;
      const cp = new window.THREE.Vector3();
      cam.getWorldPosition(cp);
      cp.y = this.el.object3D.position.y;          // keep upright
      this.el.object3D.lookAt(cp);
    },
  });

  /* ── WebXR hit-test: drives the reticle ── */
  AF.registerComponent('webxr-hit-test', {
    schema: { reticle: { type: 'selector' } },

    init() {
      this.viewerSpace   = null;
      this.localSpace    = null;
      this.hitTestSource = null;
      this.lastHitPose   = null;
      this.session       = null;

      this._onEnterVR    = this._onEnterVR.bind(this);
      this._onSessionEnd = this._onSessionEnd.bind(this);
      this._onXRSelect   = this._onXRSelect.bind(this);

      this.el.sceneEl.addEventListener('enter-vr', this._onEnterVR);
    },

    /* AR session bootstrap */
    async _onEnterVR() {
      const scene = this.el.sceneEl;
      if (!scene.is('ar-mode') || !scene.renderer?.xr) return;

      try {
        const session = scene.renderer.xr.getSession();
        if (!session) return;

        try   { this.localSpace = await session.requestReferenceSpace('local-floor'); }
        catch { this.localSpace = await session.requestReferenceSpace('local');       }

        this.viewerSpace   = await session.requestReferenceSpace('viewer');
        this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
        this.session       = session;

        session.addEventListener('select', this._onXRSelect);
        session.addEventListener('end', this._onSessionEnd, { once: true });

        scene.emit('webxr-hit-status', { message: 'Scanning… move device slowly.' });
        console.log('[HitTest] AR session initialised');
      } catch (e) {
        scene.emit('webxr-hit-status', { message: 'Hit-test not available.' });
        console.warn('[HitTest] init error', e);
      }
    },

    /* User taps screen in the XR session */
    _onXRSelect() {
      if (!this.lastHitPose) {
        this.el.sceneEl.emit('webxr-hit-status', { message: 'No surface yet — keep scanning.' });
        return;
      }
      // Emit a deep-clone so it is fully independent of future tick updates
      this.el.sceneEl.emit('webxr-place-request', JSON.parse(JSON.stringify(this.lastHitPose)));
    },

    _onSessionEnd() {
      if (this.session) this.session.removeEventListener('select', this._onXRSelect);
      this.session = this.hitTestSource = this.viewerSpace = this.localSpace = this.lastHitPose = null;
      const r = document.getElementById('reticle');
      if (r) r.object3D.visible = false;
    },

    /* Every frame: run the hit-test and move the reticle */
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

      // Store a plain-object snapshot (NOT a live reference)
      this.lastHitPose = {
        position:   { x: p.x, y: p.y, z: p.z },
        quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
      };

      if (reticle) {
        if (!reticle.object3D.visible) {
          scene.emit('webxr-hit-status', { message: 'Surface found! Tap "Place Here".' });
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

/* ────────────────────────────────────────────
   Core helper: addEmojiToScene
   Creates an <a-text> entity at a FIXED world
   position that is fully independent of the reticle.
   ──────────────────────────────────────────── */
function addEmojiToScene(sceneEl, emoji, pos, id) {
  console.log(`[Place] addEmojiToScene "${emoji}" @ (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);

  const el = document.createElement('a-text');
  el.setAttribute('value', emoji);
  el.setAttribute('align', 'center');
  el.setAttribute('side', 'double');
  el.setAttribute('width', '6');                       // large enough to be readable
  el.setAttribute('color', '#ffffff');
  el.setAttribute('position', `${pos.x} ${pos.y + 0.15} ${pos.z}`);  // slight Y lift
  el.setAttribute('scale', '1 1 1');
  el.setAttribute('always-face-camera', '');            // billboard
  el.setAttribute('data-post-id', id || `local-${Date.now()}`);

  sceneEl.appendChild(el);
  return el;
}

/** Same as above but for multi-line text posts */
function addTextToScene(sceneEl, text, pos, id) {
  console.log(`[Place] addTextToScene "${text}" @ (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);

  const el = document.createElement('a-text');
  el.setAttribute('value', text);
  el.setAttribute('align', 'center');
  el.setAttribute('side', 'double');
  el.setAttribute('width', '4');
  el.setAttribute('color', '#59f2c7');
  el.setAttribute('position', `${pos.x} ${pos.y + 0.15} ${pos.z}`);
  el.setAttribute('scale', '1 1 1');
  el.setAttribute('always-face-camera', '');
  el.setAttribute('data-post-id', id || `local-${Date.now()}`);

  sceneEl.appendChild(el);
  return el;
}

/* ────────────────────────────────────────────
   Persistence helpers
   ──────────────────────────────────────────── */

/** POST to /api/ar-posts */
async function savePost(emoji, position, type = 'emoji') {
  console.log('[Save] saving post to backend…', { emoji, position });
  try {
    const saved = await createPost({
      type,
      content:   emoji,
      position:  { x: position.x, y: position.y, z: position.z },
      rotation:  { x: 0, y: 0, z: 0, w: 1 },  // identity quaternion
      timestamp: new Date().toISOString(),
    });
    console.log('[Save] success', saved?._id);
    return saved;
  } catch (err) {
    console.error('[Save] failed', err.message);
    return null;
  }
}

/** GET /api/ar-posts and spawn each one */
async function loadPosts(sceneEl, entitiesRef, debugFn) {
  console.log('[Load] fetching saved AR posts…');
  debugFn('Fetching saved posts from backend…');
  try {
    const posts = await fetchNearbyPosts();
    if (!posts?.length) {
      debugFn('No saved posts found.');
      return;
    }
    debugFn(`Loading ${posts.length} saved post(s)…`);
    posts.forEach((p) => {
      if (!p.position) return;
      const entity =
        p.type === 'text'
          ? addTextToScene(sceneEl, p.content, p.position, p._id)
          : addEmojiToScene(sceneEl, p.content, p.position, p._id);
      entitiesRef.current.push(entity);
    });
    debugFn(`Placed ${posts.length} saved post(s) in scene.`);
    console.log(`[Load] ${posts.length} posts restored`);
  } catch (err) {
    debugFn('Failed to load saved posts.');
    console.error('[Load] error', err);
  }
}

/* ────────────────────────────────────────────
   React component
   ──────────────────────────────────────────── */
function ARScene() {
  const sceneRef          = useRef(null);
  const latestHitRef      = useRef(null);   // latest hit-test snapshot (plain object)
  const placedEntitiesRef = useRef([]);
  const lastPlaceTime     = useRef(0);

  const [ready, setReady]           = useState(false); // A-Frame loaded
  const [sceneLoaded, setSceneLoaded] = useState(false);
  const [arActive, setArActive]     = useState(false);
  const [status, setStatus]         = useState('Loading AR runtime…');
  const [draft, setDraft]           = useState({ type: 'emoji', content: '😀' });
  const [logs, setLogs]             = useState([]);

  const log = useCallback((msg) => {
    console.log(`[AR] ${msg}`);
    setLogs((p) => [...p.slice(-40), msg]);   // keep last 40
  }, []);

  /* ── 1. Boot: load A-Frame ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      log('Checking WebXR support…');
      if (!navigator.xr) { setStatus('WebXR not supported. Use Chrome on Android + HTTPS.'); return; }
      const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
      log(`immersive-ar supported: ${ok}`);
      if (!ok) { setStatus('Immersive AR not supported on this device.'); return; }

      await loadScript(AFRAME_CDN);
      registerComponents();
      if (!alive) return;
      setReady(true);
      log('A-Frame loaded & components registered.');
      setStatus('Tap "Enter AR" to begin.');
    })();
    return () => { alive = false; };
  }, [log]);

  /* ── 2. Wait for A-Frame scene to initialise ── */
  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    const s = sceneRef.current;
    const done = () => { setSceneLoaded(true); log('A-Frame scene ready.'); };
    if (s.hasLoaded || s.renderStarted) { done(); return; }
    s.addEventListener('loaded', done, { once: true });
    return () => s.removeEventListener('loaded', done);
  }, [ready, log]);

  /* ── 3. Load saved posts once scene is up ── */
  useEffect(() => {
    if (!sceneLoaded || !sceneRef.current) return;
    loadPosts(sceneRef.current, placedEntitiesRef, log);
  }, [sceneLoaded, log]);

  /* ── 4. Wire up all A-Frame / XR event listeners ── */
  useEffect(() => {
    if (!ready || !sceneLoaded || !sceneRef.current) return;
    const scene = sceneRef.current;

    const onHitPose = (e) => {
      // Store a deep-clone so it never mutates when reticle moves
      latestHitRef.current = JSON.parse(JSON.stringify(e.detail));
    };

    const onStatus = (e) => {
      if (e.detail?.message) setStatus(e.detail.message);
    };

    const onEnter = () => { setArActive(true);  log('AR session started.'); };
    const onExit  = () => { setArActive(false); latestHitRef.current = null; log('AR session ended.'); setStatus('AR ended. Tap Enter AR to restart.'); };

    scene.addEventListener('webxr-hit-test',    onHitPose);
    scene.addEventListener('webxr-hit-status',  onStatus);
    scene.addEventListener('enter-vr',          onEnter);
    scene.addEventListener('exit-vr',           onExit);

    // If the XR select event fires, also place
    const onXRPlace = (e) => {
      if (!scene.is('ar-mode')) return;
      handlePlace(e.detail);
    };
    scene.addEventListener('webxr-place-request', onXRPlace);

    return () => {
      scene.removeEventListener('webxr-hit-test',     onHitPose);
      scene.removeEventListener('webxr-hit-status',   onStatus);
      scene.removeEventListener('enter-vr',           onEnter);
      scene.removeEventListener('exit-vr',            onExit);
      scene.removeEventListener('webxr-place-request', onXRPlace);
    };
  });   // intentionally no deps → always latest closures

  /* ── Core placement function ── */
  function handlePlace(hitPose) {
    if (!hitPose?.position) { log('handlePlace: no pose'); return; }
    const now = Date.now();
    if (now - lastPlaceTime.current < 500) return;  // debounce
    lastPlaceTime.current = now;

    // ★ KEY FIX: clone the position so the entity is INDEPENDENT of the reticle
    const pos = { x: hitPose.position.x, y: hitPose.position.y, z: hitPose.position.z };
    const scene = sceneRef.current;
    if (!scene) return;

    log(`Placing ${draft.type} "${draft.content}" at (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);

    // Add to scene — the entity gets a FIXED position string attribute
    const entity = draft.type === 'text'
      ? addTextToScene(scene, draft.content, pos)
      : addEmojiToScene(scene, draft.content, pos);

    placedEntitiesRef.current.push(entity);
    // Prune if too many
    while (placedEntitiesRef.current.length > MAX_POSTS) {
      placedEntitiesRef.current.shift()?.remove();
    }

    setStatus('Placed! Saving to server…');

    // Persist to backend
    savePost(draft.content, pos, draft.type).then((saved) => {
      if (saved?._id) {
        entity.setAttribute('data-post-id', saved._id);
        setStatus('Saved ✓');
        log(`Saved post ${saved._id}`);
      } else {
        setStatus('Placed locally (save failed).');
        log('Backend save failed — post is local only.');
      }
    });
  }

  /* ── Manual "Place Here" button handler ── */
  const onPlaceHere = useCallback((e) => {
    e.stopPropagation();
    const reticle = document.getElementById('reticle');
    if (!latestHitRef.current || !reticle?.object3D.visible) {
      setStatus('No surface detected — move phone slowly.');
      return;
    }
    // ★ KEY FIX: use reticle.object3D.position.clone() for a frozen snapshot
    const rPos = reticle.object3D.position.clone();
    const frozenPose = {
      position: { x: rPos.x, y: rPos.y, z: rPos.z },
    };
    handlePlace(frozenPose);
  }, [draft]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Enter AR ── */
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

  /* ────────────────────────────────────────────
     JSX
     ──────────────────────────────────────────── */
  return (
    <section className="camera-stage">
      {/* ── A-Frame scene ── */}
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

          {/* Reticle — only moves, never "holds" placed objects */}
          <a-entity
            id="reticle"
            geometry="primitive: ring; radiusInner: 0.04; radiusOuter: 0.05"
            material="color: #59f2c7; shader: flat; opacity: 0.85"
            visible="false"
            rotation="-90 0 0"
          >
            <a-entity
              geometry="primitive: circle; radius: 0.006"
              material="color: #59f2c7; shader: flat"
            />
          </a-entity>
        </a-scene>
      )}

      {/* ── DOM Overlay (always on top of the AR camera) ── */}
      <div id="ar-overlay" className="ar-overlay-container">
        {/* Status pill */}
        <div className="status-pill">{status}</div>

        {/* Debug log */}
        <div className="debug-panel">
          <strong style={{ display: 'block', marginBottom: 6 }}>WebXR Debug</strong>
          {logs.length === 0 && <div>Waiting…</div>}
          {logs.map((m, i) => <div key={i}>• {m}</div>)}
        </div>

        {/* Enter AR (hidden once session is live) */}
        <div className="top-controls">
          {!arActive && (
            <button type="button" className="primary-btn" onClick={enterAR}>
              Enter AR
            </button>
          )}
        </div>

        {/* Bottom toolbar */}
        <div className="bottom-ar-ui">
          <div className="create-post-label">
            <div className="status-pill" style={{ position: 'static', marginBottom: 10 }}>
              {draft.type === 'emoji' ? `Placing: ${draft.content}` : `Placing text`}
            </div>

            {arActive && (
              <button
                className="primary-btn pulse-glow"
                onClick={onPlaceHere}
                style={{ marginBottom: 10, width: '100%', borderRadius: 12 }}
              >
                👇 Place Here
              </button>
            )}
          </div>

          <div className="emoji-picker-row">
            {['😀', '😂', '❤️', '🔥', '🎉'].map((em) => (
              <button
                key={em}
                className={`emoji-btn ${draft.content === em ? 'emoji-btn--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setDraft({ type: 'emoji', content: em }); setStatus(`Selected ${em}`); }}
              >
                {em}
              </button>
            ))}
            <button
              className="emoji-btn text-btn"
              onClick={(e) => {
                e.stopPropagation();
                const t = window.prompt('Enter text:');
                if (t) { setDraft({ type: 'text', content: t }); setStatus('Text selected.'); }
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
