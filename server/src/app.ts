import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { errorHandler } from './middleware/errorHandler.js'
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

export function createApp() {
  const app = express()

  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  )
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

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

  app.use(errorHandler)

  return app
}
