# SenseBridge — Live Demo Script & Investor Pitch Framework

---

## PART A: 7-Minute Live Demo Script

### ⏱ 0:00–1:00 — Problem Hook (Don't open the app yet)

> *"2.2 billion people worldwide live with visual impairment. 430 million are deaf or hard of hearing. 70 million cannot speak. Each group uses a different, disconnected app — none of which work offline."*

Show a 30-second silent video: a visually impaired person navigating a busy street alone, nearly missing a curb cut. No narration. Let the tension build.

> *"Today, I want to show you what happens when you give them a single, AI-powered safety system that works on ANY mid-range Android phone, with no internet, no wearable, no subscription required."*

---

### ⏱ 1:00–2:30 — Vision Assist Mode (Blind User)

1. Open app → select **Vision Assist** mode.
2. Point camera at a hallway with:
   - A chair (obstacle) at 1.5m
   - A door at 4m
3. App announces (TTS): *"Warning! Chair, 1.5 meters ahead."* (haptic buzzes).
4. Move camera toward a crosswalk image.
5. App announces: *"Caution — crosswalk ahead. Look for traffic."*

> *"It's seeing the world for them. Real-time, offline, under 230 milliseconds."*

---

### ⏱ 2:30–4:00 — Speech Assist Mode (Deaf User)

1. Switch to **Speech Assist** mode.
2. Speak clearly: *"The meeting room is on the second floor, turn left."*
3. Transcript appears on screen as a large caption banner in < 2 seconds.
4. Simulate a noisy environment. Show TTS volume auto-scaling.

> *"No interpreter required. SenseBridge becomes their ears."*

---

### ⏱ 4:00–5:00 — Emergency System Demo

1. Shake the phone 3 times vigorously.
2. A countdown timer appears: *"SOS in 5... 4... 3..."* with a prominent CANCEL button.
3. **Cancel** it.
4. Explain: *"In a real emergency, after 5 seconds, it sends SMS with a Google Maps link to their saved contacts."*

---

### ⏱ 5:00–6:00 — Personalization Demo

1. Open Settings → show the label weight sliders (or Dismiss History).
2. Dismiss "chair" alert twice.
3. Show (or explain): *"The system just learned that alerts for chairs are not important to this user. It will reduce their frequency. But a car? That stays CRITICAL — it cannot be suppressed."*

---

### ⏱ 6:00–7:00 — Metrics Slide + Close

Show a clean metrics card:

| Metric | Value |
|--------|-------|
| Detection mAP@50 | 0.79 |
| Gesture F1 | 0.93 |
| STT WER | 12.3% |
| E2E Latency | < 230ms |
| Battery drain | < 7%/hr |
| User SUS Score | 79.3 / 100 |

> *"Four AI models. One phone. Three disability groups. Completely offline."*

---

### 🔴 Backup Demo Strategy (If AI fails)

- **Pre-record a 3-minute screen recording** of a perfect demo run. Keep it on a USB stick.
- If live model fails: switch to the recorded video seamlessly.
- If network fails: demo was offline-first, so backend outage does not affect the AI demo.
- Have a second charged device as hot-standby.

---

---

## PART B: Investor / Judge Pitch Framework

### Slide 1: Problem (30 seconds)
- 2.7 billion people with significant disability globally.
- Existing tools: siloed, connectivity-dependent, unimodal.
- **Zero** unified, offline, multimodal assistive AI product exists at accessible price.

### Slide 2: Solution
- SenseBridge = one app for visually impaired, deaf, and mute users.
- 4 AI modules + a Fusion Engine that thinks like a safety expert.
- Works on any Android phone ≥ 2018. No internet required.

### Slide 3: Market Size
| Segment | Users (India) | Users (Global) |
|---------|--------------|----------------|
| Visually Impaired | 5.3M | 43M (severe) |
| Deaf/HoH | 63M | 430M |
| Speech Impaired | 12M | 70M |
| **Total TAM** | **~80M India** | **~543M Global** |

Assistive Technology market: **$30.8B globally by 2029** (CAGR 7.5%).

### Slide 4: Differentiation
| Feature | Be My Eyes | Lookout | Microsoft Seeing AI | **SenseBridge** |
|---------|-----------|---------|-------------------|-----------------|
| Offline | ❌ | ❌ | Partial | ✅ |
| Multi-disability | ❌ | ❌ | ❌ | ✅ |
| Emergency SOS | ❌ | ❌ | ❌ | ✅ |
| Personalization | ❌ | ❌ | ❌ | ✅ |
| Price | Free (volunteer) | Free | Free | Free + Pro |

### Slide 5: Revenue Model
- **Free Tier**: Core detection, transcription, gesture (supports mission).
- **Pro — ₹99/month (~$1.2)**: Cloud sync, emergency log history, advanced personalization, multi-language.
- **B2G**: Government procurement (ADIP Scheme, Ministry of Social Justice).
- **B2B**: White-label SDK for smart glasses manufacturers, hospitals, elder care companies.

### Slide 6: Traction / Roadmap
- Phase 1 (Now): Android MVP — 3 AI modes, emergency system, offline-first.
- Phase 2 (6 months): iOS port, regional language support (Tamil, Hindi, Telugu).
- Phase 3 (12 months): Smart glasses integration (Snapdragon AR2 Gen 1).
- Phase 4 (24 months): Federated personalization at scale, B2G partnerships.

### Slide 7: Social Impact
- **ADIP Scheme Grant**: Up to ₹40L for assistive tech startups.
- **UN CRPD alignment**: Article 9 (Accessibility), Article 20 (Personal Mobility).
- Partner with NAB India, Ali Yavar Jung National Institute (AYJNIHH) for field pilots.
- Target: 1M users in India within 3 years.

### Slide 8: The Ask
- Seeking: Seed funding or grant of **₹50L – ₹1Cr** for:
  - Field trials with 200 users across 4 cities.
  - Play Store launch & user acquisition.
  - Full-time team (2 AI engineers + 1 product).
  - ISO 9999 assistive technology certification.

---

## PART C: Post-Demo Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Model fails to detect | Show pre-recorded backup video |
| TTS not audible | Carry external Bluetooth speaker |
| Phone battery dies | Carry charged backup device |
| Network outage | All demos are offline-first by design |
| FPS drops under stage lights | Pre-calibrate exposure; use stable mount |
| Question about accuracy | Reference published benchmark table |
