/**
 * IceWallGate3D — Full 3D Glacier Ice Wall, Norse War Hammer Cursor,
 * Voronoi Pre-Fractured Shatter & cannon-es Physics Gate.
 */
(function (global) {
  'use strict';

  const THREE_DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/';
  const CANNON_CDN_URL = 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
  const HDRI_PATH = '/static/hdr/blue_lagoon_night_1k.hdr';
  const HAMMER_GLB_PATH = '/static/models/norse-hammer.glb';

  const WALL_W = 9.2;
  const WALL_H = 3.2;
  const WALL_CENTER_Y = -0.34;

  function seededRand(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function makeRadialSpriteTexture(THREE, innerRgba, midRgba, outerRgba) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 2, 128, 128, 126);
    gr.addColorStop(0, innerRgba);
    gr.addColorStop(0.42, midRgba || outerRgba);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Sculpt a monumental ~1m-deep glacial cliff monolith with angular crystalline
   * cleavage planes, jagged crown silhouette, and pale-to-deep-blue depth gradient.
   */
  function sculptGlacierWallGeometry(THREE, w, h, d, segX, segY, segZ, worldOffsetX, worldOffsetY, rng, isCrown) {
    const geo = new THREE.BoxGeometry(w, h, d, segX, segY, segZ);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const surfaceFrost = new THREE.Color('#F5FAFF');
    const glacierBlue = new THREE.Color('#9ED4F6');
    const deepCore = new THREE.Color('#1B4E84');
    const portalCenterTint = new THREE.Color('#FFF8EC');
    const tmp = new THREE.Color();

    const p1 = rng() * 6.28;
    const p2 = rng() * 6.28;

    const sites = [];
    for (let k = 0; k < 22; k++) {
      sites.push({
        x: (rng() - 0.5) * w * 1.15,
        y: (rng() - 0.5) * h * 1.15,
        tiltX: (rng() - 0.5) * 0.26,
        tiltY: (rng() - 0.5) * 0.24,
        biasZ: (rng() - 0.48) * 0.14
      });
    }

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      let bestDist = 1e9;
      let bestSite = sites[0];
      for (let s = 0; s < sites.length; s++) {
        const dx = x - sites[s].x;
        const dy = y - sites[s].y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestSite = sites[s];
        }
      }

      const localFacet =
        (x - bestSite.x) * bestSite.tiltX +
        (y - bestSite.y) * bestSite.tiltY +
        bestSite.biasZ;

      const wx = x + worldOffsetX;
      const wy = y + worldOffsetY;
      const microChisel = Math.abs(Math.sin(wx * 2.6 + p1) * Math.cos(wy * 2.1 + p2)) * 0.045 - 0.02;

      if (z > 0.04) {
        z += localFacet * 0.65 + microChisel;
      } else if (z < -0.04) {
        z -= localFacet * 0.45;
      }

      const yNorm = (y + h * 0.5) / h;
      const xNorm = Math.abs(x) / (w * 0.5);
      if (isCrown && yNorm > 0.72) {
        const crownCrag =
          Math.abs(Math.sin(wx * 1.45 + 0.6)) * 0.28 +
          Math.abs(Math.cos(wx * 3.1 - 0.4)) * 0.14;
        y += (yNorm - 0.72) * crownCrag * 1.5 - Math.max(0, xNorm - 0.65) * 0.35;
        z *= Math.max(0.45, 1.0 - (yNorm - 0.72) * 1.1);
      }

      pos.setXYZ(i, x, y, z);

      const radialCenter = Math.max(0, 1 - Math.hypot(wx * 0.36, wy * 0.48));
      const heightShade = Math.max(0, 0.5 - wy * 0.22);
      const ridgeBright = Math.max(0, Math.min(1, 0.45 + localFacet * 3.2));

      tmp.copy(glacierBlue)
        .lerp(surfaceFrost, Math.max(ridgeBright * 0.55, Math.max(0, (yNorm - 0.68) * 1.8)))
        .lerp(deepCore, Math.min(0.65, heightShade * 0.65 + (1 - radialCenter) * 0.25))
        .lerp(portalCenterTint, radialCenter * 0.26);

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Half-plane Sutherland-Hodgman Voronoi polygon clipper inside [-hw..+hw, -hh..+hh].
   * Produces exact convex 2D Voronoi cells with denser clustering near impact/center.
   */
  function clipPolygonHalfPlane(poly, ax, ay, nx, ny) {
    const out = [];
    const len = poly.length;
    if (len < 3) return out;
    for (let i = 0; i < len; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % len];
      const d1 = (p1[0] - ax) * nx + (p1[1] - ay) * ny;
      const d2 = (p2[0] - ax) * nx + (p2[1] - ay) * ny;
      const in1 = d1 <= 1e-6;
      const in2 = d2 <= 1e-6;
      if (in1 && in2) {
        out.push(p2);
      } else if (in1 && !in2) {
        const t = d1 / (d1 - d2);
        out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
      } else if (!in1 && in2) {
        const t = d1 / (d1 - d2);
        out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
        out.push(p2);
      }
    }
    return out;
  }

  function generateVoronoiCells(count, hw, hh, rng) {
    const seeds = [];
    const denseCount = Math.round(count * 0.62);
    for (let i = 0; i < count; i++) {
      if (i < denseCount) {
        // Finer Voronoi cells clustered across central strike zone
        const rx = (rng() + rng() - 1) * hw * 0.64;
        const ry = (rng() + rng() - 1) * hh * 0.78;
        seeds.push([rx, ry]);
      } else {
        seeds.push([(rng() - 0.5) * hw * 2, (rng() - 0.5) * hh * 2]);
      }
    }

    const cells = [];
    for (let i = 0; i < seeds.length; i++) {
      const [sx, sy] = seeds[i];
      let poly = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      for (let j = 0; j < seeds.length; j++) {
        if (i === j) continue;
        const [ox, oy] = seeds[j];
        const mx = (sx + ox) * 0.5;
        const my = (sy + oy) * 0.5;
        const nx = ox - sx;
        const ny = oy - sy;
        poly = clipPolygonHalfPlane(poly, mx, my, nx, ny);
        if (poly.length < 3) break;
      }
      if (poly.length < 3) continue;

      // Recenter polygon vertices around its centroid for clean rotation physics
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < poly.length; k++) {
        cx += poly[k][0];
        cy += poly[k][1];
      }
      cx /= poly.length;
      cy /= poly.length;
      const localVerts = poly.map(p => [p[0] - cx, p[1] - cy]);
      let maxR = 0.08;
      for (let k = 0; k < localVerts.length; k++) {
        maxR = Math.max(maxR, Math.hypot(localVerts[k][0], localVerts[k][1]));
      }
      cells.push({
        cx,
        cy,
        verts: localVerts,
        radius: maxR,
        depth: 0.62 + rng() * 0.36
      });
    }
    return cells;
  }

  /**
   * Procedural animated radial fracture & inner glow CanvasTexture for Hits 1..4.
   */
  function createFractureOverlayCanvas() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const ctx = c.getContext('2d');
    const impacts = [];

    function registerHit(u, v, hitLevel, rng) {
      const cx = u * c.width;
      const cy = (1 - v) * c.height;
      const arms = 10 + hitLevel * 4;
      const paths = [];
      for (let i = 0; i < arms; i++) {
        const ang = (i / arms) * Math.PI * 2 + (rng() - 0.5) * 0.38;
        const totalLen = (58 + hitLevel * 54) * (0.58 + rng() * 0.85);
        const pts = [{ x: cx, y: cy }];
        let px = cx;
        let py = cy;
        const steps = 9;
        for (let s = 1; s <= steps; s++) {
          const jAng = ang + (rng() - 0.5) * 0.65;
          const segLen = (totalLen / steps) * (0.7 + rng() * 0.6);
          px += Math.cos(jAng) * segLen;
          py += Math.sin(jAng) * segLen;
          pts.push({ x: px, y: py });
        }
        paths.push({ pts, baseW: 1.8 + hitLevel * 0.55, branch: null });
        if (hitLevel >= 2 && i % 2 === 0 && pts.length > 5) {
          const sp = pts[3];
          const bAng = ang + (rng() > 0.5 ? 0.72 : -0.72);
          const bLen = totalLen * 0.48;
          paths[paths.length - 1].branch = [
            { x: sp.x, y: sp.y },
            { x: sp.x + Math.cos(bAng) * bLen * 0.35, y: sp.y + Math.sin(bAng) * bLen * 0.35 },
            { x: sp.x + Math.cos(bAng - 0.25) * bLen * 0.7, y: sp.y + Math.sin(bAng - 0.25) * bLen * 0.7 },
            { x: sp.x + Math.cos(bAng + 0.15) * bLen, y: sp.y + Math.sin(bAng + 0.15) * bLen }
          ];
        }
      }
      // Subtle concentric micro-ring fractures right around impact point
      const ringSegs = 6 + hitLevel * 2;
      const rings = [];
      for (let r = 0; r < ringSegs; r++) {
        const ra = (r / ringSegs) * Math.PI * 2 + rng() * 0.3;
        const rad = 14 + (r % 2) * 14 + rng() * 10;
        rings.push([
          { x: cx + Math.cos(ra) * rad, y: cy + Math.sin(ra) * rad },
          { x: cx + Math.cos(ra + 0.42) * (rad * 1.15), y: cy + Math.sin(ra + 0.42) * (rad * 1.15) }
        ]);
      }
      impacts.push({ cx, cy, hitLevel, paths, rings, born: performance.now(), done: false });
    }

    function redraw(now) {
      let dirty = false;
      ctx.clearRect(0, 0, c.width, c.height);
      for (let i = 0; i < impacts.length; i++) {
        const imp = impacts[i];
        const age = (now - imp.born) / 400; // 400ms animated crack growth
        const grow = Math.min(1, Math.max(0.06, age));
        if (grow < 1) dirty = true;
        else imp.done = true;

        // Sharp white impact star core
        const starR = (18 + imp.hitLevel * 10) * Math.min(1, grow * 1.5);
        const starGrad = ctx.createRadialGradient(imp.cx, imp.cy, 1, imp.cx, imp.cy, starR);
        starGrad.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
        starGrad.addColorStop(0.32, 'rgba(220, 238, 255, 0.58)');
        starGrad.addColorStop(1, 'rgba(185, 221, 245, 0)');
        ctx.fillStyle = starGrad;
        ctx.beginPath();
        ctx.arc(imp.cx, imp.cy, starR, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';

        // Impact micro-ring splinters
        ctx.strokeStyle = 'rgba(245, 250, 255, 0.72)';
        ctx.lineWidth = 1.1;
        for (let r = 0; r < imp.rings.length; r++) {
          const seg = imp.rings[r];
          ctx.beginPath();
          ctx.moveTo(seg[0].x, seg[0].y);
          ctx.lineTo(seg[1].x, seg[1].y);
          ctx.stroke();
        }

        // Tapered glacial fracture veins (dark deep-ice cleft + crisp offset frost catchlight)
        for (let p = 0; p < imp.paths.length; p++) {
          const path = imp.paths[p];
          const pts = path.pts;
          const exactIdx = grow * (pts.length - 1);
          const fullSegs = Math.floor(exactIdx);
          const frac = exactIdx - fullSegs;
          const nPts = pts.length - 1;

          for (let k = 0; k < fullSegs; k++) {
            const taper = Math.max(0.18, 1.0 - k / nPts);
            ctx.strokeStyle = 'rgba(11, 29, 58, 0.78)';
            ctx.lineWidth = path.baseW * taper + 1.1;
            ctx.beginPath();
            ctx.moveTo(pts[k].x, pts[k].y);
            ctx.lineTo(pts[k + 1].x, pts[k + 1].y);
            ctx.stroke();

            ctx.strokeStyle = imp.hitLevel >= 3 ? 'rgba(255, 250, 238, 0.90)' : 'rgba(245, 250, 255, 0.88)';
            ctx.lineWidth = Math.max(0.55, path.baseW * taper * 0.72);
            ctx.beginPath();
            ctx.moveTo(pts[k].x + 0.6, pts[k].y - 0.5);
            ctx.lineTo(pts[k + 1].x + 0.6, pts[k + 1].y - 0.5);
            ctx.stroke();
          }

          if (fullSegs < nPts) {
            const taper = Math.max(0.18, 1.0 - fullSegs / nPts);
            const a = pts[fullSegs];
            const b = pts[fullSegs + 1];
            const ex = a.x + (b.x - a.x) * frac;
            const ey = a.y + (b.y - a.y) * frac;
            ctx.strokeStyle = 'rgba(245, 250, 255, 0.85)';
            ctx.lineWidth = Math.max(0.5, path.baseW * taper * 0.7);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }

          if (path.branch && grow > 0.42) {
            const bGrow = (grow - 0.42) / 0.58;
            const bp = path.branch;
            const bMax = Math.floor(bGrow * (bp.length - 1));
            for (let k = 0; k < bMax; k++) {
              ctx.strokeStyle = 'rgba(11, 29, 58, 0.68)';
              ctx.lineWidth = Math.max(0.6, path.baseW * 0.45);
              ctx.beginPath();
              ctx.moveTo(bp[k].x, bp[k].y);
              ctx.lineTo(bp[k + 1].x, bp[k + 1].y);
              ctx.stroke();

              ctx.strokeStyle = 'rgba(220, 238, 255, 0.82)';
              ctx.lineWidth = Math.max(0.45, path.baseW * 0.3);
              ctx.beginPath();
              ctx.moveTo(bp[k].x + 0.4, bp[k].y - 0.4);
              ctx.lineTo(bp[k + 1].x + 0.4, bp[k + 1].y - 0.4);
              ctx.stroke();
            }
          }
        }
      }
      return dirty;
    }

    return { canvas: c, registerHit, redraw };
  }

  async function createIceWallGate3D(opts) {
    const stage = opts.stage;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const onReady = typeof opts.onReady === 'function' ? opts.onReady : function () {};
    const onHitProgress = typeof opts.onHitProgress === 'function' ? opts.onHitProgress : function () {};
    const onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : function () {};
    const playSound = typeof opts.playSound === 'function' ? opts.playSound : function () {};

    const isMobile = window.innerWidth < 768 || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
    const reduceMotion = Boolean(opts.reducedMotion);

    onProgress(0.08);

    const [THREE, { GLTFLoader }, { DRACOLoader }, { RGBELoader }] = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/loaders/RGBELoader.js')
    ]);

    onProgress(0.28);

    const width = stage.clientWidth || window.innerWidth;
    const height = stage.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      powerPreference: 'high-performance',
      alpha: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    if ('transmissionResolutionScale' in renderer) {
      renderer.transmissionResolutionScale = isMobile ? 0.25 : 0.35;
    }
    renderer.domElement.style.opacity = '0';
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#091224');
    scene.fog = new THREE.FogExp2('#101d35', 0.028);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 140);
    const baseCamPos = new THREE.Vector3(0, 0.22, 6.45);
    const updateCameraFraming = (w, h) => {
      const aspect = Math.max(0.45, w / Math.max(1, h));
      camera.aspect = aspect;
      camera.fov = aspect < 1 ? 54 : (aspect > 1.85 ? 42 : 45);
      const dist = aspect < 0.75 ? 7.65 : (aspect < 1.1 ? 6.95 : 6.45);
      baseCamPos.set(0, 0.22, dist);
      camera.position.copy(baseCamPos);
      camera.lookAt(0, -0.04, 0);
      camera.updateProjectionMatrix();
    };
    updateCameraFraming(width, height);

    const disposables = { geometries: [], materials: [], textures: [], renderTargets: [] };
    const trackGeo = g => { disposables.geometries.push(g); return g; };
    const trackMat = m => { disposables.materials.push(m); return m; };
    const trackTex = t => { disposables.textures.push(t); return t; };

    // -----------------------------------------------------------------------
    // 1. Lighting & Non-Blocking HDRI
    // -----------------------------------------------------------------------
    scene.add(new THREE.HemisphereLight('#dceeff', '#101d35', 0.92));

    const keyLight = new THREE.DirectionalLight('#f0f8ff', 2.4);
    keyLight.position.set(-4.4, 3.8, 5.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(isMobile ? 512 : 1024, isMobile ? 512 : 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.camera.left = -4.5;
    keyLight.shadow.camera.right = 4.5;
    keyLight.shadow.camera.top = 3.5;
    keyLight.shadow.camera.bottom = -3.5;
    keyLight.shadow.bias = -0.0008;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#b9ddf5', 2.15);
    rimLight.position.set(5.2, 4.2, -1.5);
    scene.add(rimLight);

    const portalLight = new THREE.PointLight('#fff6e2', 40, 18, 1.3);
    portalLight.position.set(0, 0.02, -2.0);
    scene.add(portalLight);

    const snowBounce = new THREE.DirectionalLight('#b9ddf5', 0.72);
    snowBounce.position.set(0.8, -3.5, 4.2);
    scene.add(snowBounce);

    // -----------------------------------------------------------------------
    // 2. Background: Midnight Navy Sky, Mountains, Aurora & Warm Portal Halo
    // -----------------------------------------------------------------------
    const skyGeo = trackGeo(new THREE.SphereGeometry(64, 24, 16));
    const skyMat = trackMat(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uTop: { value: new THREE.Color('#070e1d') },
        uMid: { value: new THREE.Color('#101d35') },
        uHorizon: { value: new THREE.Color('#1d3a62') },
        uAuroraA: { value: new THREE.Color('#2a6636') },
        uAuroraB: { value: new THREE.Color('#b9ddf5') }
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vPos;
        uniform float uTime;
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uAuroraA;
        uniform vec3 uAuroraB;
        void main() {
          vec3 d = normalize(vPos);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uHorizon, uMid, smoothstep(0.45, 0.65, h));
          col = mix(col, uTop, smoothstep(0.64, 0.92, h));
          float band = exp(-pow((d.y - 0.24) * 5.0, 2.0));
          float wave = sin(d.x * 5.0 + uTime * 0.28) * 0.5 + 0.5;
          float wave2 = cos(d.x * 8.5 - uTime * 0.20) * 0.5 + 0.5;
          vec3 aur = mix(uAuroraA, uAuroraB, wave2) * (0.22 + 0.26 * wave) * band;
          gl_FragColor = vec4(col + aur, 1.0);
        }
      `
    }));
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    const starRng = seededRand(1337);
    const starCount = isMobile ? 110 : 220;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = starRng() * Math.PI * 2;
      const phi = 0.18 + starRng() * 0.95;
      const rad = 46;
      starPos[i * 3] = Math.cos(theta) * Math.sin(phi) * rad;
      starPos[i * 3 + 1] = Math.cos(phi) * rad * 0.65 + 5.5;
      starPos[i * 3 + 2] = -Math.abs(Math.sin(theta) * Math.sin(phi) * rad) - 10;
    }
    const starGeo = trackGeo(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, trackMat(new THREE.PointsMaterial({
      color: '#f5faff',
      size: 0.2,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    }))));

    // Distant jagged arctic mountains
    const mtRangeGeo = trackGeo(new THREE.BufferGeometry());
    const mtVerts = [];
    const mtCols = [];
    const mtSegs = 64;
    const mtW = 46;
    const mtRng = seededRand(901);
    const mtDark = new THREE.Color('#0c172b');
    const mtSlate = new THREE.Color('#193259');
    const mtSnow = new THREE.Color('#9ec7e8');
    const mtTmp = new THREE.Color();
    const baseLine = -2.2;
    const ridgeH = [];
    for (let i = 0; i <= mtSegs; i++) {
      const rx = -mtW * 0.5 + (i / mtSegs) * mtW;
      const macro = Math.sin(rx * 0.28 + 0.5) * 1.45 + Math.cos(rx * 0.53 - 0.8) * 0.95;
      const crag = Math.abs(Math.sin(rx * 1.35 + mtRng() * 0.4)) * 0.85;
      const valley = 1.0 - 0.36 * Math.exp(-(rx * rx) / 16.0);
      const ry = (1.65 + (macro + crag) * 0.72) * valley;
      ridgeH.push([rx, ry]);
    }
    for (let i = 0; i < mtSegs; i++) {
      const [x0, y0] = ridgeH[i];
      const [x1, y1] = ridgeH[i + 1];
      mtVerts.push(x0, baseLine, -19, x1, baseLine, -19, x0, y0, -19);
      mtVerts.push(x1, baseLine, -19, x1, y1, -19, x0, y0, -19);
      const pushCol = yVal => {
        const t = Math.max(0, Math.min(1, (yVal - 0.4) / 2.9));
        mtTmp.copy(mtDark).lerp(mtSlate, Math.min(1, t * 1.4));
        if (t > 0.62) mtTmp.lerp(mtSnow, (t - 0.62) * 2.0);
        mtCols.push(mtTmp.r, mtTmp.g, mtTmp.b);
      };
      pushCol(baseLine); pushCol(baseLine); pushCol(y0);
      pushCol(baseLine); pushCol(y1); pushCol(y0);
    }
    mtRangeGeo.setAttribute('position', new THREE.Float32BufferAttribute(mtVerts, 3));
    mtRangeGeo.setAttribute('color', new THREE.Float32BufferAttribute(mtCols, 3));
    mtRangeGeo.computeVertexNormals();
    scene.add(new THREE.Mesh(mtRangeGeo, trackMat(new THREE.MeshBasicMaterial({ vertexColors: true }))));

    const portalTex = trackTex(makeRadialSpriteTexture(THREE, 'rgba(255,250,236,0.98)', 'rgba(185,221,245,0.52)', 'rgba(42,102,54,0)'));
    const portalMat = trackMat(new THREE.SpriteMaterial({
      map: portalTex,
      color: '#fff6e4',
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    const portalSprite = new THREE.Sprite(portalMat);
    portalSprite.position.set(0, -0.05, -2.15);
    portalSprite.scale.set(6.8, 4.8, 1);
    scene.add(portalSprite);

    // Portal breach flash overlay sprite (blooms cleanly on Hits 4-5)
    const flashMat = trackMat(new THREE.SpriteMaterial({
      map: portalTex,
      color: '#ffffff',
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    const flashSprite = new THREE.Sprite(flashMat);
    flashSprite.position.set(0, -0.1, 0.8);
    flashSprite.scale.set(8.5, 5.5, 1);
    scene.add(flashSprite);

    // -----------------------------------------------------------------------
    // 3. Assets + Deferred HDRI + Lazy cannon-es Physics Import
    // -----------------------------------------------------------------------
    const texDir = '/static/textures/ice/1k';
    const texLoader = new THREE.TextureLoader();
    const rgbeLoader = new RGBELoader();
    const gltfLoader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(THREE_DRACO_PATH);
    gltfLoader.setDRACOLoader(dracoLoader);

    const loadTex = (url, isColor, repX = 2.6, repY = 1.6) => new Promise((resolve, reject) => {
      texLoader.load(url, t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repX, repY);
        t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        trackTex(t);
        resolve(t);
      }, undefined, reject);
    });

    let loadedSteps = 0;
    const totalSteps = isMobile ? 3 : 4;
    const stepDone = () => {
      loadedSteps++;
      onProgress(0.28 + (loadedSteps / totalSteps) * 0.68);
    };

    let disposed = false;
    let hdriLoaded = false;
    function loadHdriAsync() {
      if (disposed || hdriLoaded) return;
      hdriLoaded = true;
      const pmrem = new THREE.PMREMGenerator(renderer);
      rgbeLoader.load(HDRI_PATH, hdr => {
        if (disposed) { hdr.dispose(); pmrem.dispose(); return; }
        setTimeout(() => {
          if (disposed) { hdr.dispose(); pmrem.dispose(); return; }
          const rt = pmrem.fromEquirectangular(hdr);
          hdr.dispose();
          pmrem.dispose();
          disposables.renderTargets.push(rt);
          scene.environment = rt.texture;
          scene.environmentIntensity = 0.72;
        }, 50);
      }, undefined, () => { pmrem.dispose(); });
    }

    // Warm cannon-es in background once user begins interacting (or right after first frame)
    let cannonPromise = null;
    function ensureCannon() {
      if (!cannonPromise) {
        cannonPromise = import(CANNON_CDN_URL).catch(err => {
          console.warn('cannon-es CDN unavailable, using kinematic shard physics:', err);
          return null;
        });
      }
      return cannonPromise;
    }

    const [iceColor, iceNormal, iceRoughness, hammerGltf] = await Promise.all([
      loadTex(`${texDir}/ice_color.webp`, true).catch(() => null).then(v => { stepDone(); return v; }),
      loadTex(`${texDir}/ice_normal.webp`, false).catch(() => null).then(v => { stepDone(); return v; }),
      isMobile ? Promise.resolve(null) : loadTex(`${texDir}/ice_roughness.webp`, false).catch(() => null).then(v => { stepDone(); return v; }),
      new Promise((resolve, reject) => {
        gltfLoader.load(HAMMER_GLB_PATH, gltf => { stepDone(); resolve(gltf); }, undefined, reject);
      })
    ]);

    // -----------------------------------------------------------------------
    // 4. Sculpted Glacier Wall + Fracture Crack Mask + Pre-Fractured Voronoi Shards
    // -----------------------------------------------------------------------
    const wallGroup = new THREE.Group();
    scene.add(wallGroup);

    const iceWallMat = trackMat(new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e2f2ff'),
      map: iceColor,
      normalMap: iceNormal,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: iceRoughness,
      roughness: 0.22,
      metalness: 0.0,
      transmission: isMobile ? 0.50 : 0.72,
      thickness: 1.05,
      ior: 1.31,
      attenuationColor: new THREE.Color('#69b9f0'),
      attenuationDistance: 1.85,
      clearcoat: 0.88,
      clearcoatRoughness: 0.16,
      emissive: new THREE.Color('#134173'),
      emissiveIntensity: 0.24,
      vertexColors: true,
      envMapIntensity: 0.95
    }));

    const wallRng = seededRand(2026);
    const segW = isMobile ? 22 : 32;
    const segH = isMobile ? 12 : 18;
    const coreGeo = trackGeo(sculptGlacierWallGeometry(THREE, WALL_W, WALL_H, 1.02, segW, segH, 2, 0, WALL_CENTER_Y, wallRng, true));
    const coreWall = new THREE.Mesh(coreGeo, iceWallMat);
    coreWall.position.set(0, WALL_CENTER_Y, 0);
    coreWall.receiveShadow = true;
    coreWall.castShadow = false;
    coreWall.name = 'GlacierWallCore';
    wallGroup.add(coreWall);

    // Animated radial crack plane decal right in front of the core wall surface
    const fractureOverlay = createFractureOverlayCanvas();
    const crackTex = trackTex(new THREE.CanvasTexture(fractureOverlay.canvas));
    crackTex.colorSpace = THREE.SRGBColorSpace;
    const crackMat = trackMat(new THREE.MeshBasicMaterial({
      map: crackTex,
      transparent: true,
      opacity: 0.96,
      depthWrite: false
    }));
    const crackMesh = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(WALL_W * 0.96, WALL_H * 0.96)), crackMat);
    crackMesh.position.set(0, WALL_CENTER_Y, 0.62);
    wallGroup.add(crackMesh);

    // Detached & sagging Voronoi glacier sections (shown progressively on Hits 3 & 4, shattered on Hit 5)
    const voronoiTargetCount = isMobile ? 56 : 124; // Strictly capped: <=60 mobile, 80-150 desktop
    const voronoiCells = generateVoronoiCells(voronoiTargetCount, WALL_W * 0.48, WALL_H * 0.48, wallRng);
    const shardMat = trackMat(new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8ec8f2'),
      map: iceColor,
      normalMap: iceNormal,
      roughness: 0.24,
      metalness: 0.08,
      emissive: new THREE.Color('#134173'),
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 1.0
    }));

    const shardMeshes = [];
    const sagBlocks = [];
    const shardGroup = new THREE.Group();
    shardGroup.position.set(0, WALL_CENTER_Y, 0);
    wallGroup.add(shardGroup);

    voronoiCells.forEach((cell, idx) => {
      const shape = new THREE.Shape();
      shape.moveTo(cell.verts[0][0], cell.verts[0][1]);
      for (let v = 1; v < cell.verts.length; v++) {
        shape.lineTo(cell.verts[v][0], cell.verts[v][1]);
      }
      shape.closePath();

      const extrudeGeo = trackGeo(new THREE.ExtrudeGeometry(shape, {
        depth: cell.depth,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.02,
        bevelSegments: 1,
        steps: 1
      }));
      extrudeGeo.translate(0, 0, -cell.depth * 0.5);

      const m = new THREE.Mesh(extrudeGeo, shardMat);
      m.position.set(cell.cx, cell.cy, 0);
      m.visible = false;
      shardGroup.add(m);

      const entry = {
        mesh: m,
        cell,
        homeX: cell.cx,
        homeY: cell.cy,
        targetOffset: new THREE.Vector3(0, 0, 0),
        targetRot: new THREE.Euler(0, 0, 0),
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        body: null
      };
      shardMeshes.push(entry);

      // Select central & mid-zone chunks that visibly crack loose on Hits 3 & 4
      if (sagBlocks.length < 12 && Math.hypot(cell.cx, cell.cy) < 2.25 && idx % 3 === 0) {
        sagBlocks.push(entry);
      }
    });

    // Portal light gap beams revealed behind breaking sections on Hits 3-4
    const beamMat = trackMat(new THREE.SpriteMaterial({
      map: portalTex,
      color: '#fff6de',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    const beamSprites = [];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Sprite(beamMat);
      b.position.set((i - 1.5) * 1.15, WALL_CENTER_Y + (i % 2 ? 0.28 : -0.18), 0.72);
      b.scale.set(1.6, 2.5, 1);
      wallGroup.add(b);
      beamSprites.push(b);
    }

    // Internal Fracture Planes + Trapped Air Bubbles
    const fracMat = trackMat(new THREE.MeshBasicMaterial({
      color: '#e8f5ff',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    }));
    for (let i = 0; i < (isMobile ? 10 : 18); i++) {
      const fGeo = trackGeo(new THREE.PlaneGeometry(0.45 + wallRng() * 0.7, 0.38 + wallRng() * 0.65));
      const fMesh = new THREE.Mesh(fGeo, fracMat);
      fMesh.position.set((wallRng() - 0.5) * 6.2, -0.45 + (wallRng() - 0.5) * 1.9, (wallRng() - 0.5) * 0.40);
      fMesh.rotation.set((wallRng() - 0.5) * 1.1, (wallRng() - 0.5) * 1.2, wallRng() * Math.PI);
      wallGroup.add(fMesh);
    }

    const bubbleCount = isMobile ? 80 : 170;
    const bubbleGeo = trackGeo(new THREE.SphereGeometry(0.02, 8, 8));
    const bubbleMat = trackMat(new THREE.MeshBasicMaterial({ color: '#f5faff', transparent: true, opacity: 0.56, depthWrite: false }));
    const bubblesInst = new THREE.InstancedMesh(bubbleGeo, bubbleMat, bubbleCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < bubbleCount; i++) {
      dummy.position.set((wallRng() - 0.5) * 6.4, -0.4 + (wallRng() - 0.5) * 2.2, (wallRng() - 0.5) * 0.54);
      const sx = 0.45 + wallRng() * 1.05;
      dummy.scale.set(sx, sx * (1.3 + wallRng() * 1.9), sx);
      dummy.updateMatrix();
      bubblesInst.setMatrixAt(i, dummy.matrix);
    }
    wallGroup.add(bubblesInst);

    // Arctic snow floor + Frost Drifts
    const snowFloor = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(18, 10)),
      trackMat(new THREE.MeshStandardMaterial({ color: '#dceeff', map: iceColor, normalMap: iceNormal, roughness: 0.86, metalness: 0.02 }))
    );
    snowFloor.rotation.x = -Math.PI * 0.5;
    snowFloor.position.set(0, -1.96, 1.2);
    snowFloor.receiveShadow = true;
    wallGroup.add(snowFloor);

    const frostMat = trackMat(new THREE.MeshStandardMaterial({ color: '#eef6ff', map: iceColor, normalMap: iceNormal, roughness: 0.82, metalness: 0.02 }));
    for (let i = 0; i < 15; i++) {
      const sx = -4.9 + i * 0.7 + (wallRng() - 0.5) * 0.2;
      const mound = new THREE.Mesh(trackGeo(new THREE.DodecahedronGeometry(0.54 + wallRng() * 0.42, 1)), frostMat);
      mound.position.set(sx, -1.92 + wallRng() * 0.14, 0.46 + wallRng() * 0.25);
      mound.scale.set(1.5, 0.46, 0.92);
      mound.receiveShadow = true;
      wallGroup.add(mound);
    }

    // -----------------------------------------------------------------------
    // 5. Flying Impact Chips + Volumetric Cold Mist + Snow Flurries
    // -----------------------------------------------------------------------
    const mistTex = trackTex(makeRadialSpriteTexture(THREE, 'rgba(220,238,255,0.36)', 'rgba(185,221,245,0.12)'));
    const mistMat = trackMat(new THREE.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0.34, depthWrite: false }));
    const mistSprites = [];
    const mistCount = isMobile ? 6 : 12;
    for (let i = 0; i < mistCount; i++) {
      const sp = new THREE.Sprite(mistMat);
      const bx = -3.8 + (i / Math.max(1, mistCount - 1)) * 7.6;
      sp.position.set(bx, -1.55 + wallRng() * 0.55, 0.85 + wallRng() * 0.75);
      const sc = 2.4 + wallRng() * 1.6;
      sp.scale.set(sc * 1.5, sc * 0.75, 1);
      scene.add(sp);
      mistSprites.push({ sp, baseX: bx, phase: wallRng() * 6.28, speed: 0.16 + wallRng() * 0.18 });
    }

    const snowCount = reduceMotion ? 0 : (isMobile ? 65 : 150);
    const snowPositions = new Float32Array(snowCount * 3);
    const snowSpeeds = new Float32Array(snowCount);
    for (let i = 0; i < snowCount; i++) {
      snowPositions[i * 3] = (wallRng() - 0.5) * 9.8;
      snowPositions[i * 3 + 1] = (wallRng() - 0.5) * 6.0;
      snowPositions[i * 3 + 2] = 0.85 + wallRng() * 2.8;
      snowSpeeds[i] = 0.35 + wallRng() * 0.55;
    }
    const snowGeo = trackGeo(new THREE.BufferGeometry());
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
    const snowTex = trackTex(makeRadialSpriteTexture(THREE, 'rgba(245,250,255,0.96)', 'rgba(220,238,255,0.35)'));
    scene.add(new THREE.Points(snowGeo, trackMat(new THREE.PointsMaterial({ map: snowTex, size: 0.08, transparent: true, opacity: 0.78, depthWrite: false }))));

    // Surface ice chip & snow dust emitter pool for impacts 1..5
    const chipPool = [];
    const chipGeo = trackGeo(new THREE.OctahedronGeometry(0.06, 0));
    const chipMat = trackMat(new THREE.MeshStandardMaterial({ color: '#e8f5ff', roughness: 0.25, metalness: 0.05 }));
    const dustGroup = new THREE.Group();
    scene.add(dustGroup);

    function spawnImpactBurst(hitPoint, hitLevel) {
      const chipTotal = hitLevel === 5 ? 34 : 10 + hitLevel * 4;
      for (let i = 0; i < chipTotal; i++) {
        const m = new THREE.Mesh(chipGeo, chipMat);
        m.position.set(hitPoint.x, hitPoint.y, hitPoint.z + 0.1);
        m.scale.setScalar(0.55 + Math.random() * 1.15);
        dustGroup.add(m);
        const ang = Math.random() * Math.PI * 2;
        const speed = 1.8 + Math.random() * (3.2 + hitLevel * 0.7);
        chipPool.push({
          mesh: m,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed * 0.8 + 1.4,
          vz: 1.6 + Math.random() * 3.2,
          rx: (Math.random() - 0.5) * 14,
          ry: (Math.random() - 0.5) * 14,
          life: 1.0
        });
      }
      // Snow dust puffs
      for (let i = 0; i < 8 + hitLevel * 3; i++) {
        const sp = new THREE.Sprite(trackMat(new THREE.SpriteMaterial({
          map: mistTex,
          color: '#f5faff',
          transparent: true,
          opacity: 0.65,
          depthWrite: false
        })));
        sp.position.set(hitPoint.x + (Math.random() - 0.5) * 0.4, hitPoint.y + (Math.random() - 0.5) * 0.4, hitPoint.z + 0.25);
        sp.scale.setScalar(0.55 + Math.random() * 0.7);
        dustGroup.add(sp);
        chipPool.push({
          mesh: sp,
          isDust: true,
          vx: (Math.random() - 0.5) * 1.6,
          vy: -0.25 + Math.random() * 0.8,
          vz: 0.4 + Math.random() * 0.9,
          rx: 0,
          ry: 0,
          life: 1.15
        });
      }
    }

    // -----------------------------------------------------------------------
    // 6. 3D Norse War Hammer Cursor + Swing & Impact State Machine
    // -----------------------------------------------------------------------
    const hammerRig = new THREE.Group();
    const hammerRoot = hammerGltf.scene;
    hammerRoot.traverse(obj => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = false;
        if (obj.geometry) disposables.geometries.push(obj.geometry);
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => {
            m.envMapIntensity = 1.45;
            disposables.materials.push(m);
            ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'].forEach(k => {
              if (m[k]) disposables.textures.push(m[k]);
            });
          });
        }
      }
    });

    hammerRoot.scale.setScalar(1.52);
    hammerRoot.position.set(0.22, -0.02, 0.04);
    hammerRoot.rotation.set(0.18, 0.56, -0.34);
    hammerRig.add(hammerRoot);
    hammerRig.position.set(0.5, -0.15, 1.42);
    scene.add(hammerRig);

    const hammerRim = new THREE.PointLight('#dceeff', 1.8, 3.4, 2);
    hammerRim.position.set(0.35, 0.45, 0.85);
    hammerRig.add(hammerRim);

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2(0.14, -0.06);
    const hoverPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.42);
    const targetHover = new THREE.Vector3(0.5, -0.15, 1.42);
    const prevHover = new THREE.Vector3(0.5, -0.15, 1.42);
    const velocity = new THREE.Vector2(0, 0);

    function setPointerFromClient(clientX, clientY) {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hitPt = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(hoverPlane, hitPt)) {
        targetHover.copy(hitPt);
      }
    }

    const onPointerMove = e => {
      if (e.pointerType === 'touch') return;
      setPointerFromClient(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const onResize = () => {
      if (disposed) return;
      const w = stage.clientWidth || window.innerWidth;
      const h = stage.clientHeight || window.innerHeight;
      renderer.setSize(w, h);
      updateCameraFraming(w, h);
    };
    window.addEventListener('resize', onResize);

    // Hit State Machine & Physics World
    let hits = 0;
    let lockUntil = 0;
    let freezeUntil = 0;
    let shakePower = 0;
    let flickerEnd = 0;
    let crackDirty = false;
    let activeSwing = null; // { startPos, hitPoint, hitUV, hitLevel, t, fromBottom, impacted }
    let shatterState = null; // { world, startTime, phase, flash }
    let physicsWorld = null;

    async function activateVoronoiShatter(impactPt) {
      coreWall.visible = false;
      crackMesh.visible = false;
      bubblesInst.visible = false;
      sagBlocks.forEach(s => { s.mesh.visible = true; });

      const CANNON = await ensureCannon();
      if (disposed) return;

      if (CANNON) {
        physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -11.5, 0) });
        const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
        groundBody.quaternion.setFromEuler(-Math.PI * 0.5, 0, 0);
        groundBody.position.set(0, -1.96 - WALL_CENTER_Y, 0);
        physicsWorld.addBody(groundBody);
      }

      shardMeshes.forEach((entry, idx) => {
        entry.mesh.visible = true;
        const dx = entry.mesh.position.x - impactPt.x;
        const dy = entry.mesh.position.y - (impactPt.y - WALL_CENTER_Y);
        const dist = Math.max(0.28, Math.hypot(dx, dy));
        const blast = Math.max(2.6, 12.2 / (0.65 + dist));
        const dirX = dx / dist + (Math.random() - 0.5) * 0.4;
        const dirY = dy / dist + 0.42 + (Math.random() - 0.5) * 0.35;
        // Blast some Voronoi chunks outward toward camera (+Z) and others away (-Z) for dramatic 3D shatter depth
        const zSign = idx % 3 === 0 ? 1.0 : -0.75;
        const dirZ = zSign * (0.55 + Math.random() * 0.75);

        if (CANNON && physicsWorld) {
          const halfExt = Math.max(0.12, entry.cell.radius * 0.65);
          const body = new CANNON.Body({
            mass: Math.max(0.6, entry.cell.radius * 4.5),
            shape: new CANNON.Box(new CANNON.Vec3(halfExt, halfExt, entry.cell.depth * 0.35)),
            position: new CANNON.Vec3(entry.mesh.position.x, entry.mesh.position.y, entry.mesh.position.z)
          });
          body.velocity.set(dirX * blast, dirY * blast * 0.85, dirZ * blast * 0.72);
          body.angularVelocity.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
          physicsWorld.addBody(body);
          entry.body = body;
        } else {
          entry.vx = dirX * blast;
          entry.vy = dirY * blast * 0.85;
          entry.vz = dirZ * blast * 0.72;
          entry.rx = (Math.random() - 0.5) * 9;
          entry.ry = (Math.random() - 0.5) * 9;
          entry.rz = (Math.random() - 0.5) * 9;
        }
      });

      shatterState = {
        startTime: performance.now(),
        camStartPos: camera.position.clone()
      };

      setTimeout(() => {
        if (!disposed) onComplete('shatter');
      }, reduceMotion ? 350 : 1850);
    }

    function applyHitImpact(swing) {
      const level = swing.hitLevel;
      const now = performance.now();

      if (!reduceMotion) {
        freezeUntil = now + 60; // 60ms impact hitstop freeze frame
        shakePower = 0.055 + level * 0.042;
      }

      if (swing.hitUV) {
        // Scale crack progression cleanly across 3 hits (1 -> branching star, 2 -> deep wide fractures)
        const crackScale = level === 1 ? 2 : (level === 2 ? 4 : 5);
        fractureOverlay.registerHit(swing.hitUV.x, swing.hitUV.y, crackScale, wallRng);
        fractureOverlay.redraw(now);
        crackTex.needsUpdate = true;
        crackDirty = true;
      }

      spawnImpactBurst(swing.hitPoint, level === 3 ? 5 : level * 2);
      playSound(level);
      onHitProgress(level);

      if (level === 1) {
        flickerEnd = now + 450;
      } else if (level === 2) {
        flickerEnd = now + 850;
        // Heavy breakage on Hit 2: pre-fractured Voronoi sections shift & drop while portal light beams stream through
        sagBlocks.forEach((blk, idx) => {
          blk.mesh.visible = true;
          blk.targetOffset.set((idx % 2 ? 0.10 : -0.09), -0.18 - (idx % 4) * 0.05, 0.14 + (idx % 3) * 0.04);
          blk.targetRot.set(0.14 + (idx % 3) * 0.04, (idx % 2 ? -0.11 : 0.11), (idx % 2 ? -0.07 : 0.07));
        });
      } else if (level >= 3) {
        flashMat.opacity = 0.62;
        activateVoronoiShatter(swing.hitPoint);
      }
    }

    function triggerHit(clientX, clientY, options = {}) {
      if (disposed || shatterState) return false;
      const now = performance.now();
      if (now < lockUntil) return false;

      const isTouch = options.pointerType === 'touch';
      const isKeyboard = Boolean(options.keyboard);

      let ndcX = 0;
      let ndcY = -0.05;
      if (!isKeyboard && typeof clientX === 'number' && typeof clientY === 'number') {
        const rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
        setPointerFromClient(clientX, clientY);
      } else {
        const offsets = [[-0.14, 0.04], [0.14, -0.06], [0, -0.04]];
        const pick = offsets[Math.min(2, hits)];
        ndcX = pick[0];
        ndcY = pick[1];
      }

      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const intersects = raycaster.intersectObject(coreWall, false);
      if (!intersects.length) return false; // Count ONLY when click lands on the wall!

      const hit = intersects[0];
      hits = Math.min(3, hits + 1);
      lockUntil = hits >= 3 ? now + 5000 : now + (reduceMotion ? 160 : 440);

      // Start pre-loading cannon-es silently on Hit 1 so Hit 3 shatter has zero wait
      if (hits === 1) ensureCannon();

      const startPos = isTouch
        ? new THREE.Vector3(hit.point.x + 1.15, -1.95, 1.85)
        : hammerRig.position.clone();

      activeSwing = {
        startPos,
        hitPoint: hit.point.clone(),
        hitUV: hit.uv ? hit.uv.clone() : new THREE.Vector2(0.5, 0.5),
        hitLevel: hits,
        elapsed: 0,
        duration: reduceMotion ? 0.05 : 0.30, // ~300ms wind-up + swing
        fromBottom: isTouch,
        impacted: false
      };

      if (isTouch) {
        hammerRig.position.copy(startPos);
      }
      return true;
    }

    // -----------------------------------------------------------------------
    // 7. Render & Animation Loop
    // -----------------------------------------------------------------------
    let rafId = 0;
    let lastTime = performance.now();
    const startTime = lastTime;

    function animate(now) {
      if (disposed) return;

      if (now < freezeUntil) {
        // Maintain 60ms impact hitstop freeze frame right on collision
        renderer.render(scene, camera);
        rafId = requestAnimationFrame(animate);
        return;
      }

      const rawDt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
      lastTime = now;
      const t = reduceMotion ? 0 : (now - startTime) * 0.001;

      skyMat.uniforms.uTime.value = t;

      // Progressive crack animation (400ms growth from exact impact UV)
      if (crackDirty) {
        crackDirty = fractureOverlay.redraw(now);
        crackTex.needsUpdate = true;
      }

      // Portal glow intensity & inner light flicker / gap beams across 3 hits
      let flickerBoost = 0;
      if (now < flickerEnd) {
        flickerBoost = (Math.sin(now * 0.055) * 0.5 + 0.5) * 26;
      }
      const gapBoost = hits >= 2 ? 22 : (hits >= 1 ? 8 : 0);
      portalLight.intensity = 40 + gapBoost + flickerBoost + Math.sin(t * 1.8) * 3.5;
      portalSprite.material.opacity = Math.min(1.0, 0.84 + hits * 0.06 + (flickerBoost > 0 ? 0.1 : 0));
      iceWallMat.emissiveIntensity = 0.24 + (flickerBoost > 0 ? 0.18 : 0) + (hits >= 2 ? 0.16 : 0);

      beamMat.opacity = hits >= 2 ? (0.42 + Math.sin(t * 4) * 0.08) : 0;

      // Update shifted/sagging pre-fractured chunks (Hit 2)
      if (!shatterState && hits >= 2) {
        for (let i = 0; i < sagBlocks.length; i++) {
          const blk = sagBlocks[i];
          if (!blk.mesh.visible) continue;
          const tx = blk.homeX + blk.targetOffset.x;
          const ty = blk.homeY + blk.targetOffset.y;
          const tz = blk.targetOffset.z;
          blk.mesh.position.lerp(new THREE.Vector3(tx, ty, tz), 1 - Math.exp(-9 * rawDt));
          blk.mesh.rotation.x += (blk.targetRot.x - blk.mesh.rotation.x) * Math.min(1, 9 * rawDt);
          blk.mesh.rotation.y += (blk.targetRot.y - blk.mesh.rotation.y) * Math.min(1, 9 * rawDt);
          blk.mesh.rotation.z += (blk.targetRot.z - blk.mesh.rotation.z) * Math.min(1, 9 * rawDt);
        }
      }

      // Hit 5: Slow-motion shatter (timeScale 0.3 for ~1.0s, then accelerate) + camera push-through
      if (shatterState) {
        const elapsedS = (now - shatterState.startTime) * 0.001;
        const timeScale = reduceMotion ? 1.0 : (elapsedS < 1.0 ? 0.3 : Math.min(1.3, 0.3 + (elapsedS - 1.0) * 1.4));
        const physDt = rawDt * timeScale;

        if (physicsWorld) {
          physicsWorld.step(1 / 60, physDt, 3);
          for (let i = 0; i < shardMeshes.length; i++) {
            const s = shardMeshes[i];
            if (s.body) {
              s.mesh.position.set(s.body.position.x, s.body.position.y, s.body.position.z);
              s.mesh.quaternion.set(s.body.quaternion.x, s.body.quaternion.y, s.body.quaternion.z, s.body.quaternion.w);
            }
          }
        } else {
          for (let i = 0; i < shardMeshes.length; i++) {
            const s = shardMeshes[i];
            s.vy -= 11.5 * physDt;
            s.mesh.position.x += s.vx * physDt;
            s.mesh.position.y += s.vy * physDt;
            s.mesh.position.z += s.vz * physDt;
            s.mesh.rotation.x += s.rx * physDt;
            s.mesh.rotation.y += s.ry * physDt;
            s.mesh.rotation.z += s.rz * physDt;
          }
        }

        shardMat.opacity = Math.max(0.0, 1.0 - Math.max(0, (elapsedS - 0.9) / 1.3));
        flashMat.opacity = Math.max(0, flashMat.opacity - rawDt * 1.25);

        // Camera pushes smoothly through shattered opening toward glowing PGI portal
        if (!reduceMotion) {
          const pushU = Math.min(1, Math.max(0, (elapsedS - 0.35) / 1.25));
          const easePush = pushU * pushU * (3 - 2 * pushU);
          baseCamPos.z = THREE.MathUtils.lerp(shatterState.camStartPos.z, -1.2, easePush);
          portalSprite.scale.setScalar(6.8 + easePush * 7.5);
        }
        hammerRig.visible = false;
      }

      // Update flying impact chips & snow dust
      for (let i = chipPool.length - 1; i >= 0; i--) {
        const c = chipPool[i];
        c.life -= rawDt * (c.isDust ? 0.95 : 1.1);
        if (c.life <= 0) {
          dustGroup.remove(c.mesh);
          chipPool.splice(i, 1);
          continue;
        }
        if (!c.isDust) c.vy -= 9.8 * rawDt;
        c.mesh.position.x += c.vx * rawDt;
        c.mesh.position.y += c.vy * rawDt;
        c.mesh.position.z += c.vz * rawDt;
        if (c.isDust) {
          c.mesh.material.opacity = Math.max(0, c.life * 0.55);
          c.mesh.scale.addScalar(rawDt * 0.55);
        } else {
          c.mesh.rotation.x += c.rx * rawDt;
          c.mesh.rotation.y += c.ry * rawDt;
          c.mesh.scale.setScalar(Math.max(0.05, c.mesh.scale.x * (1 - rawDt * 0.3)));
        }
      }

      // Mist & Snow
      for (let i = 0; i < mistSprites.length; i++) {
        const m = mistSprites[i];
        m.sp.position.x = m.baseX + Math.sin(t * m.speed + m.phase) * 0.45;
      }
      if (snowCount > 0) {
        const arr = snowGeo.attributes.position.array;
        for (let i = 0; i < snowCount; i++) {
          arr[i * 3 + 1] -= snowSpeeds[i] * rawDt;
          arr[i * 3] += Math.sin(t * 0.9 + i) * 0.12 * rawDt;
          if (arr[i * 3 + 1] < -3.0) arr[i * 3 + 1] = 3.0;
        }
        snowGeo.attributes.position.needsUpdate = true;
      }

      // Hammer Wind-Up / Swing / Follow Loop
      if (activeSwing) {
        activeSwing.elapsed += rawDt;
        const p = Math.min(1, activeSwing.elapsed / activeSwing.duration);
        const strikeZ = activeSwing.hitPoint.z + 0.56;

        if (p < 0.42) {
          // Ease-out wind-up back & high
          const wu = p / 0.42;
          const easeOut = 1 - (1 - wu) * (1 - wu);
          hammerRig.position.set(
            THREE.MathUtils.lerp(activeSwing.startPos.x, activeSwing.hitPoint.x + 0.25, easeOut * 0.5),
            THREE.MathUtils.lerp(activeSwing.startPos.y, activeSwing.hitPoint.y + 0.36, easeOut),
            THREE.MathUtils.lerp(activeSwing.startPos.z, 2.05, easeOut)
          );
          hammerRig.rotation.set(easeOut * 0.62, -easeOut * 0.22, -easeOut * 0.28);
        } else {
          // Ease-in power strike forward into the ice wall
          const su = (p - 0.42) / 0.58;
          const easeIn = su * su * su;
          hammerRig.position.set(
            THREE.MathUtils.lerp(activeSwing.hitPoint.x + 0.12, activeSwing.hitPoint.x + 0.04, easeIn),
            THREE.MathUtils.lerp(activeSwing.hitPoint.y + 0.36, activeSwing.hitPoint.y, easeIn),
            THREE.MathUtils.lerp(2.05, strikeZ, easeIn)
          );
          hammerRig.rotation.set(
            THREE.MathUtils.lerp(0.62, -0.58, easeIn),
            THREE.MathUtils.lerp(-0.22, 0.32, easeIn),
            THREE.MathUtils.lerp(-0.28, 0.24, easeIn)
          );
        }

        if (p >= 1 && !activeSwing.impacted) {
          activeSwing.impacted = true;
          applyHitImpact(activeSwing);
          if (activeSwing.fromBottom) targetHover.set(activeSwing.hitPoint.x + 0.4, -0.4, 1.42);
          activeSwing = null;
        }
      } else if (!shatterState) {
        const lerpAlpha = 1 - Math.exp(-16 * rawDt);
        prevHover.copy(hammerRig.position);
        hammerRig.position.lerp(targetHover, lerpAlpha);
        const vx = (hammerRig.position.x - prevHover.x) / rawDt;
        const vy = (hammerRig.position.y - prevHover.y) / rawDt;
        velocity.lerp(new THREE.Vector2(vx, vy), 1 - Math.exp(-12 * rawDt));

        const tiltYaw = THREE.MathUtils.clamp(-velocity.x * 0.055, -0.42, 0.42);
        const tiltPitch = THREE.MathUtils.clamp(velocity.y * 0.045, -0.34, 0.34);
        const idleBreath = reduceMotion ? 0 : Math.sin(t * 2.1) * 0.025;
        hammerRig.rotation.set(tiltPitch + idleBreath, tiltYaw, THREE.MathUtils.clamp(-velocity.x * 0.035, -0.25, 0.25));
      }

      // Camera shake decay
      if (shakePower > 0.001 && !reduceMotion) {
        camera.position.set(
          baseCamPos.x + (Math.random() - 0.5) * shakePower * 2,
          baseCamPos.y + (Math.random() - 0.5) * shakePower * 2,
          baseCamPos.z
        );
        shakePower *= Math.exp(-9.5 * rawDt);
      } else {
        camera.position.copy(baseCamPos);
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    }

    onProgress(0.96);
    renderer.render(scene, camera);
    renderer.domElement.style.opacity = '1';
    onProgress(1);
    onReady();
    loadHdriAsync();
    rafId = requestAnimationFrame(animate);

    return {
      mode: '3d',
      setSoundEnabled: function () {},
      setPointer: setPointerFromClient,
      triggerHit,
      getState: () => ({ hits, shattered: Boolean(shatterState), shardCount: shardMeshes.length }),
      dispose: function () {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(rafId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('resize', onResize);
        dracoLoader.dispose();
        if (physicsWorld) {
          shardMeshes.forEach(s => { if (s.body) try { physicsWorld.removeBody(s.body); } catch {} });
          physicsWorld = null;
        }
        disposables.geometries.forEach(g => { try { g.dispose(); } catch {} });
        disposables.materials.forEach(m => { try { m.dispose(); } catch {} });
        disposables.textures.forEach(tx => { try { tx.dispose(); } catch {} });
        disposables.renderTargets.forEach(rt => { try { rt.dispose(); } catch {} });
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
    };
  }

  global.IceWallGate3D = { create: createIceWallGate3D };
})(window);
