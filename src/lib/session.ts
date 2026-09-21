import type { AuthSession, User } from '../types';

/** The signed-in staff member, or null for customers and signed-out visitors. */
export function getCurrentUser(): User | null {
  try {
    const session = JSON.parse(localStorage.getItem('hij_auth_session') || 'null') as AuthSession | null;
    return session?.type === 'internal' ? session.user : null;
  } catch {
    return null;
  }
}
