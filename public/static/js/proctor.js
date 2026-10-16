import { FilesetResolver, FaceLandmarker, ObjectDetector } from '/static/vendor/mediapipe/vision_bundle.mjs';
import { THRESH, poseFromMatrix, signature, sigDistance, medianSig, median, makeTracker, downScore, rms, noiseLimit } from './proctor-core.js';
// Put face_landmarker.task in public/static/models/ to run fully offline; otherwise it is fetched from Google's public model bucket.
const MODELS = ['/static/models/face_landmarker.task', 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'];
const OBJ_MODELS = ['/static/models/efficientdet_lite0.tflite', 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite'];
export async function createProctor(video) {
  const fs = await FilesetResolver.forVisionTasks('/static/vendor/mediapipe'); let lm;
  for (const url of MODELS) for (const delegate of ['GPU', 'CPU']) { try { lm = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: url, delegate }, runningMode: 'VIDEO', numFaces: 3, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: true }); break; } catch {} if (lm) break; }
  if (!lm) throw new Error('Face detection model could not be loaded.');
  let od = null; // phone detector is optional: if it cannot load, face proctoring still works
  for (const url of OBJ_MODELS) for (const delegate of ['GPU', 'CPU']) { try { od = await ObjectDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: url, delegate }, runningMode: 'VIDEO', scoreThreshold: 0.3, maxResults: 5, categoryAllowlist: ['cell phone'] }); break; } catch (e) { console.warn('Phone model load failed', url, delegate, e); } if (od) break; }
  console.log(od ? 'Phone detection ready' : 'Phone detection NOT available');
  const seePhone = () => { if (!od || video.readyState < 2) return false; try { return od.detectForVideo(video, performance.now()).detections.length > 0; } catch (e) { console.warn('Phone detect error', e); return false; } };
  const look = () => { const r = lm.detectForVideo(video, performance.now()), n = r.faceLandmarks.length;
    return { n, lm: r.faceLandmarks[0], pose: poseFromMatrix(r.facialTransformationMatrixes?.[0]?.data), down: downScore(r.faceBlendshapes?.[0]?.categories) }; };
  let base = null, timer = null, micCtx = null;
  return {
    // Verify exactly one face looking at the camera for ~8 good frames; stores it as the reference for the whole test.
    async enroll(onTip) {
      const sigs = [], yaws = [], pitches = [], downs = []; const t0 = Date.now();
      while (sigs.length < 8 && Date.now() - t0 < 20000) { await new Promise(r => setTimeout(r, 400)); if (video.readyState < 2) continue; const f = look();
        if (f.n !== 1) { onTip(f.n ? 'Only one person should be in front of the camera.' : 'Face not visible. Sit in good light, facing the camera.'); continue; }
        if (Math.abs(f.pose.yaw) > 15 || Math.abs(f.pose.pitch) > 20) { onTip('Look straight at the screen.'); continue; }
        sigs.push(signature(f.lm, video.videoWidth, video.videoHeight)); yaws.push(f.pose.yaw); pitches.push(f.pose.pitch); downs.push(f.down); onTip(`Verifying… ${sigs.length}/8`); }
      if (sigs.length < 8) return false; base = { sig: medianSig(sigs), yaw: median(yaws), pitch: median(pitches), down: median(downs) }; return true; },
    start(onViolation, onState, micStream) {
      const tr = makeTracker(); let mism = 0, tick = 0, phone = false, noisy = false, an = null, abuf = null, amb = [], ambient = null; const w = video.videoWidth, h = video.videoHeight;
      // Microphone: loudness only (nothing is recorded). The first ~6 s set the room's baseline; sustained sound well above it is logged for review.
      if (micStream?.getAudioTracks().length) { try { const AC = window.AudioContext || window.webkitAudioContext; micCtx = new AC(); micCtx.resume?.(); an = micCtx.createAnalyser(); an.fftSize = 1024; micCtx.createMediaStreamSource(micStream).connect(an); abuf = new Float32Array(an.fftSize); } catch (e) { console.warn('Microphone check unavailable', e); an = null; } }
      timer = setInterval(() => { if (video.readyState < 2) return; const f = look(), now = Date.now(); let state = 'Monitoring: OK', ok = true;
        if (tick++ % 3 === 0) phone = seePhone(); // object model is heavier: run it every 3rd tick (~1.2 s)
        if (an) { an.getFloatTimeDomainData(abuf); const lv = rms(abuf); if (ambient === null) { amb.push(lv); if (amb.length >= 15) ambient = Math.max(median(amb), 0.002); } else noisy = lv > noiseLimit(ambient); }
        const fire = (k, on) => { if (tr(k, on, now)) onViolation(k); if (on) { ok = false; } };
        fire('noise_detected', noisy); if (noisy) state = 'Voice or noise detected';
        fire('no_face', f.n === 0); fire('multiple_faces', f.n > 1); fire('phone_detected', phone); if (phone) state = 'Mobile phone detected';
        if (f.n === 0) state = 'Face not visible'; else if (f.n > 1) state = 'More than one face detected';
        if (f.n === 1) { const dy = Math.abs(f.pose.yaw - base.yaw), dp = Math.abs(f.pose.pitch - base.pitch), away = dy > THRESH.yaw || dp > THRESH.pitch;
          fire('looking_away', away); if (away) state = 'Look at the screen';
          const down = !away && f.down - base.down > THRESH.down; fire('looking_down', down); if (down) state = 'Please look at the screen, not down';
          if (dy < 15 && dp < 15) { mism = sigDistance(signature(f.lm, w, h), base.sig) > THRESH.sig ? mism + 1 : 0; fire('face_mismatch', mism >= 4); if (mism >= 4) state = 'Face does not match'; } }
        else { tr('looking_away', false, now); tr('looking_down', false, now); }
        onState(state, ok); }, 400); },
    stop() { clearInterval(timer); try { micCtx && micCtx.close(); } catch {} micCtx = null; lm.close?.(); } };
}
