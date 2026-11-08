import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post, setCsrf } from '../services/api';
import type { Session } from '../types';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const AuthContext = createContext<{ session?: Session; loading: boolean; error: Error | null; refresh: () => Promise<void>; logout: () => Promise<void> }>({ loading: true, error: null, refresh: async () => {}, logout: async () => {} });
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['session'], queryFn: async () => { const session = await api<Session>('/auth/me'); setCsrf(session.csrfToken); return session; }, staleTime: 60_000, retry: 1 });
  async function refresh() { await queryClient.invalidateQueries({ queryKey: ['session'] }); }
  async function logout() { await post('/auth/logout'); queryClient.clear(); await refresh(); }
  return <AuthContext.Provider value={{ session: query.data, loading: query.isLoading, error: query.error, refresh, logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);

type Toast = { id: number; message: string; type: 'success' | 'error' };
const ToastContext = createContext<(message: string, type?: 'success' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  function notify(message: string, type: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.random();
    setToasts(current => [...current.slice(-2), { id, message, type }]);
    window.setTimeout(() => setToasts(current => current.filter(t => t.id !== id)), 6500);
  }
  return <ToastContext.Provider value={notify}>{children}<div className="toast-stack" aria-live="polite">{toasts.map(t => <div className={`toast ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'} key={t.id}>{t.type === 'error' ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}<span>{t.message}</span><button aria-label="Fermer la notification" onClick={() => setToasts(current => current.filter(i => i.id !== t.id))}><X size={16} /></button></div>)}</div></ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);
