export function hasAuthIdentityChanged(
  previousUserId: string | null,
  previousTenantId: string | null,
  nextUserId: string | null,
  nextTenantId: string | null,
): boolean {
  const hadIdentity = previousUserId !== null || previousTenantId !== null
  return hadIdentity && (
    previousUserId !== nextUserId || previousTenantId !== nextTenantId
  )
}
