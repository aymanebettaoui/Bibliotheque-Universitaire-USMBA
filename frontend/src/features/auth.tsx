import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Worker } from 'tesseract.js';
import { ArrowRight, Camera, CheckCircle2, GraduationCap, Loader2, ScanLine, ShieldCheck, Upload, Users } from 'lucide-react';
import { useAuth, useToast } from '../app/context';
import { api, post } from '../services/api';
import { extractStudentNumber } from '../services/ocr';
import { Field, Modal, PageTitle } from '../components/ui';
import type { Role, User } from '../types';

declare global { interface Window { google?: { accounts: { id: { initialize: (config: Record<string, unknown>) => void; renderButton: (el: HTMLElement, config: Record<string, unknown>) => void; cancel: () => void } } } } }

export function Login() {
  const { session, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notify = useToast();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Role | 'GOOGLE' | null>(null);
  const [googleError, setGoogleError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const queryClient = useQueryClient();
  async function finish(user: User) {
    queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'session' });
    await refresh();
    const next = (location.state as { from?: string } | null)?.from;
    navigate(user.role === 'STUDENT' && !user.student?.verified ? '/verification' : next || (user.role === 'STUDENT' ? '/espace' : '/gestion'), { replace: true });
  }
  useEffect(() => {
    if (!session?.googleClientId || session.user) return;
    let cancelled = false;
    setGoogleLoading(true);
    async function initialize() {
      try {
        const { nonce } = await api<{ nonce: string; csrfToken: string }>('/auth/google/nonce');
        if (!window.google) await new Promise<void>((resolve, reject) => { const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]'); if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('Le service Google ne peut pas être chargé.')), { once: true }); return; } const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.dataset.googleIdentity = 'true'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Le service Google ne peut pas être chargé.')); document.head.appendChild(script); });
        if (cancelled || !buttonRef.current || !window.google) return;
        window.google.accounts.id.initialize({ client_id: session!.googleClientId, nonce, hd: 'usmba.ac.ma', auto_select: false, callback: async (response: { credential: string }) => { setPending('GOOGLE'); try { const result = await post<{ user: User }>('/auth/google', { credential: response.credential, nonce }); await finish(result.user); } catch (e) { setGoogleError((e as Error).message); } finally { setPending(null); } } });
        buttonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', locale: 'fr', text: 'signin_with', width: 320 });
      } catch (e) { if (!cancelled) setGoogleError((e as Error).message); } finally { if (!cancelled) setGoogleLoading(false); }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [session?.googleClientId, session?.user]);
  async function demo(role: Role, scenario?: 'ONBOARDING') { setPending(role); try { const result = await post<{ user: User }>('/auth/demo', { role, ...(scenario ? { scenario } : {}) }); await finish(result.user); } catch (e) { notify((e as Error).message, 'error'); } finally { setPending(null); } }
  if (session?.user) return <section className="auth-card"><CheckCircle2 size={38} className="teal" /><h1>Vous êtes déjà connecté.</h1><p>Retrouvez votre espace et les services de la bibliothèque.</p><button className="button primary" onClick={() => navigate(session.user?.role === 'STUDENT' ? '/espace' : '/gestion')}>Accéder à mon espace <ArrowRight size={16} /></button></section>;
  return <div className="login-layout"><div className="login-intro"><div className="eyebrow">L’ESPACE DE VOS DÉCOUVERTES</div><h1>Tous les savoirs.<br /><em>Votre bibliothèque.</em></h1><p>Un seul compte universitaire pour réserver vos ouvrages et suivre vos emprunts.</p><div className="login-values"><div><ShieldCheck /><span><strong>Votre compte, protégé</strong><small>Connexion Google vérifiée côté serveur.</small></span></div><div><ScanLine /><span><strong>Une inscription simplifiée</strong><small>Votre carte universitaire, une seule fois.</small></span></div><div><GraduationCap /><span><strong>Un service universitaire</strong><small>Réservé aux étudiants vérifiés et au personnel autorisé.</small></span></div></div></div><section className="auth-card"><span className="auth-icon"><GraduationCap size={30} strokeWidth={1.4} /></span><h2>Bienvenue à la bibliothèque</h2><p>Connectez-vous avec votre compte universitaire.</p>{session?.googleClientId ? <><div className="google-button" ref={buttonRef} />{googleLoading && <p className="small-text"><Loader2 className="spin" size={15} />Chargement de Google…</p>}</> : <><button className="button google-disabled" disabled><span className="google-mark">G</span> Se connecter avec Google</button><p className="config-note">La connexion Google nécessite la configuration du client OAuth par l’administrateur.</p></>}{googleError && <p className="inline-error" role="alert">{googleError}</p>}{pending === 'GOOGLE' && <p className="small-text"><Loader2 className="spin" size={15} />Vérification sécurisée de votre compte…</p>}<div className="domain-note"><ShieldCheck size={15} /> Étudiants : comptes @usmba.ac.ma uniquement</div>{session?.demo && <div className="demo-login"><div className="demo-title"><span className="demo-badge">Démonstration</span><span>Données fictives</span></div><p>Explorez un parcours avec un compte de test. Ces accès sont désactivés en production.</p>{([{ role: 'STUDENT', label: 'Espace étudiant', icon: GraduationCap }, { role: 'LIBRARIAN', label: 'Espace bibliothécaire', icon: ScanLine }, { role: 'ADMIN', label: 'Espace administrateur', icon: Users }] as const).map(item => <button key={item.role} data-testid={`demo-login-${item.role}`} disabled={!!pending} className="demo-role" onClick={() => demo(item.role)}><item.icon size={19} /><span>{item.label}</span>{pending === item.role ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}</button>)}<button className="demo-role" data-testid="demo-login-ONBOARDING" disabled={!!pending} onClick={() => demo('STUDENT', 'ONBOARDING')}><Camera size={19} /><span>Tester l’inscription par scan</span><ArrowRight size={17} /></button></div>}<p className="auth-privacy">Les photographies de votre carte ne sont pas conservées. Aucun mot de passe n’est demandé.</p></section></div>;
}

export function Onboarding() {
  const { session, refresh } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState(false);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [number, setNumber] = useState('');
  const [scanDone, setScanDone] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  function stopCamera() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setCamera(false); }
  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);
  async function activate() {
    setError(''); setPreview(''); setNumber(''); setScanDone(false);
    if (!window.isSecureContext) { setError('La caméra nécessite HTTPS ou localhost.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Ce navigateur ne permet pas l’accès à la caméra. Vous pouvez importer une photographie de la carte.'); return; }
    try { stopCamera(); const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1000 } }, audio: false }); streamRef.current = stream; if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); } setCamera(true); }
    catch (e) { const name = (e as DOMException).name; setError(name === 'NotAllowedError' ? 'L’accès à la caméra a été refusé. Autorisez-le dans votre navigateur ou importez une photographie.' : name === 'NotFoundError' ? 'Aucune caméra n’a été trouvée. Vous pouvez importer une photographie de votre carte.' : 'Impossible d’activer la caméra. Vérifiez qu’elle n’est pas utilisée par une autre application.'); }
  }
  async function recognize(image: string) {
    setBusy(true); setError(''); setProgress(0); setNumber(''); setScanDone(false);
    let worker: Worker | undefined;
    try {
      const { createWorker, PSM } = await import('tesseract.js');
      worker = await createWorker('eng', 1, { logger: message => { if (message.status === 'recognizing text') setProgress(Math.round(message.progress * 100)); } });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const result = await worker.recognize(image);
      const candidate = extractStudentNumber(result.data.text, result.data.confidence);
      setScanDone(true); setProgress(100);
      if (!candidate) { setError('La lecture n’a pas identifié un numéro universitaire fiable. Reprenez la capture avec une carte nette, ou demandez une vérification administrative.'); return; }
      setNumber(candidate);
    } catch { setError('La reconnaissance OCR a échoué. Vérifiez votre connexion pour charger le moteur de lecture, puis réessayez. Aucune donnée n’a été inventée.'); }
    finally { await worker?.terminate(); setBusy(false); }
  }
  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) { setError('La caméra n’est pas encore prête.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext('2d'); if (!context) return;
    context.drawImage(video, 0, 0); const original = canvas.toDataURL('image/jpeg', 0.9); setPreview(original); stopCamera();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height); for (let i = 0; i < pixels.data.length; i += 4) { const gray = (pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114 - 128) * 1.25 + 128; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray; } context.putImageData(pixels, 0, 0);
    await recognize(canvas.toDataURL('image/png'));
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setError('Choisissez une image JPEG, PNG ou WebP de moins de 8 Mo.'); return; }
    stopCamera();
    const reader = new FileReader(); reader.onload = () => { const image = String(reader.result); setPreview(image); void recognize(image); }; reader.onerror = () => setError('Le fichier image ne peut pas être lu.'); reader.readAsDataURL(file);
  }
  async function verify() { setBusy(true); setError(''); try { const result = await post('/onboarding/verify', { studentNumber: number.trim().toUpperCase() }); await refresh(); notify(result.verification?.message || 'Votre compte universitaire est vérifié.'); navigate('/espace'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (session?.user?.student?.verified) return <div className="auth-card"><CheckCircle2 size={38} className="teal" /><h1>Votre identité est déjà vérifiée.</h1><p>Vous n’avez pas besoin de scanner à nouveau votre carte.</p><button className="button primary" onClick={() => navigate('/espace')}>Accéder à mon espace <ArrowRight size={16} /></button></div>;
  return <><PageTitle eyebrow="PREMIÈRE CONNEXION" title="Vérification de votre identité universitaire" description="Une seule vérification pour profiter des services d’emprunt. Préparez votre carte universitaire." /><div className="onboarding-layout"><section className="panel camera-panel"><div className="scan-steps"><span className="current">1. Capturer la carte</span><span className={scanDone ? 'current' : ''}>2. Lire les informations</span><span>3. Vérifier</span></div><div className={`camera-zone ${camera ? 'live' : ''}`}><video ref={videoRef} playsInline muted className={camera ? 'visible' : ''} />{preview ? <img src={preview} alt="Aperçu de la carte capturée, conservé uniquement dans cette page" /> : !camera && <div className="camera-placeholder"><Camera size={45} strokeWidth={1.2} /><h3>Placez votre carte dans le cadre</h3><p>Choisissez un endroit lumineux et évitez les reflets.</p></div>}{camera && <div className="card-frame"><span /><span /><span /><span /><small>Gardez la carte nette et bien à plat</small></div>}</div>{busy && <div className="ocr-progress" role="status"><Loader2 className="spin" size={18} /><span>Lecture et vérification… {progress > 0 ? `${progress} %` : ''}</span><progress max={100} value={progress} /></div>}<div className="camera-actions">{camera ? <button disabled={busy} className="button primary" onClick={capture}><ScanLine size={18} /> Scanner ma carte</button> : <button disabled={busy} className="button primary" onClick={activate}><Camera size={18} />{preview ? 'Recommencer la capture' : 'Activer la caméra'}</button>}<label className={`button secondary file-button ${busy ? 'disabled' : ''}`}><Upload size={17} />Importer une photo<input aria-label="Importer une photographie de carte" disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void upload(e.target.files?.[0])} /></label>{camera && <button className="button ghost" onClick={stopCamera}>Arrêter la caméra</button>}</div>{error && <div className="inline-error" role="alert">{error}</div>}{number && <div className="extracted-result"><div><CheckCircle2 size={19} /><strong>Un identifiant a été extrait</strong></div><p>Corrigez uniquement une éventuelle erreur de lecture. Le connecteur universitaire vérifiera cet identifiant.</p><Field label="Numéro étudiant / CNE"><input value={number} onChange={e => setNumber(e.target.value.toUpperCase())} maxLength={20} autoComplete="off" /></Field><button className="button primary" disabled={busy || !number.trim()} onClick={verify}>Vérifier mes informations <ArrowRight size={17} /></button></div>}</section><aside className="onboarding-info"><ShieldCheck size={31} strokeWidth={1.3} /><h2>Votre identité, avec soin.</h2><p>Le scan aide à lire votre numéro étudiant. Il ne constitue pas à lui seul une preuve d’identité.</p><ul><li>Aucune photographie n’est envoyée ou stockée par le serveur.</li><li>Seules les informations indispensables à la vérification sont transmises.</li><li>La caméra est arrêtée après la capture et lorsque vous quittez la page.</li></ul>{session?.demo ? <p className="info-box">Vérification simulée — environnement de démonstration. Le connecteur utilise exclusivement un registre d’étudiants fictifs. Pour le parcours de test d’inscription, photographiez un support portant le numéro fictif R202400003. Une vraie capture et une vraie lecture OCR sont nécessaires.<br /><a className="text-link" href="/demo-card.png" download="carte-fictive-demonstration.png">Télécharger une carte fictive de test <Upload size={14} /></a></p> : !session?.universityConfigured && <p className="info-box">Le connecteur universitaire officiel n’est pas configuré. Un administrateur peut organiser une vérification physique de votre carte.</p>}<button className="text-link" onClick={() => setReviewOpen(true)}>La lecture ne fonctionne pas ? Demander une vérification <ArrowRight size={15} /></button></aside></div><Modal open={reviewOpen} onOpenChange={setReviewOpen} title="Demander une vérification administrative" description="Votre demande sera examinée par un administrateur. Elle n’active pas automatiquement votre compte."><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await post('/onboarding/review', { reason: reviewReason, ...(number ? { studentNumber: number } : {}) }); notify('Votre demande de vérification a été transmise.'); setReviewOpen(false); } catch (err) { notify((err as Error).message, 'error'); } finally { setBusy(false); } }}><Field label="Décrivez la difficulté rencontrée"><textarea required minLength={10} maxLength={500} value={reviewReason} onChange={e => setReviewReason(e.target.value)} rows={4} /></Field><div className="dialog-actions"><button className="button primary" disabled={busy}>Envoyer la demande <ArrowRight size={16} /></button></div></form></Modal></>;
}
