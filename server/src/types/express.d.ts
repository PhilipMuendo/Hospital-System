import type { Role } from '@prisma/client'
import type { AuditDraft } from '../lib/audit.js'

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; name: string; email: string }
      /** Populated by routes, consumed by the auditLog middleware on finish. */
      audit?: AuditDraft
    }
  }
}

export {}
