import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { errorHandler } from './middleware/errorHandler.js'
import { auditLog } from './middleware/auditLog.js'
import { generalLimiter, loginLimiter } from './middleware/security.js'
import { authRoutes } from './routes/auth.routes.js'
import { patientsRoutes } from './routes/patients.routes.js'
import { vitalsRoutes } from './routes/vitals.routes.js'
import { labsRoutes } from './routes/labs.routes.js'
import { imagingRoutes } from './routes/imaging.routes.js'
import { billingRoutes } from './routes/billing.routes.js'
import { surgeriesRoutes } from './routes/surgeries.routes.js'
import { wardsRoutes } from './routes/wards.routes.js'
import { dashboardRoutes } from './routes/dashboard.routes.js'
import { alertsRoutes } from './routes/alerts.routes.js'
import { auditRoutes } from './routes/audit.routes.js'
import { mpesaRoutes } from './routes/mpesa.routes.js'
import { pharmacyRoutes } from './routes/pharmacy.routes.js'
import { reportsRoutes } from './routes/reports.routes.js'
import { devicesRoutes } from './routes/devices.routes.js'
import { queueRoutes } from './routes/queue.routes.js'
import { labRoutes } from './routes/lab.routes.js'
import { nursingRoutes } from './routes/nursing.routes.js'
import { imagingOrdersRoutes } from './routes/imaging-orders.routes.js'
import { cashierRoutes } from './routes/cashier.routes.js'

/**
 * Origins allowed to make credentialed requests. Reflecting an arbitrary
 * origin while allowing credentials — the previous behaviour — lets any site
 * the user visits drive this API with their session cookie.
 */
function allowedOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (configured.length > 0) return configured
  if (process.env.NODE_ENV === 'production') return []
  return ['http://localhost:5173', 'http://127.0.0.1:5173']
}

export function createApp() {
  const app = express()

  // Behind a reverse proxy in production, so x-forwarded-for is what the
  // audit log should record as the client address.
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1)
  }

  // Behind a reverse proxy, req.ip must come from X-Forwarded-For or every
  // client looks like the proxy and rate limiting collapses into one bucket.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1))
  // Do not advertise the stack.
  app.disable('x-powered-by')

  app.use(
    helmet({
      // The API serves JSON, not documents; a restrictive CSP here is
      // meaningless and the SPA is served separately.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  )

  const origins = allowedOrigins()
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers send no Origin header.
        if (!origin) return callback(null, true)
        callback(null, origins.includes(origin))
      },
      credentials: true,
    }),
  )
  // Cap the body. Nothing this API accepts is large, and an unbounded parser
  // is free memory pressure for anyone who can reach it.
  app.use(express.json({ limit: '256kb' }))
  app.use(generalLimiter)
  app.use(cookieParser())

  // Before the routers, so it also observes requests that 401 or 403.
  app.use(auditLog)

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  // Tighter limit on the credential endpoint specifically.
  app.use('/api/auth/login', loginLimiter)
  app.use('/api/auth', authRoutes)
  app.use('/api', patientsRoutes)
  app.use('/api', vitalsRoutes)
  app.use('/api', labsRoutes)
  app.use('/api', imagingRoutes)
  app.use('/api', billingRoutes)
  app.use('/api', surgeriesRoutes)
  app.use('/api', wardsRoutes)
  app.use('/api', dashboardRoutes)
  app.use('/api', alertsRoutes)
  app.use('/api', auditRoutes)
  app.use('/api', mpesaRoutes)
  app.use('/api', pharmacyRoutes)
  app.use('/api', reportsRoutes)
  app.use('/api', devicesRoutes)
  app.use('/api', queueRoutes)
  app.use('/api', labRoutes)
  app.use('/api', nursingRoutes)
  app.use('/api', imagingOrdersRoutes)
  app.use('/api', cashierRoutes)

  app.use(errorHandler)

  return app
}
