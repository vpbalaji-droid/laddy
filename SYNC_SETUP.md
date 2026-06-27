# Live score sync — setup

The app works in two modes:

| Mode | When | Sync scope |
|---|---|---|
| **Local (mock)** | default, no setup | between browser tabs on the **same device** — good for testing |
| **Firebase** | after you paste config | **across all devices**, real-time |

You can demo the whole flow right now in Local mode: open the app, assign courts, tap **Start live scoring**, copy the link, and open it in a second browser tab — scores entered in one tab appear in the other.

## Enabling real cross-device sync (Firebase)

Free, ~5 minutes, no server to run.

1. Go to <https://console.firebase.google.com> → **Add project** (any name). Disable Google Analytics if you like. Create.
2. On the project overview, click the **`</>` (Web)** icon → register an app (nickname e.g. "ladder"). **Don't** enable Hosting yet.
3. It shows a `firebaseConfig = { ... }` object. Copy those values into **`firebase-config.js`**, replacing `null`:
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "your-app.firebaseapp.com",
     projectId: "your-app",
     storageBucket: "your-app.appspot.com",
     messagingSenderId: "123...",
     appId: "1:123...:web:abc..."
   };
   ```
4. Left menu → **Build ▸ Firestore Database ▸ Create database**. Choose a region close to you. Start in **production mode**, then paste the rules below.
5. Reload the app. The Play tab banner will say **"Live"** (green dot) instead of "Local test mode".

### Firestore security rules

These let anyone with a session **code** read/write that session's scores, but nothing else. Paste in **Firestore ▸ Rules ▸ Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      // Session IDs are random 6-char codes; knowing the code grants access.
      allow read, write: if true;
    }
    // Global "ladder games played" counter shown on the Home page.
    match /stats/global {
      allow read, write: if true;
    }
  }
}
```

> **The `stats/global` block is required for the Home-page counter.** Without it,
> the counter just stays hidden (the app fails soft) — sessions still work fine.

> This is fine for casual badminton sessions (the code is the shared secret, and old sessions are harmless). If you later want it locked down — e.g. only the host can change the roster, or sessions auto-expire — tell me and I'll add Firebase Anonymous Auth + tighter rules + a TTL field.

## How sharing works in the app

1. Host assigns courts → **Play** tab → **Start live scoring & get share link**.
2. App creates a session with a short code (e.g. `J2BH6B`) and puts it in the URL (`?s=J2BH6B`).
3. Host taps **Copy** / **Share…** and sends the link to the group.
4. Anyone who opens the link lands directly on a **scoring-only** Play view (other tabs hidden) and can enter scores.
5. Every score is written as a single field, so two people scoring different games never overwrite each other; all screens update live.
6. Host still uses **Finalize → PDF** off the synced data.
