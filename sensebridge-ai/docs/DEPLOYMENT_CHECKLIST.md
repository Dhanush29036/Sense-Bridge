# SenseBridge — Production Deployment Checklist

## 1. APK Build Process

```bash
# 1. Build React frontend
cd sensebridge-frontend
npm run build              # Produces dist/

# 2. Sync to Capacitor
npx cap sync android

# 3. Open in Android Studio
npx cap open android

# 4. In Android Studio:
#    Build → Generate Signed Bundle/APK → Android App Bundle (AAB)
#    Use a release keystore (store securely — loss = app unrecoverable)

# 5. Run on physical device first
#    adb install app-release.apk
```

---

## 2. Model Packaging

- [ ] Add to `android/app/src/main/assets/models/`:
  - `yolov8n_int8.tflite`
  - `lstm_gesture_int8.onnx`
  - `classes.txt`
- [ ] In `android/app/build.gradle`, add:
  ```groovy
  android {
    aaptOptions {
      noCompress "tflite", "onnx"  // CRITICAL — prevents extraction overhead
    }
  }
  ```
- [ ] Verify model files are present before app launch (add a startup check that shows an error if models are missing).

---

## 3. Required Android Permissions (`AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.SEND_SMS" />
<uses-permission android:name="android.permission.CALL_PHONE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

Request all permissions at runtime (Android 6.0+) — show a clear rationale dialog.

---

## 4. Privacy Policy Requirements (GDPR / India DPDP Act)

The app collects:
- Camera frames (processed on-device, never stored or uploaded)
- Microphone audio (processed on-device for Whisper; not stored)
- GPS coordinates (only during SOS emergency, sent to contacts you've added)
- Usage preferences (stored locally, optionally synced to cloud if Pro)

**Required sections in Privacy Policy:**
- [ ] What data is collected and why
- [ ] How long data is retained (Emergency logs: 1 year, then auto-deleted)
- [ ] User rights: data export, deletion request
- [ ] Third-party services: Twilio (SMS), Google Maps (emergency link)
- [ ] Contact info for privacy queries
- [ ] Compliance statement: DPDP Act 2023 (India), GDPR (EU)

---

## 5. Accessibility Compliance Checklist

**Android Accessibility:**
- [ ] All interactive elements have `contentDescription` set
- [ ] TalkBack navigation tested thoroughly
- [ ] Touch targets ≥ 48dp × 48dp
- [ ] Default font scale 1.4× supported (large text mode)
- [ ] High contrast theme applied when system setting is enabled

**Visual Design:**
- [ ] WCAG 2.1 AA contrast ratio ≥ 4.5:1 for all text
- [ ] No color-only information encoding (use icons + color)
- [ ] Color-blind safe palette validated via Coblis simulator

---

## 6. Crash Reporting Setup

**Firebase Crashlytics** (recommended — free, integrates with Android Studio):

```bash
# In android/app/build.gradle:
implementation 'com.google.firebase:firebase-crashlytics:18.6.0'
```

- [ ] Crashlytics dashboard configured
- [ ] Custom keys logged: `user_mode`, `active_module`, `last_alert_label`
- [ ] Non-fatal errors for model load failures (so TFLite errors surface without crashing the app)
- [ ] Test crash button in Debug builds only

---

## 7. Play Store Internal Testing Track

1. Create app in Google Play Console.
2. Upload AAB to **Internal Testing** track.
3. Add testers via email (up to 100 testers).
4. Minimum review time: 1-2 hours for internal testing.
5. Before promoting to **Production**:
   - [ ] Complete **Data Safety** form (camera, mic, location usage declared)
   - [ ] Provide Privacy Policy URL
   - [ ] Submit accessibility declaration
   - [ ] Pass pre-launch report (Play Console auto-tests your APK on real devices)

---

## 8. Offline Validation Checklist

- [ ] Enable Airplane Mode. Launch app. Confirm all 3 AI modes function.
- [ ] Trigger SOS in Airplane Mode → confirm `offline_sos_queue.jsonl` is written.
- [ ] Reconnect network → confirm queued SOS is retried and dispatched.
- [ ] Confirm TTS works offline (uses Android TTS engine, no network needed).
- [ ] Confirm Whisper inference completes offline (model bundled in APK).

---

## 9. Final Pre-Launch Readiness Checklist

- [ ] All 3 user modes (blind / deaf / mute) tested with real representative users
- [ ] Emergency SOS tested with real SMS delivery (Twilio live credentials)
- [ ] App size < 150MB (YOLO TFLite ~6MB, Whisper GGML tiny ~75MB)
- [ ] No DEBUG logs or test data left in production build
- [ ] Backend API deployed to production server (not localhost)
- [ ] HTTPS enforced on all API endpoints (TLS 1.3)
- [ ] Backend rate limiting verified (no abuse vector)
- [ ] Play Store listing: screenshots, feature graphic, demo video uploaded
- [ ] Version name: `1.0.0`, version code: `1`
