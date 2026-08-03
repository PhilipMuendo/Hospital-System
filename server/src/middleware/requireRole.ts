import type { NextFunction, Request, Response } from 'express'
import type { Role } from '@prisma/client'
import { ApiError } from './errorHandler.js'

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new ApiError(403, 'Insufficient permissions'))
      return
    }
    next()
  }
}
