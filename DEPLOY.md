# Deploying Laddy — from this folder to your phone (and the Play Store)

There are three phases. **Phase 1 is required for everything else** and already
gives you a real installable app on your phone. Phases 2–3 are only for getting
it listed on the Google Play Store.

```
Phase 1: Host the PWA on HTTPS   → installable on your phone TODAY (free)
Phase 2: Wrap it as an Android .aab with Bubblewrap (TWA)
Phase 3: Upload to Play Console  → public listing ($25 one-time, ~days review)
```

---

## Phase 1 — Host on HTTPS (do this first)

Pick ONE host. GitHub Pages is the most common; Netlify is the fastest.

### Option A — GitHub Pages

1. Create a free GitHub account if you don't have one: <https://github.com/signup>
2. Create a new repository, e.g. `laddy` (Public).
3. Upload the contents of this folder. Either:
   - **Web:** repo page → *Add file ▸ Upload files* → drag in `index.html`,
     `app.js`, `styles.css`, `sync.js`, `firebase-config.js`, `sw.js`,
     `manifest.webmanifest`, and the `icons/` folder → *Commit*.
   - **CLI** (from this folder):
     ```bash
     git init && git add . && git commit -m "Laddy PWA"
     git branch -M main
     git remote add origin https://github.com/<YOUR_USER>/laddy.git
     git push -u origin main
     ```
4. Repo → **Settings ▸ Pages** → *Build and deployment* → Source: **Deploy from a
   branch**, Branch: **main**, folder: **/ (root)** → Save.
5. Wait ~1 minute. Your URL appears at the top:
   **`https://<YOUR_USER>.github.io/laddy/`**

### Option B — Netlify (no git needed)

1. <https://app.netlify.com/drop>
2. Drag this whole folder onto the page.
3. You get an instant URL like `https://random-name.netlify.app`. Done.
   (Optionally rename it in Site settings.)

### Install on your phone (works right now)

1. Open the URL in **Chrome on Android**.
2. Menu **⋮ ▸ Add to Home screen** ▸ Install.
3. Laddy now has its own icon and opens full-screen like a native app.

> ✅ At this point you have a working, installable, shareable app. Share the URL
> with your badminton group — anyone can "Add to Home screen" too. For most
> people this is enough and you can stop here.

---

## Phase 2 — Wrap as an Android app (Bubblewrap → TWA)

This produces the `.aab`/`.apk` the Play Store needs. **Run this on your own
computer** (Mac/Windows/Linux) — it needs the Android SDK, which can't run in
the cloud dev environment.

### Prerequisites (one time)
- **Node.js 18+** : <https://nodejs.org>
- **Java JDK 17** : `https://adoptium.net`
- Bubblewrap installs the Android SDK for you on first run.

### Build
```bash
npm install -g @bubblewrap/cli

# point it at your hosted manifest from Phase 1:
bubblewrap init --manifest https://<YOUR_USER>.github.io/laddy/manifest.webmanifest
# answer the prompts (app name "Laddy", package id e.g. dev.laddy.app — accept defaults otherwise)

bubblewrap build
```
Outputs:
- `app-release-signed.apk`  → **install this directly on your phone to test**
- `app-release-bundle.aab`  → upload this to the Play Store in Phase 3

### Test the APK on your phone (faster than the store)
```bash
# with the phone plugged in and USB debugging on:
adb install app-release-signed.apk
```
Or just copy the `.apk` to the phone and tap it (enable "install from unknown
sources"). This is the quickest way to test the *wrapped* app on a real device.

### Domain verification (removes the browser address bar)
`bubblewrap build` prints an `assetlinks.json`. Put it at:
```
https://<YOUR_USER>.github.io/laddy/.well-known/assetlinks.json
```
(Create a folder `.well-known/` in your repo and add that file.) Without this the
app still works but shows a thin URL bar at the top.

---

## Phase 3 — Publish to the Play Store

1. **Google Play Console** account — one-time **$25**:
   <https://play.google.com/console/signup>
   (New accounts also require identity verification — can take a couple of days.)
2. **Create app** → fill name (Laddy), language, "App", "Free".
3. **Create a release** (start with *Internal testing* — fastest, invite testers
   by email) → upload `app-release-bundle.aab`.
4. Complete the required sections: store listing (short + full description),
   **screenshots** (phone), app **icon 512×512**, **feature graphic 1024×500**,
   content rating questionnaire, data-safety form, and a **privacy policy URL**.
5. Submit. Internal-testing builds go live to your invited testers quickly;
   full public release waits on Google review (often 1–3 days).

> **Tip:** use the **Internal testing** track to put it on your own and your
> group's phones via a Play link without waiting for full review.

---

## Recommendation for "I just want to test on my phone"

Do **Phase 1** (5 min, free) and **Add to Home screen**. If you specifically
want the *packaged Android app* on your phone, do **Phase 2** and `adb install`
the APK. Only do **Phase 3** when you want a public Play Store listing.
