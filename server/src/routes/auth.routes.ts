import { Router } from 'express'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  SESSION_COOKIE,
  hashPassword,
  sessionCookieOptions,
  signSession,
  verifyPassword,
} from '../lib/auth.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'

export const authRoutes = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRoutes.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.active) {
      // The email is recorded, never the password attempt — a failed-login log
      // that captures near-miss passwords is a credential store.
      audit(req, {
        action: 'LOGIN_FAILED',
        entity: 'User',
        actorLabel: email,
        meta: { reason: user ? 'account inactive' : 'unknown email' },
      })
      throw new ApiError(401, 'Invalid email or password')
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      audit(req, {
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        actorId: user.id,
        actorRole: user.role,
        actorLabel: `${user.name} <${user.email}>`,
        meta: { reason: 'bad password' },
      })
      throw new ApiError(401, 'Invalid email or password')
    }

    const token = signSession({ sub: user.id, role: user.role })
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions)
    audit(req, {
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorRole: user.role,
      actorLabel: `${user.name} <${user.email}>`,
    })
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role })
  } catch (err) {
    next(err)
  }
})

authRoutes.post('/logout', requireAuth, (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  audit(req, { action: 'LOGOUT', entity: 'User', entityId: req.user!.id })
  res.status(204).end()
})

authRoutes.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } })
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role })
  } catch (err) {
    next(err)
  }
})

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'PHYSICIAN', 'NURSE', 'BILLING', 'PHARMACIST']),
})

authRoutes.post('/users', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body)
    const passwordHash = await hashPassword(data.password)
    const user = await prisma.user.create({
      data: { email: data.email, name: data.name, role: data.role, passwordHash },
    })
    audit(req, {
      entity: 'User',
      entityId: user.id,
      meta: { created: { email: user.email, name: user.name, role: user.role } },
    })
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role })
  } catch (err) {
    next(err)
  }
})

authRoutes.get('/users', requireAuth, requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: { name: 'asc' },
    })
    res.json(users)
  } catch (err) {
    next(err)
  }
})

// A lightweight staff directory (names + roles only, no email/active) any
// authenticated user can query — needed so e.g. a PHYSICIAN booking a
// surgery can pick a surgeon without the admin-only /users endpoint.
authRoutes.get('/staff', requireAuth, async (req, res, next) => {
  try {
    const role = typeof req.query.role === 'string' ? req.query.role : undefined
    const staff = await prisma.user.findMany({
      where: { active: true, ...(role ? { role: role as Role } : {}) },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    })
    res.json(staff)
  } catch (err) {
    next(err)
  }
})
