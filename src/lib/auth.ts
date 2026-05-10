import { auth } from '@clerk/nextjs/server';

export async function getCurrentUser() {
  const { userId, orgId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized: no Clerk session');
  }
  return { userId, orgId: orgId ?? null };
}

export async function getCurrentUserOrNull() {
  const { userId, orgId } = await auth();
  return userId ? { userId, orgId: orgId ?? null } : null;
}
