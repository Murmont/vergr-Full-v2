// KYC Wizard — step-by-step identity verification.
//
// Flow (all client-side until the final encrypted submit):
//   1. Consent         — GDPR Article 9 biometric consent (separate, unchecked)
//   2. Identity        — legal name, DOB (≥18), country
//   3. Address         — line 1, city, postal
//   4. Document        — camera capture (rear) of ID front; if non-passport, back too
//                        OCR cross-check against step 2 (flag mismatches, don't block)
//   5. Liveness+Selfie — MediaPipe 3-challenge, auto-captures final selfie
//                        client-side face match vs ID photo (UX hint only)
//   6. Review & Submit — encrypt + upload + write record
//
// On slow mobile connections the model download feels sluggish → we show a
// "Preparing camera…" screen before any camera step with a download progress
// bar from the CDN loaders.
//
// Props: { sessionId?, onComplete, onCancel }
//  - sessionId is set on the mobile handoff flow so we can join an in-progress
//    desktop session; otherwise we run stand-alone.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, doc, setDoc, updateDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { ref as sRef, uploadBytes } from 'firebase/storage';
import { db, storage, auth } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import Icon from '../Icon';
import {
  generateDataKey, wrapDataKey, encryptBlob, encryptJson, sha256Hex,
} from '../../utils/kycCrypto';
import {
  loadTesseract, loadFaceApi, loadFaceMesh, runOcr, crossCheckOcr,
} from '../../utils/kycLoaders';
import { analyzeLandmarks, createLivenessController } from '../../utils/kycLiveness';
import { safeReload } from '../../utils/platform';

const COUNTRIES = ['US','CA','GB','IE','DE','FR','ES','IT','NL','SE','NO','DK','FI','PL','PT','AU','NZ','JP','KR','SG','BR','MX','AR','ZA','AE','IN','Other'];
const ID_TYPES = [
  { v: 'passport',       l: 'Passport',       icon: 'menu_book',   needBack: false },
  { v: 'driver_license', l: 'Driver license', icon: 'directions_car', needBack: true },
  { v: 'national_id',    l: 'National ID',    icon: 'badge',       needBack: true },
];

// Accept 0.6 Euclidean by default, reviewer can override.
const FACE_MATCH_THRESHOLD = 0.6;

export default function KycWizard({ onComplete }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Form state ---------------------------------------------------------------
  const [consent, setConsent] = useState({ process: false, biometric: false });
  const [identity, setIdentity] = useState({ firstName: '', lastName: '', dob: '', country: '' });
  const [address, setAddress] = useState({ line1: '', city: '', postal: '' });
  const [idType, setIdType] = useState('passport');
  const [docs, setDocs] = useState({ front: null, back: null, selfie: null });
  const [ocrResult, setOcrResult] = useState(null);
  const [faceMatch, setFaceMatch] = useState(null); // { distance, match, idDescriptor, selfieDescriptor }

  // Wizard navigation --------------------------------------------------------
  const goNext = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep(s => Math.max(s - 1, 0));

  // Validators per step ------------------------------------------------------
  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return consent.process && consent.biometric;
      case 1: {
        if (!identity.firstName.trim() || !identity.lastName.trim() || !identity.country) return false;
        if (!identity.dob) return false;
        const age = Math.floor((Date.now() - new Date(identity.dob).getTime()) / (365.25 * 86400000));
        return age >= 18;
      }
      case 2: return !!address.line1.trim() && !!address.city.trim();
      case 3: {
        const needBack = ID_TYPES.find(t => t.v === idType)?.needBack;
        return !!docs.front && (!needBack || !!docs.back);
      }
      case 4: return !!docs.selfie && !!faceMatch;
      default: return true;
    }
  }, [step, consent, identity, address, idType, docs, faceMatch]);

  // Submit -------------------------------------------------------------------
  const submit = async () => {
    if (submitting || !currentUser) return;
    setSubmitting(true);
    try {
      // 1. Encrypt everything with a fresh data key
      const dk = await generateDataKey();
      const wrappedKey = await wrapDataKey(dk);

      const encFront = await encryptBlob(dk, docs.front);
      const encBack  = docs.back ? await encryptBlob(dk, docs.back) : null;
      const encSelfie = await encryptBlob(dk, docs.selfie);

      const hashFront  = await sha256Hex(docs.front);
      const hashBack   = docs.back ? await sha256Hex(docs.back) : null;
      const hashSelfie = await sha256Hex(docs.selfie);

      const piiPayload = {
        identity, address, idType,
        ocr: ocrResult,
        clientFaceMatch: faceMatch ? {
          distance: faceMatch.distance,
          match: faceMatch.match,
          threshold: FACE_MATCH_THRESHOLD,
        } : null,
        submittedFrom: navigator.userAgent,
      };
      const encPii = await encryptJson(dk, piiPayload);

      // 2. Upload ciphertext blobs
      const prefix = `kyc-secure/${currentUser.uid}`;
      const uploadOne = async (encBlob, name) => {
        const path = `${prefix}/${name}_${Date.now()}.enc`;
        const r = sRef(storage, path);
        await uploadBytes(r, encBlob.blob, {
          contentType: 'application/octet-stream',
          customMetadata: { iv: encBlob.ivB64 },
        });
        return { path, iv: encBlob.ivB64, size: encBlob.size };
      };
      const frontRef  = await uploadOne(encFront, 'id_front');
      const backRef   = encBack ? await uploadOne(encBack, 'id_back') : null;
      const selfieRef = await uploadOne(encSelfie, 'selfie');

      // 3. Masked name for admin UI (privacy-preserving list view)
      const mask = (s) => s ? s[0] + '*'.repeat(Math.max(s.length - 1, 2)) : '';
      const maskedName = `${mask(identity.firstName)} ${mask(identity.lastName)}`;

      // 4. Public application record
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 90 * 86400 * 1000));
      await setDoc(doc(db, 'verification_applications', currentUser.uid), {
        userId: currentUser.uid,
        username: profile?.username || null,
        maskedName,
        country: identity.country,
        idType,
        status: 'pending',
        submittedAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        ocrFlagged: !!ocrResult?.flagged,
        clientFaceDistance: faceMatch?.distance ?? null,
        needsManualReview: !!ocrResult?.flagged || (faceMatch?.distance ?? 1) > FACE_MATCH_THRESHOLD,
        docHashes: { front: hashFront, back: hashBack, selfie: hashSelfie },
        expiresAt,
      });

      // 5. Private PII (admin-only via Firestore rules)
      await setDoc(
        doc(db, 'verification_applications', currentUser.uid, 'private', 'pii'),
        {
          wrappedKey,
          ciphertext: encPii.ciphertextB64,
          iv: encPii.ivB64,
          docs: { front: frontRef, back: backRef, selfie: selfieRef },
          createdAt: serverTimestamp(),
          expiresAt,
        }
      );

      showToast('Submitted for review', 'success');
      onComplete?.();
    } catch (e) {
      console.error('KYC submit failed', e);
      showToast('Submission failed — please try again', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Render -------------------------------------------------------------------
  const CurrentStep = STEPS[step].component;
  return (
    <div className="max-w-2xl mx-auto">
      <Progress step={step} total={STEPS.length} />

      <div className="bg-surface-1 border border-white/[0.06] rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-brand-violet/10 flex items-center justify-center">
            <Icon name={STEPS[step].icon} size={18} className="text-brand-violet-light" />
          </div>
          <div>
            <h2 className="font-syne font-bold text-white text-lg">{STEPS[step].title}</h2>
            <p className="text-text-muted text-xs">{STEPS[step].subtitle}</p>
          </div>
        </div>

        <CurrentStep
          consent={consent} setConsent={setConsent}
          identity={identity} setIdentity={setIdentity}
          address={address} setAddress={setAddress}
          idType={idType} setIdType={setIdType}
          docs={docs} setDocs={setDocs}
          ocrResult={ocrResult} setOcrResult={setOcrResult}
          faceMatch={faceMatch} setFaceMatch={setFaceMatch}
        />
      </div>

      <div className="flex gap-3 mt-4">
        {step > 0 && (
          <button onClick={goBack} disabled={submitting}
            className="flex-1 py-3 rounded-xl bg-surface-2 text-white font-bold text-sm hover:bg-surface-3 transition-all">
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={goNext} disabled={!canAdvance}
            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${canAdvance ? 'bg-brand-violet text-white hover:brightness-110' : 'bg-surface-2 text-text-muted cursor-not-allowed'}`}>
            Continue
          </button>
        ) : (
          <button onClick={submit} disabled={!canAdvance || submitting}
            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${canAdvance && !submitting ? 'bg-brand-violet text-white hover:brightness-110' : 'bg-surface-2 text-text-muted cursor-not-allowed'}`}>
            {submitting ? 'Encrypting & submitting…' : 'Submit for review'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────── Progress rail ───────── */
function Progress({ step, total }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
        <span>Step {step + 1} of {total}</span>
        <span>{STEPS[step].title}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-brand-violet to-brand-violet transition-all duration-500" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>
    </div>
  );
}

/* ───────── Shared field primitives ───────── */
const inputCls = 'w-full bg-surface-2 border border-white/[0.06] rounded-xl px-3 py-2.5 text-white text-sm focus:border-brand-violet/60 focus:outline-none transition-colors';
const Field = ({ label, children, hint }) => (
  <label className="block">
    <span className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-text-muted mt-1">{hint}</span>}
  </label>
);
const Row = ({ children }) => <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;

/* ───────── Step 1 · Consent ───────── */
function StepConsent({ consent, setConsent }) {
  return (
    <div className="space-y-4 text-sm text-text-secondary">
      <p>
        VERGR needs to verify your identity before you can run ad campaigns, offer paid memberships or receive payouts.
        Your data is processed in the EU (<span className="text-brand-violet-light font-bold">europe-west1</span>), encrypted end-to-end,
        and automatically deleted 90 days after a decision is made.
      </p>

      <ConsentCheckbox
        checked={consent.process} onChange={v => setConsent(c => ({ ...c, process: v }))}
        title="I consent to identity verification processing"
        body="I agree that VERGR may process the personal data I provide (name, date of birth, address, government-issued ID) for the sole purpose of verifying my identity, under Article 6(1)(b) GDPR (necessary for the contract)." />

      <ConsentCheckbox
        checked={consent.biometric} onChange={v => setConsent(c => ({ ...c, biometric: v }))}
        title="I consent to biometric processing (Article 9 GDPR)"
        body="I consent to VERGR processing my facial image and face-geometry descriptor for biometric identity verification. This data is encrypted and deleted 90 days after a decision is made. I can withdraw consent at any time by deleting my account." />

      <div className="rounded-xl border border-white/10 bg-surface-2 p-3 text-[11px] text-text-muted space-y-1">
        <p><span className="text-white font-bold">Retention:</span> Raw documents and the biometric descriptor auto-delete after 90 days. A masked decision record is kept for 2 years (audit).</p>
        <p><span className="text-white font-bold">Your rights:</span> Access, rectification, erasure, portability — use Settings → Privacy or email privacy@vergr.app.</p>
        <p><span className="text-white font-bold">Controller:</span> VERGR. No third-party processors involved.</p>
      </div>
    </div>
  );
}
function ConsentCheckbox({ checked, onChange, title, body }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-white/10 bg-surface-2/50 hover:bg-surface-2 transition-colors">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 w-4 h-4 accent-brand-violet" />
      <div className="flex-1">
        <p className="text-white font-bold text-xs">{title}</p>
        <p className="text-text-muted text-[11px] mt-0.5 leading-relaxed">{body}</p>
      </div>
    </label>
  );
}

/* ───────── Step 2 · Identity ───────── */
function StepIdentity({ identity, setIdentity }) {
  return (
    <div className="space-y-4">
      <Row>
        <Field label="Legal first name">
          <input type="text" value={identity.firstName} onChange={e => setIdentity(i => ({ ...i, firstName: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Legal last name">
          <input type="text" value={identity.lastName} onChange={e => setIdentity(i => ({ ...i, lastName: e.target.value }))} className={inputCls} />
        </Field>
      </Row>
      <Row>
        <Field label="Date of birth" hint="You must be 18 or older.">
          <input type="date" value={identity.dob} onChange={e => setIdentity(i => ({ ...i, dob: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Country of residence">
          <select value={identity.country} onChange={e => setIdentity(i => ({ ...i, country: e.target.value }))} className={inputCls}>
            <option value="">Select…</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </Row>
    </div>
  );
}

/* ───────── Step 3 · Address ───────── */
function StepAddress({ address, setAddress }) {
  return (
    <div className="space-y-4">
      <Field label="Street address">
        <input type="text" value={address.line1} onChange={e => setAddress(a => ({ ...a, line1: e.target.value }))} className={inputCls} />
      </Field>
      <Row>
        <Field label="City">
          <input type="text" value={address.city} onChange={e => setAddress(a => ({ ...a, city: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Postal code">
          <input type="text" value={address.postal} onChange={e => setAddress(a => ({ ...a, postal: e.target.value }))} className={inputCls} />
        </Field>
      </Row>
    </div>
  );
}

/* ───────── Step 4 · Document capture + OCR ───────── */
function StepDocument({ idType, setIdType, docs, setDocs, ocrResult, setOcrResult, identity }) {
  const needBack = ID_TYPES.find(t => t.v === idType)?.needBack;
  const [capture, setCapture] = useState(null); // 'front' | 'back'
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(null);

  const handleCaptured = async (blob, which) => {
    setDocs(d => ({ ...d, [which]: blob }));
    setCapture(null);
    if (which === 'front') {
      // Run OCR cross-check in background (non-blocking for UX)
      setOcrBusy(true);
      try {
        const Tesseract = await loadTesseract(setOcrProgress);
        const url = URL.createObjectURL(blob);
        const img = await loadImage(url);
        const { text, confidence } = await runOcr(Tesseract, img, setOcrProgress);
        URL.revokeObjectURL(url);
        const check = crossCheckOcr(text, { firstName: identity.firstName, lastName: identity.lastName, dob: identity.dob });
        setOcrResult({ text, confidence, ...check });
      } catch (e) {
        console.warn('OCR failed, continuing without:', e);
        setOcrResult({ text: '', confidence: 0, nameHit: false, dobHit: false, flagged: true, error: String(e) });
      } finally {
        setOcrBusy(false);
        setOcrProgress(null);
      }
    }
  };

  if (capture) {
    return <CameraCapture
      facingMode="environment"
      guideLabel={capture === 'front' ? (idType === 'passport' ? 'Align passport photo page' : 'Align ID front') : 'Align ID back'}
      aspect={1.58}
      onCancel={() => setCapture(null)}
      onCaptured={(blob) => handleCaptured(blob, capture)}
    />;
  }

  return (
    <div className="space-y-4">
      <Field label="Document type">
        <div className="grid grid-cols-3 gap-2">
          {ID_TYPES.map(t => (
            <button key={t.v} onClick={() => setIdType(t.v)}
              className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-1 ${idType === t.v ? 'border-brand-violet bg-brand-violet/10 text-brand-violet-light' : 'border-white/10 bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>
              <Icon name={t.icon} size={22} />
              <span className="text-[11px] font-bold">{t.l}</span>
            </button>
          ))}
        </div>
      </Field>

      <DocSlot label={idType === 'passport' ? 'Passport photo page' : 'ID front'} blob={docs.front}
        onCapture={() => setCapture('front')} onClear={() => { setDocs(d => ({ ...d, front: null })); setOcrResult(null); }} />

      {needBack && (
        <DocSlot label="ID back" blob={docs.back}
          onCapture={() => setCapture('back')} onClear={() => setDocs(d => ({ ...d, back: null }))} />
      )}

      {ocrBusy && (
        <div className="rounded-xl border border-white/10 bg-surface-2 p-3 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" />
            {ocrProgress?.label || 'Reading document…'}
            {ocrProgress?.percent != null && <span className="text-text-muted font-dmmono">{ocrProgress.percent}%</span>}
          </div>
        </div>
      )}

      {ocrResult && !ocrBusy && (
        <div className={`rounded-xl border p-3 text-xs ${ocrResult.flagged ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-200' : 'border-green-500/30 bg-green-500/5 text-green-200'}`}>
          <div className="flex items-center gap-2">
            <Icon name={ocrResult.flagged ? 'warning' : 'check_circle'} filled size={16} />
            <span className="font-bold">
              {ocrResult.flagged ? 'OCR couldn\'t fully verify' : 'Document matches your details'}
            </span>
          </div>
          <p className="text-[11px] mt-1 opacity-80">
            {ocrResult.flagged
              ? 'A reviewer will check manually. This is normal for some document layouts and won\'t block your application.'
              : 'Name and date of birth detected on the document match the details you entered.'}
          </p>
        </div>
      )}
    </div>
  );
}
function DocSlot({ label, blob, onCapture, onClear }) {
  const url = blob ? URL.createObjectURL(blob) : null;
  return (
    <Field label={label}>
      {blob ? (
        <div className="flex items-center gap-3 p-2 rounded-xl border border-brand-violet/30 bg-brand-violet/5">
          <img src={url} alt="" className="w-20 h-14 object-cover rounded-lg" />
          <div className="flex-1">
            <p className="text-xs text-white font-bold">Captured</p>
            <p className="text-[11px] text-text-muted">{(blob.size / 1024).toFixed(0)} KB</p>
          </div>
          <button onClick={onClear} className="text-brand-ember text-xs font-bold hover:underline">Retake</button>
        </div>
      ) : (
        <button onClick={onCapture} className="w-full p-4 rounded-xl border-2 border-dashed border-white/10 hover:border-white/20 bg-surface-2 flex items-center justify-center gap-2 text-sm text-text-secondary transition-all">
          <Icon name="photo_camera" size={18} />
          Open camera
        </button>
      )}
    </Field>
  );
}

/* ───────── Step 5 · Liveness + selfie + face match ───────── */
function StepLiveness({ docs, setDocs, faceMatch, setFaceMatch }) {
  const [preparing, setPreparing] = useState(true);
  const [prepProgress, setPrepProgress] = useState({ percent: 0, label: 'Preparing camera…' });
  const [error, setError] = useState(null);
  const [started, setStarted] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [passes, setPasses] = useState([]);
  const [matching, setMatching] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceMeshRef = useRef(null);
  const faceApiRef = useRef(null);
  const ctrlRef = useRef(null);
  const runningRef = useRef(false);

  // Preload libs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const onP = (p) => !cancelled && setPrepProgress({ percent: p.percent, label: p.label });
        const [mesh, api] = await Promise.all([loadFaceMesh(onP), loadFaceApi(onP)]);
        if (cancelled) return;
        faceMeshRef.current = mesh;
        faceApiRef.current = api;
        setPreparing(false);
      } catch (e) {
        setError('Could not load camera libraries. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = () => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setError(null);
    setStarted(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      ctrlRef.current = createLivenessController((ev) => {
        if (ev.type === 'challenge') setChallenge(ev);
        if (ev.type === 'pass') setPasses(p => [...p, ev.challenge]);
        if (ev.type === 'done') onLivenessPass();
      });

      const mesh = faceMeshRef.current;
      mesh.onResults((results) => {
        if (!runningRef.current) return;
        const lm = results.multiFaceLandmarks?.[0];
        const analysis = analyzeLandmarks(lm);
        ctrlRef.current?.step(analysis);
      });

      runningRef.current = true;
      const loop = async () => {
        if (!runningRef.current) return;
        if (videoRef.current?.readyState >= 2) {
          await mesh.send({ image: videoRef.current });
        }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      setError('Camera access denied. Please allow camera access and retry.');
      setStarted(false);
    }
  };

  const onLivenessPass = async () => {
    // Grab a selfie frame
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    setDocs(d => ({ ...d, selfie: blob }));
    stopStream();

    // Face match vs ID front
    setMatching(true);
    try {
      const faceapi = faceApiRef.current;
      const idUrl = URL.createObjectURL(docs.front);
      const selfieUrl = URL.createObjectURL(blob);
      const idImg = await loadImage(idUrl);
      const selfieImg = await loadImage(selfieUrl);
      const [idDet, selfieDet] = await Promise.all([
        faceapi.detectSingleFace(idImg, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor(),
        faceapi.detectSingleFace(selfieImg, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor(),
      ]);
      URL.revokeObjectURL(idUrl); URL.revokeObjectURL(selfieUrl);
      if (!idDet || !selfieDet) {
        setFaceMatch({ distance: 1, match: false, error: 'face_not_detected' });
      } else {
        const distance = faceapi.euclideanDistance(idDet.descriptor, selfieDet.descriptor);
        setFaceMatch({ distance, match: distance < FACE_MATCH_THRESHOLD });
      }
    } catch (e) {
      setFaceMatch({ distance: 1, match: false, error: String(e) });
    } finally {
      setMatching(false);
    }
  };

  if (preparing) {
    return <Preparing progress={prepProgress} />;
  }
  if (error) {
    return <div className="text-center py-8">
      <Icon name="error" filled size={32} className="text-brand-ember mx-auto mb-2" />
      <p className="text-white text-sm">{error}</p>
      <button onClick={() => { setError(null); setPreparing(true); setStarted(false); safeReload(); }} className="mt-4 px-4 py-2 rounded-xl bg-brand-violet text-white text-xs font-bold">Retry</button>
    </div>;
  }
  if (docs.selfie && faceMatch) {
    return <SelfieResult docs={docs} faceMatch={faceMatch} matching={matching} onRetry={() => { setDocs(d => ({ ...d, selfie: null })); setFaceMatch(null); setPasses([]); setStarted(false); }} />;
  }
  if (!started) {
    return <div className="text-center py-4">
      <div className="w-20 h-20 mx-auto rounded-full bg-brand-violet/10 flex items-center justify-center mb-4">
        <Icon name="face" filled size={36} className="text-brand-violet" />
      </div>
      <h3 className="text-white font-bold text-base">Liveness check</h3>
      <p className="text-text-secondary text-sm mt-1 max-w-sm mx-auto">
        We'll ask you to complete 3 quick challenges (blink, turn head) to make sure it's really you. Takes about 10 seconds.
      </p>
      <button onClick={start} className="mt-5 px-6 py-3 rounded-xl bg-brand-violet text-white font-bold text-sm hover:brightness-110 inline-flex items-center gap-2">
        <Icon name="videocam" size={18} /> Start camera
      </button>
    </div>;
  }
  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-6 rounded-[50%] border-4 border-brand-violet/60 pointer-events-none" />
        {matching && <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-sm font-bold">Matching faces…</div>}
      </div>
      <div className="rounded-xl bg-surface-2 p-4 text-center">
        <p className="text-text-muted text-[10px] uppercase tracking-wider font-bold mb-1">Challenge {(challenge?.index ?? 0) + 1}/{challenge?.total ?? 3}</p>
        <p className="text-white font-syne font-bold text-lg">{challenge?.message || 'Prepare…'}</p>
        <div className="flex justify-center gap-1.5 mt-3">
          {Array.from({ length: challenge?.total ?? 3 }).map((_, i) => (
            <span key={i} className={`w-2 h-2 rounded-full ${i < passes.length ? 'bg-brand-violet' : 'bg-white/10'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
function SelfieResult({ docs, faceMatch, matching, onRetry }) {
  const ok = faceMatch?.match;
  const url = docs.selfie ? URL.createObjectURL(docs.selfie) : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {url && <img src={url} alt="" className="w-20 h-20 rounded-2xl object-cover" />}
        <div className="flex-1">
          <p className="text-white font-bold text-sm">Selfie captured</p>
          <p className="text-text-muted text-xs">Liveness challenges passed.</p>
        </div>
        <button onClick={onRetry} className="text-brand-ember text-xs font-bold hover:underline">Retake</button>
      </div>
      <div className={`rounded-xl border p-3 text-xs ${ok ? 'border-green-500/30 bg-green-500/5 text-green-200' : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-200'}`}>
        <div className="flex items-center gap-2">
          <Icon name={ok ? 'verified' : 'warning'} filled size={16} />
          <span className="font-bold">{ok ? 'Face match confirmed' : 'Face match needs review'}</span>
          <span className="ml-auto font-dmmono tabular-nums opacity-70">d={faceMatch?.distance?.toFixed(3) ?? '—'}</span>
        </div>
        <p className="text-[11px] mt-1 opacity-80">
          {ok
            ? 'Your selfie matches the photo on your ID. You can continue to review.'
            : 'The automatic comparison couldn\'t confirm a match. Your application will be reviewed manually — this is normal for some lighting / angle conditions and won\'t be rejected automatically.'}
        </p>
      </div>
    </div>
  );
}

/* ───────── Step 6 · Review ───────── */
function StepReview({ identity, address, idType, docs, ocrResult, faceMatch }) {
  const idLabel = ID_TYPES.find(t => t.v === idType)?.l;
  return (
    <div className="space-y-3 text-sm">
      <ReviewRow label="Legal name" value={`${identity.firstName} ${identity.lastName}`} />
      <ReviewRow label="Date of birth" value={identity.dob} />
      <ReviewRow label="Country" value={identity.country} />
      <ReviewRow label="Address" value={`${address.line1}, ${address.city} ${address.postal}`} />
      <ReviewRow label="Document" value={idLabel} />
      <ReviewRow label="OCR cross-check" value={ocrResult?.flagged ? 'Needs review' : 'Matched'} tone={ocrResult?.flagged ? 'warn' : 'ok'} />
      <ReviewRow label="Face match" value={faceMatch?.match ? `OK (d=${faceMatch.distance?.toFixed(3)})` : `Needs review (d=${faceMatch?.distance?.toFixed(3) ?? '—'})`} tone={faceMatch?.match ? 'ok' : 'warn'} />
      <div className="rounded-xl border border-brand-violet/30 bg-brand-violet/5 p-3 text-xs text-text-secondary">
        <Icon name="lock" size={14} className="inline text-brand-violet mr-1 align-middle" />
        On submit, all documents and personal data will be encrypted in your browser (AES-256-GCM). Only a VERGR reviewer with the private key can decrypt.
      </div>
    </div>
  );
}
function ReviewRow({ label, value, tone }) {
  const toneCls = tone === 'ok' ? 'text-green-400' : tone === 'warn' ? 'text-yellow-400' : 'text-white';
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/[0.04] last:border-b-0">
      <span className="text-text-muted text-xs uppercase tracking-wider font-bold">{label}</span>
      <span className={`font-bold text-right truncate max-w-[60%] ${toneCls}`}>{value || '—'}</span>
    </div>
  );
}

/* ───────── Preparing screen (models download) ───────── */
function Preparing({ progress }) {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 mx-auto rounded-full bg-brand-violet/10 flex items-center justify-center mb-4">
        <div className="w-8 h-8 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="text-white font-bold text-sm">{progress?.label || 'Preparing camera…'}</p>
      <p className="text-text-muted text-xs mt-1">Downloading verification models (~15 MB, first time only)</p>
      <div className="mt-4 max-w-xs mx-auto h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full bg-brand-violet transition-all duration-300" style={{ width: `${progress?.percent || 0}%` }} />
      </div>
    </div>
  );
}

/* ───────── Camera capture component ───────── */
function CameraCapture({ facingMode, guideLabel, aspect = 1.58, onCaptured, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        streamRef.current = s;
        videoRef.current.srcObject = s;
        await videoRef.current.play();
        setReady(true);
      } catch (e) {
        setErr('Camera access denied. Please allow camera access.');
      }
    })();
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, [facingMode]);

  const snap = async () => {
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    onCaptured(blob);
  };

  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: aspect }}>
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        {ready && (
          <div className="absolute inset-4 border-2 border-brand-violet/70 rounded-xl pointer-events-none flex items-end justify-center pb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-black/60 px-2 py-1 rounded-full">{guideLabel}</span>
          </div>
        )}
        {err && <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-white text-sm p-6 text-center">{err}</div>}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-surface-2 text-white font-bold text-sm">Cancel</button>
        <button onClick={snap} disabled={!ready} className={`flex-1 py-3 rounded-xl font-bold text-sm ${ready ? 'bg-brand-violet text-white' : 'bg-surface-3 text-text-muted'}`}>Capture</button>
      </div>
    </div>
  );
}

/* ───────── Helpers ───────── */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ───────── Step list ───────── */
const STEPS = [
  { title: 'Consent',     subtitle: 'GDPR — please review and agree',    icon: 'shield_lock',     component: (p) => <StepConsent {...p} /> },
  { title: 'Identity',    subtitle: 'Who are you, legally?',             icon: 'person',          component: (p) => <StepIdentity {...p} /> },
  { title: 'Address',     subtitle: 'Where do you live?',                icon: 'home',            component: (p) => <StepAddress {...p} /> },
  { title: 'Document',    subtitle: 'Capture your government-issued ID', icon: 'credit_card',     component: (p) => <StepDocument {...p} /> },
  { title: 'Liveness',    subtitle: 'Prove you are real',                icon: 'face',            component: (p) => <StepLiveness {...p} /> },
  { title: 'Review',      subtitle: 'Confirm everything looks right',    icon: 'task_alt',        component: (p) => <StepReview {...p} /> },
];
