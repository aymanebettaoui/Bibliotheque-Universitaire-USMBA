export type Role = 'STUDENT' | 'LIBRARIAN' | 'ADMIN';
export interface User { id: string; name: string; email: string; role: Role; active: boolean; student: null | { id: string; studentNumber: string | null; verified: boolean } }
export interface Session { user: User | null; csrfToken: string; demo: boolean; googleClientId: string | null; universityConfigured: boolean }
export interface Named { id: string; name: string }
export interface Copy { id: string; barcode: string; status: string; condition: string; book?: Book }
export interface Book { id: string; title: string; isbn?: string; publisher?: string; year?: number; description?: string; priceDh?: string; coverColor?: string; coverUrl?: string; authors: Named[]; categories: Named[]; copies?: Copy[]; availableCount: number; totalCount: number; loanedCount: number; reason?: string; archived?: boolean }
export interface BookList { items: Book[]; total: number; page: number; pageSize: number; categories?: Named[] }
export interface Reservation { id: string; status: string; expiresAt: string; copy: Copy }
export interface BorrowRequest { id: string; status: string; createdAt: string; reason?: string; book: Book; reservation?: Reservation; student?: { studentNumber: string; user: User } }
export interface Loan { id: string; status: string; handedAt: string; dueAt: string; returnedAt?: string; copy: Copy & { book: Book }; student?: { studentNumber: string; user: User } }
export interface Sanction { id: string; type: string; status: string; reason: string; amountDh?: string; startsAt: string; endsAt?: string; createdAt: string; student?: { studentNumber: string; user: User } }
export interface Acquisition { id: string; title: string; author: string; category: string; reason?: string; referenceUrl?: string; status: string; comment?: string; createdAt: string; student?: { user: User } }
export interface Notice { id: string; type: string; content: string; title?: string; createdAt: string; readAt?: string }
export type List<T> = { items: T[] };
