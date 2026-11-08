let csrfToken = '';
export const setCsrf = (value?: string) => { csrfToken = value || ''; };
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.method && !['GET', 'HEAD'].includes(options.method)) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.error?.code || 'HTTP_ERROR', data?.error?.message || 'Le service est momentanément indisponible.');
  if (typeof data?.csrfToken === 'string') setCsrf(data.csrfToken);
  return data as T;
}
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body || {}) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const date = (value?: string | null, withTime = false) => value ? new Intl.DateTimeFormat('fr-MA', { timeZone: 'Africa/Casablanca', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value)) : '—';
export const money = (value?: string | number) => new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD' }).format(Number(value || 0));
export const labels: Record<string, string> = {
  STUDENT: 'Étudiant', LIBRARIAN: 'Bibliothécaire', ADMIN: 'Administrateur',
  AVAILABLE: 'Disponible', RESERVED: 'Réservé', LOANED: 'Emprunté', WITHDRAWN: 'Retiré',
  GOOD: 'Bon état', DAMAGED: 'Endommagé', LOST: 'Perdu',
  PENDING: 'En attente', ACCEPTED: 'Acceptée', REFUSED: 'Refusée', EXPIRED: 'Expirée', CANCELLED: 'Annulée',
  ACTIVE: 'En cours', COLLECTED: 'Récupérée', OVERDUE: 'En retard', CLOSED: 'Terminé',
  WARNING: 'Avertissement', SUSPENSION: 'Suspension', BAN: 'Interdiction', FINE: 'Pénalité', PAID: 'Réglée', REVOKED: 'Révoquée',
  SUBMITTED: 'Soumise', REVIEW: 'En étude', ACQUIRED: 'Acquise', MINOR: 'Légère', SEVERE: 'Grave',
  REVIEW_REQUESTED: 'Contrôle demandé', VERIFIED: 'Vérifié', UNREADABLE: 'Lecture impossible',
};
