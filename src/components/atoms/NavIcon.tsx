/** Icon set for the sidebar, keyed by the `icon` field on NAV_ITEMS. */
export function NavIcon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none' } as const

  switch (name) {
    case 'ring':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="30 40" />
        </svg>
      )
    case 'pulse':
      return (
        <svg {...common}>
          <path
            d="M2 9h3l1.6-4.5L9.6 13 12 6l1.2 3H16"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'timeline':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="14" height="2.4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
          <rect x="2" y="11.6" width="9" height="2.4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )
    case 'pill':
      return (
        <svg {...common}>
          <rect
            x="2.2"
            y="6"
            width="13.6"
            height="6"
            rx="3"
            transform="rotate(-35 9 9)"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M6.6 11.4 11.4 6.6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )
    case 'desk':
      return (
        <svg {...common}>
          <path d="M2 7.5h14M3.5 7.5V14M14.5 7.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M4 7.5 6 4h6l2 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    case 'triage':
      return (
        <svg {...common}>
          <path d="M9 2.5v13M2.5 9h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'stethoscope':
      return (
        <svg {...common}>
          <path d="M4.5 2.5v4a3 3 0 0 0 6 0v-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M7.5 9.4v2.1a3.6 3.6 0 0 0 7.2 0v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="14.7" cy="9" r="1.6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )
    case 'ledger':
      return (
        <svg {...common}>
          <rect x="3" y="2.5" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 6.5h6M6 9.5h6M6 12.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
    case 'report':
      return (
        <svg {...common}>
          <path
            d="M4.5 2.5h6L14 6v9.5H4.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M10 2.5V6h3.6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M7 9.5h4M7 12h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
    case 'device':
      return (
        <svg {...common}>
          <rect x="2.2" y="3.5" width="13.6" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 8.2h1.8l1-2 1.4 3.6 1-1.6H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 15.2h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...common}>
          <path
            d="M9 2.2 14.5 4.5v4.2c0 3.3-2.3 5.7-5.5 7-3.2-1.3-5.5-3.7-5.5-7V4.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="m6.6 8.8 1.7 1.7 3.2-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )
  }
}
