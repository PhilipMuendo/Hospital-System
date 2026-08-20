import { Tabs } from '../ui/Layout'

/**
 * Deprecated — use `Tabs` from `components/ui`.
 *
 * Adapter over the design system's tabs, which implement the WAI-ARIA pattern
 * (roving focus, arrow-key navigation, one tab stop for the set).
 */
export function TabBar({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
  className?: string
}) {
  return (
    <Tabs
      className={className}
      tabs={tabs.map((t) => ({ id: t, label: t }))}
      active={active}
      onChange={onChange}
    />
  )
}
