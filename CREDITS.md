# Ice Wall Gate — Asset Credits & Licenses

All third-party and procedural assets bundled for the Plant Green Inertia (`PGI Portal`) Winter Internship Ice Wall Gate are CC0 / Public Domain or original project assets with zero copyrighted film, game, or comic artwork.

## 1. PBR Glacier / Ice Textures
- **Asset:** `Ice003` (`Color`, `NormalGL`, `Roughness`, `Displacement` converted to 2K and 1K WebP)
- **Author / Source:** Lennart Demes — ambientCG (`https://ambientcg.com/view?id=Ice003`)
- **Files:**
  - `public/static/textures/ice/ice_color.webp`, `ice_normal.webp`, `ice_roughness.webp`, `ice_bump.webp` (2048x2048 desktop)
  - `public/static/textures/ice/1k/ice_color.webp`, `ice_normal.webp`, `ice_roughness.webp`, `ice_bump.webp` (1024x1024 mobile)
- **License:** Creative Commons CC0 1.0 Universal (Public Domain Dedication)

## 2. Arctic Night Environment HDRI
- **Asset:** `blue_lagoon_night_1k.hdr`
- **Author / Source:** Greg Zaal / Poly Haven (`https://polyhaven.com/a/blue_lagoon_night`)
- **File:** `public/static/hdr/blue_lagoon_night_1k.hdr`
- **License:** Creative Commons CC0 1.0 Universal (Public Domain Dedication)

## 3. Original Norse War Hammer 3D Model & Fallback Cursor
- **Asset:** Original procedurally modeled Norse-style war hammer (`ForgedRunicSteel` head with original geometric frost motifs, `AshWoodHaft`, `StitchedLeatherGrip`, `CastPommelSteel` pommel) + matching 128px fallback PNG cursor
- **Files:**
  - `public/static/models/norse-hammer.glb`
  - `public/static/images/hammer-cursor.png`
- **Author:** Plant Green Inertia engineering (original procedural geometry & PBR textures, zero third-party IP)
- **License:** CC0 1.0 / Project MIT-compatible original asset

## 4. Sound Effects (Optional, Off by Default)
- **Assets:** Original synthesized winter ice acoustics encoded to compact MP3 (`1,945`–`23,277` bytes each)
  - `public/static/audio/impact-thud.mp3` — Heavy hammer strike thud on frozen ice
  - `public/static/audio/ice-crack.mp3` — High-transient crystalline fracture crack (hits 1–2)
  - `public/static/audio/ice-creak.mp3` — Deep glacial stress creak & sub-rumble (hit 2)
  - `public/static/audio/ice-shatter.mp3` — Slow-mo ice detonation & cascading crystal shard fall (hit 3)
- **Author:** Plant Green Inertia engineering (synthesized via NumPy/SciPy DSP & LAME MP3)
- **License:** Creative Commons CC0 1.0 Universal (Public Domain Dedication)

## 5. Runtime 3D & Physics Libraries (Pinned CDN)
- **Three.js (`three@0.169.0`):** `https://cdn.jsdelivr.net/npm/three@0.169.0/` — MIT License
- **Draco Decoder (`three@0.169.0` bundled decoder):** Apache 2.0 License
- **cannon-es (`cannon-es@0.20.0`):** `https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js` — MIT License
