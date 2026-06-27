/* ============================================================================
   Sync layer — backend-agnostic shared sessions.

   A "session" is one badminton meet: { meta, players, courts, assign, scores }.
   The host creates it on the Courts tab; everyone else opens a share link
   (?s=<id>) and reads/writes the SAME session live.

   Two backends implement the same interface:
     - FirebaseBackend : real cross-device sync via Firestore (if config present)
     - MockBackend     : localStorage + BroadcastChannel (same device, for testing)

   Public API (window.Sync):
     mode                       -> "firebase" | "local"
     newSessionId()             -> short shareable id
     create(id, session)        -> Promise   (host writes the initial session)
     join(id, onChange)         -> Promise<unsubscribe>   (live subscribe)
     setScore(id, court, game, side, value) -> Promise   (per-field merge write)
     get(id)                    -> Promise<session|null>
   ============================================================================ */
(function () {
  const SCORE_PATH = (court, game, side) => `scores.${court}.${game}.${side}`;

  /* ------------------------------- Mock --------------------------------- */
  // Stores sessions in localStorage; uses BroadcastChannel to notify other
  // tabs on the same browser instantly (falls back to the 'storage' event).
  function MockBackend() {
    const key = id => `bl_session_${id}`;
    const chan = ("BroadcastChannel" in self) ? new BroadcastChannel("bl_sync") : null;
    const listeners = {}; // id -> Set(cb)

    function read(id) {
      try { return JSON.parse(localStorage.getItem(key(id))); } catch { return null; }
    }
    function write(id, session) {
      localStorage.setItem(key(id), JSON.stringify(session));
      const msg = { id, session };
      if (chan) chan.postMessage(msg);
      // notify same-tab listeners (BroadcastChannel doesn't echo to sender)
      (listeners[id] || []).forEach(cb => cb(session));
    }
    if (chan) chan.onmessage = e => {
      const { id, session } = e.data || {};
      (listeners[id] || []).forEach(cb => cb(session));
    };
    // cross-tab fallback for browsers without BroadcastChannel
    self.addEventListener("storage", e => {
      if (!e.key || !e.key.startsWith("bl_session_")) return;
      const id = e.key.slice("bl_session_".length);
      const session = read(id);
      (listeners[id] || []).forEach(cb => cb(session));
    });

    return {
      mode: "local",
      async create(id, session) { write(id, session); },
      async get(id) { return read(id); },
      async join(id, onChange) {
        (listeners[id] = listeners[id] || new Set()).add(onChange);
        const cur = read(id);
        if (cur) Promise.resolve().then(() => onChange(cur));
        return () => listeners[id] && listeners[id].delete(onChange);
      },
      async setScore(id, court, game, side, value) {
        const s = read(id) || {};
        s.scores = s.scores || {};
        (s.scores[court] = s.scores[court] || {});
        (s.scores[court][game] = s.scores[court][game] || {});
        s.scores[court][game][side] = value;
        s.updatedAt = stamp();
        write(id, s);
      },
      async getCounter() { return +localStorage.getItem("bl_games_count") || 0; },
      async bumpCounter() {
        const n = (+localStorage.getItem("bl_games_count") || 0) + 1;
        localStorage.setItem("bl_games_count", String(n));
        return n;
      },
    };
  }

  /* ----------------------------- Firebase ------------------------------- */
  // Loads the modular Firebase SDK from the CDN and talks to Firestore.
  async function FirebaseBackend(config) {
    const app = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const fs = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const fbApp = app.initializeApp(config);
    const db = fs.getFirestore(fbApp);
    const ref = id => fs.doc(db, "sessions", id);
    const statsRef = () => fs.doc(db, "stats", "global");

    return {
      mode: "firebase",
      async create(id, session) {
        await fs.setDoc(ref(id), { ...session, updatedAt: stamp() });
      },
      async get(id) {
        const snap = await fs.getDoc(ref(id));
        return snap.exists() ? snap.data() : null;
      },
      async join(id, onChange) {
        return fs.onSnapshot(ref(id), snap => {
          if (snap.exists()) onChange(snap.data());
        });
      },
      async setScore(id, court, game, side, value) {
        // Dotted field path = atomic per-field merge; concurrent writers to
        // different games never overwrite each other.
        await fs.updateDoc(ref(id), {
          [SCORE_PATH(court, game, side)]: value,
          updatedAt: stamp(),
        });
      },
      async getCounter() {
        const snap = await fs.getDoc(statsRef());
        return (snap.exists() && snap.data().games) || 0;
      },
      async bumpCounter() {
        // Atomic increment; setDoc+merge creates the doc on first use.
        await fs.setDoc(statsRef(), { games: fs.increment(1) }, { merge: true });
        return this.getCounter();
      },
    };
  }

  function stamp() { return new Date().toISOString(); }

  // 6-char id, avoids ambiguous chars (no O/0/I/1/l).
  function newSessionId() {
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = "";
    const a = new Uint8Array(6);
    (self.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = (i * 53 + 17) % 256);
    for (let i = 0; i < 6; i++) s += abc[a[i] % abc.length];
    return s;
  }

  /* ------------------------- Backend selection -------------------------- */
  let backendPromise = null;
  function backend() {
    if (backendPromise) return backendPromise;
    const cfg = self.FIREBASE_CONFIG;
    if (cfg && cfg.projectId) {
      backendPromise = FirebaseBackend(cfg).catch(err => {
        console.warn("Firebase init failed, falling back to local sync:", err);
        return MockBackend();
      });
    } else {
      backendPromise = Promise.resolve(MockBackend());
    }
    return backendPromise;
  }

  // Public wrapper: resolves the backend lazily, exposes a stable mode flag.
  const Sync = {
    mode: (self.FIREBASE_CONFIG && self.FIREBASE_CONFIG.projectId) ? "firebase" : "local",
    newSessionId,
    async create(id, session) { return (await backend()).create(id, session); },
    async get(id) { return (await backend()).get(id); },
    async join(id, onChange) { return (await backend()).join(id, onChange); },
    async setScore(id, court, game, side, value) {
      return (await backend()).setScore(id, court, game, side, value);
    },
    // Global "games finalized" counter. Fails soft (returns 0 / no-op) if the
    // Firestore rules don't allow the stats doc, so it never breaks the app.
    async getCounter() {
      try { return await (await backend()).getCounter(); } catch { return 0; }
    },
    async bumpCounter() {
      try { return await (await backend()).bumpCounter(); } catch { return 0; }
    },
  };

  self.Sync = Sync;
})();
