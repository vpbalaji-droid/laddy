/* ============================================================================
   Firebase configuration.

   Leave this as null to run in LOCAL/MOCK mode (scores sync only between tabs
   on the SAME device — great for testing, no setup needed).

   To enable REAL cross-device sync, create a free Firebase project and paste
   its web config here. Step-by-step:

     1. Go to https://console.firebase.google.com → "Add project" (free).
     2. In the project, click the </> "Web" icon to register a web app.
     3. Copy the firebaseConfig object it shows you and paste it below,
        replacing `null`. It looks like:
            window.FIREBASE_CONFIG = {
              apiKey: "AIza...",
              authDomain: "your-app.firebaseapp.com",
              projectId: "your-app",
              storageBucket: "your-app.appspot.com",
              messagingSenderId: "1234567890",
              appId: "1:1234567890:web:abc123"
            };
     4. In the console: Build ▸ Firestore Database ▸ Create database ▸
        Start in TEST mode (or set the rules in SYNC_SETUP.md). Pick a region.
     5. Reload the app. It will now use Firestore automatically.

   These web keys are NOT secret — they only identify your project. Access is
   controlled by Firestore security rules (see SYNC_SETUP.md).
   ============================================================================ */
window.FIREBASE_CONFIG = null;
