/**
 * The design system. Everything a screen needs should come from here.
 *
 * If a page is reaching past this barrel to hand-roll a control, that is a
 * gap in the system — fill it here rather than styling in place, which is how
 * the previous UI ended up with 14 distinct arbitrary font sizes and the same
 * input class string copy-pasted across eight files.
 */
export { Button, IconButton } from './Button'
export { Field, TextInput, Select, TextArea, SearchInput, ChoiceGroup } from './Field'
export { StatusChip, TriageBadge, ClinicalValue, type StatusTone } from './Status'
export {
  DataTable,
  THead,
  TBody,
  TR,
  TH,
  TD,
  TDPrimary,
  SortableTH,
  EmptyState,
  LoadingRows,
} from './Table'
export { PatientHeader, PatientConfirmLine, type PatientContext } from './PatientHeader'
export { Panel, PageHeader, StatTile, Alert, Dialog, ConfirmDialog, Tabs } from './Layout'
export { ToastProvider, useToast, Spinner, LoadingPanel, type Toast } from './Toast'
export { ReasonDialog } from './ReasonDialog'
