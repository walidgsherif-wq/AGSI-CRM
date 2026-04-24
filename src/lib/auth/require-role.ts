import { notFound } from 'next/navigation';
import type { Role } from '@/types/domain';
import { getCurrentUser } from './get-user';

/**
 * Server-component guard. Call at the top of any page that should be
 * restricted to a subset of roles. Returns the current user when allowed;
 * calls `notFound()` otherwise so the route 404s rather than leaking its
 * existence.
 */
export async function requireRole(allowed: Role[]) {
  const user = await getCurrentUser();
  if (!allowed.includes(user.role)) {
    notFound();
  }
  return user;
}
