import type { Role } from '../lib/types'

export interface NavItem {
  to: string
  label: string
  icon: string
  /** Omitted means every signed-in role sees it. */
  roles?: Role[]
}

/**
 * Single source of truth for the sidebar and for route guarding, so a link is
 * never rendered to a page the API would refuse. The icon is a key into
 * NavIcon rather than a component, to keep this file importable from tests.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'ring' },
  { to: '/reception', label: 'Reception', icon: 'desk', roles: ['ADMIN', 'NURSE', 'BILLING'] },
  { to: '/triage', label: 'Triage', icon: 'triage', roles: ['ADMIN', 'NURSE', 'PHYSICIAN'] },
  { to: '/consultation', label: 'Consulting', icon: 'stethoscope', roles: ['ADMIN', 'PHYSICIAN', 'NURSE'] },
  { to: '/patients', label: 'Patients', icon: 'pulse' },
  { to: '/scheduling', label: 'Scheduling', icon: 'timeline' },
  { to: '/pharmacy', label: 'Pharmacy', icon: 'pill' },
  { to: '/billing', label: 'Billing', icon: 'ledger', roles: ['BILLING', 'ADMIN'] },
  { to: '/reports', label: 'Reports', icon: 'report' },
  { to: '/devices', label: 'Devices', icon: 'device', roles: ['ADMIN', 'NURSE'] },
  { to: '/audit', label: 'Audit Trail', icon: 'shield', roles: ['ADMIN'] },
]

export function navItemsFor(role: Role | undefined): NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role))
}

export function canAccess(path: string, role: Role | undefined): boolean {
  if (!role) return false
  const item = NAV_ITEMS.find((i) => path.startsWith(i.to))
  if (!item) return true
  return !item.roles || item.roles.includes(role)
}
