import type { NextFunction, Request, Response } from 'express'
import { SESSION_COOKIE, verifySession } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { ApiError } from './errorHandler.js'

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE]
    if (!token) throw new ApiError(401, 'Not authenticated')

    const payload = verifySession(token)
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user || !user.active) throw new ApiError(401, 'Not authenticated')

    req.user = { id: user.id, role: user.role }
    next()
  } catch {
    next(new ApiError(401, 'Not authenticated'))
  }
}
