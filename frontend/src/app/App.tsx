import { useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Bell, BookOpen, Bookmark, CalendarDays, ChevronRight, CircleHelp, ClipboardList, GraduationCap, LayoutDashboard, Library, LogOut, Menu, ScanLine, Settings2, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { useAuth, useToast } from './context';
import { api, labels } from '../services/api';
import type { List, Notice, Role } from '../types';
import { Badge, Empty, ErrorState, Loader, Modal } from '../components/ui';
import { Catalogue, BookDetail } from '../features/catalogue';
import { Login, Onboarding } from '../features/auth';
import { StudentDashboard, Requests, Loans, Sanctions, Notifications, Recommendations, Acquisitions } from '../features/student';
import { StaffDashboard, Inventory, Counter, StaffSanctions, Administration } from '../features/staff';

function Guard({ roles, children }: { roles?: Role[]; children?: ReactNode }) {
  const { session, loading, error } = useAuth();
  const location = useLocation();
  if (loading) return <Loader />;
  if (error) return <ErrorState error={error} />;
  if (!session?.user) return <Navigate to="/connexion" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(session.user.role)) return <Empty title="Accès réservé">Votre rôle ne permet pas d’accéder à cette page. <Link to="/">Retour au catalogue</Link></Empty>;
  if (!session.user.active) return <Empty title="Compte désactivé">Contactez l’administration de la bibliothèque pour obtenir de l’aide.</Empty>;
  return children || <Outlet />;
}

function Shell() {
  const { session, logout } = useAuth();
  const user = session?.user;
  const [mobileNav, setMobileNav] = useState(false);
  const [help, setHelp] = useState(false);
  const notify = useToast();
  const navigate = useNavigate();
  const notices = useQuery({ queryKey: ['notifications'], queryFn: () => api<List<Notice>>('/notifications'), enabled: !!user });
  const unread = notices.data?.items.filter(n => !n.readAt).length || 0;
  const staff = user?.role === 'LIBRARIAN' || user?.role === 'ADMIN';
  const navItem = (path: string, title: string, Icon: typeof BookOpen, end = false) => <NavLink to={path} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileNav(false)}><Icon size={19} strokeWidth={1.7} /><span>{title}</span><ChevronRight className="nav-chevron" size={15} /></NavLink>;
  return <div className="app-shell">
    {mobileNav && <button className="mobile-scrim" aria-label="Fermer la navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'visible' : ''}`}>
      <Link className="brand" to="/" onClick={() => setMobileNav(false)}><span className="brand-symbol"><Library size={27} strokeWidth={1.5} /></span><span>Bibliothèque<span>UNIVERSITAIRE</span></span></Link>
      <button className="mobile-close icon-button" aria-label="Fermer le menu" onClick={() => setMobileNav(false)}><X size={22} /></button>
      <div className="sidebar-rule" />
      <div className="nav-section-label">EXPLORER</div>
      <nav aria-label="Navigation principale">{navItem('/', 'Catalogue', BookOpen, true)}{navItem('/recommandations', 'Pour vous', Sparkles)}</nav>
      {user?.role === 'STUDENT' && <><div className="nav-section-label">MON ESPACE</div><nav aria-label="Espace étudiant">{navItem('/espace', 'Tableau de bord', LayoutDashboard)}{navItem('/demandes', 'Mes demandes', Bookmark)}{navItem('/emprunts', 'Mes emprunts', CalendarDays)}{navItem('/acquisitions', 'Proposer un ouvrage', ClipboardList)}{navItem('/sanctions', 'Mes sanctions', ShieldCheck)}</nav></>}
      {staff && <><div className="nav-section-label">BIBLIOTHÈQUE</div><nav aria-label="Gestion de la bibliothèque">{navItem('/gestion', 'Tableau de bord', LayoutDashboard, true)}{navItem('/gestion/catalogue', 'Livres & exemplaires', Library)}{navItem('/gestion/guichet', 'Guichet & circulation', ScanLine)}{navItem('/gestion/acquisitions', 'Acquisitions', ClipboardList)}{navItem('/gestion/sanctions', 'Sanctions', ShieldCheck)}</nav></>}
      {user?.role === 'ADMIN' && <><div className="nav-section-label">ADMINISTRATION</div><nav>{navItem('/administration', 'Paramètres & accès', Settings2)}</nav></>}
      <div className="sidebar-bottom"><div className="library-note"><span className="note-icon"><GraduationCap size={23} strokeWidth={1.4} /></span><strong>Un lieu. Mille perspectives.</strong><p>Les savoirs se rencontrent dans votre bibliothèque.</p><button onClick={() => setHelp(true)}>Comment emprunter <ArrowUpRight size={15} /></button></div><button className="sidebar-help" onClick={() => setHelp(true)}><CircleHelp size={17} />Aide & informations</button><div className="university-signature">Université Sidi Mohamed<br />Ben Abdellah · Fès</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" aria-label="Ouvrir la navigation" onClick={() => setMobileNav(true)}><Menu size={23} /></button><span className="university-top">Université Sidi Mohamed Ben Abdellah</span><span className="topbar-divider" /><span className="topbar-context">Portail documentaire</span></div><div className="topbar-right">{session?.demo && <span className="demo-badge"><i />Démonstration</span>}{user ? <><Link className="notification-button" to="/notifications" aria-label={`Notifications${unread ? `, ${unread} non lues` : ''}`}><Bell size={20} />{unread > 0 && <span>{unread > 9 ? '9+' : unread}</span>}</Link><span className="topbar-divider" /><div className="account"><span className="avatar">{user.name.split(' ').map(p => p[0]).slice(0, 2).join('')}</span><span><strong>{user.name}</strong><small>{labels[user.role]}</small></span></div><button className="icon-button logout" title="Se déconnecter" aria-label="Se déconnecter" onClick={async () => { try { await logout(); navigate('/'); } catch (e) { notify((e as Error).message, 'error'); } }}><LogOut size={17} /></button></> : <Link className="button small primary" to="/connexion">Se connecter <ArrowUpRight size={16} /></Link>}</div></header>
      {session?.demo && <div className="demo-strip">Environnement de démonstration · Données fictives · Vérification universitaire simulée.</div>}
      {user?.role === 'STUDENT' && !user.student?.verified && <div className="verification-strip"><ShieldCheck size={18} /><span>Votre compte doit être vérifié avant votre premier emprunt.</span><Link to="/verification">Scanner ma carte <ArrowUpRight size={15} /></Link></div>}
      <main id="main-content" className="page-content"><Outlet /></main>
      <footer className="footer"><span>Bibliothèque universitaire · USMBA</span><span>Des livres physiques. Des idées sans limites.</span><button onClick={() => setHelp(true)}>Informations pratiques <ArrowUpRight size={13} /></button></footer>
    </div>
    <Modal open={help} onOpenChange={setHelp} title="Emprunter, simplement" description="La plateforme organise la circulation des livres physiques de votre bibliothèque."><ol className="help-steps"><li><strong>Trouvez votre ouvrage</strong><p>Explorez le catalogue et consultez les exemplaires disponibles.</p></li><li><strong>Demandez un emprunt</strong><p>Connectez-vous avec votre compte Google universitaire vérifié. Le serveur vérifie automatiquement vos droits et réserve un exemplaire.</p></li><li><strong>Récupérez votre livre au guichet</strong><p>Présentez votre carte universitaire avant l’expiration de la réservation. Le bibliothécaire confirme la remise physique.</p></li><li><strong>Rapportez-le à temps</strong><p>Consultez votre date de retour dans « Mes emprunts ». Le retour est enregistré par le bibliothécaire.</p></li></ol><p className="info-box">Aucun livre numérique n’est proposé à la lecture ou au téléchargement.</p></Modal>
  </div>;
}

export default function App() { return <><a className="skip-link" href="#main-content">Aller au contenu</a><Routes><Route element={<Shell />}><Route index element={<Catalogue />} /><Route path="catalogue" element={<Navigate to="/" replace />} /><Route path="ouvrages/:id" element={<BookDetail />} /><Route path="connexion" element={<Login />} /><Route path="recommandations" element={<Recommendations />} /><Route element={<Guard />}><Route path="notifications" element={<Notifications />} /><Route path="verification" element={<Onboarding />} /></Route><Route element={<Guard roles={['STUDENT']} />}><Route path="espace" element={<StudentDashboard />} /><Route path="demandes" element={<Requests />} /><Route path="emprunts" element={<Loans />} /><Route path="sanctions" element={<Sanctions />} /><Route path="acquisitions" element={<Acquisitions />} /></Route><Route element={<Guard roles={['LIBRARIAN', 'ADMIN']} />}><Route path="gestion" element={<StaffDashboard />} /><Route path="gestion/catalogue" element={<Inventory />} /><Route path="gestion/guichet" element={<Counter />} /><Route path="gestion/acquisitions" element={<Acquisitions staff />} /><Route path="gestion/sanctions" element={<StaffSanctions />} /></Route><Route path="administration" element={<Guard roles={['ADMIN']}><Administration /></Guard>} /><Route path="*" element={<Empty title="Cette page n’existe pas"><Link to="/">Retrouver le catalogue</Link></Empty>} /></Route></Routes></>; }
