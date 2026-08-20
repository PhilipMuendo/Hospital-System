import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './print.css'
import { LoginPage } from './pages/LoginPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { RequireAuth } from './routes/RequireAuth.tsx'
import { RequireRole } from './routes/RequireRole.tsx'
import { AppLayout } from './routes/AppLayout.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { queryClient } from './lib/queryClient.ts'
import { ToastProvider, LoadingPanel } from './components/ui'
import { startOfflineSync } from './lib/offline.ts'

/**
 * Code splitting.
 *
 * Login and the dashboard are eager — every session starts there. Everything
 * else loads on demand, because no user visits all seventeen screens: a
 * pharmacist never opens radiology, a nurse never opens the audit trail.
 *
 * This matters more here than on a typical web app. Hospital workstations are
 * old and connections are slow, and the entire bundle was previously shipped
 * to everyone on first paint.
 */
const PatientsPage = lazy(() => import('./pages/PatientsPage.tsx').then((m) => ({ default: m.PatientsPage })))
const SchedulingPage = lazy(() => import('./pages/SchedulingPage.tsx').then((m) => ({ default: m.SchedulingPage })))
const PharmacyPage = lazy(() => import('./pages/PharmacyPage.tsx').then((m) => ({ default: m.PharmacyPage })))
const BillingPage = lazy(() => import('./pages/BillingPage.tsx').then((m) => ({ default: m.BillingPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage.tsx').then((m) => ({ default: m.ReportsPage })))
const DevicesPage = lazy(() => import('./pages/DevicesPage.tsx').then((m) => ({ default: m.DevicesPage })))
const LabPage = lazy(() => import('./pages/LabPage.tsx').then((m) => ({ default: m.LabPage })))
const RadiologyPage = lazy(() => import('./pages/RadiologyPage.tsx').then((m) => ({ default: m.RadiologyPage })))
const CashierPage = lazy(() => import('./pages/CashierPage.tsx').then((m) => ({ default: m.CashierPage })))
const WardPage = lazy(() => import('./pages/WardPage.tsx').then((m) => ({ default: m.WardPage })))
const ReceptionPage = lazy(() => import('./pages/ReceptionPage.tsx').then((m) => ({ default: m.ReceptionPage })))
const TriagePage = lazy(() => import('./pages/TriagePage.tsx').then((m) => ({ default: m.TriagePage })))
const ConsultationPage = lazy(() => import('./pages/ConsultationPage.tsx').then((m) => ({ default: m.ConsultationPage })))
const DisplayBoardPage = lazy(() => import('./pages/DisplayBoardPage.tsx').then((m) => ({ default: m.DisplayBoardPage })))
const AuditPage = lazy(() => import('./pages/AuditPage.tsx').then((m) => ({ default: m.AuditPage })))

/** Named, so a slow chunk says which screen is loading rather than spinning blankly. */
function Loading({ label }: { label: string }) {
  return (
    <div className="p-4">
      <LoadingPanel label={label} />
    </div>
  )
}

// Keep the shell available and flush queued clinical records on reconnect.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration must not break the app; it only means no
      // offline shell on this device.
    })
  })
}
startOfflineSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Public: this drives a television, there is nobody to log it in. */}
            <Route path="/board" element={<Suspense fallback={<Loading label="Loading board" />}>
                        <DisplayBoardPage />
                      </Suspense>} />

            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route
                path="/reception"
                element={
                  <RequireRole roles={['ADMIN', 'NURSE', 'BILLING']}>
                    <Suspense fallback={<Loading label="Loading reception" />}>
                        <ReceptionPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route
                path="/triage"
                element={
                  <RequireRole roles={['ADMIN', 'NURSE', 'PHYSICIAN']}>
                    <Suspense fallback={<Loading label="Loading triage" />}>
                        <TriagePage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route
                path="/consultation"
                element={
                  <RequireRole roles={['ADMIN', 'PHYSICIAN', 'NURSE']}>
                    <Suspense fallback={<Loading label="Loading consulting room" />}>
                        <ConsultationPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route
                path="/ward"
                element={
                  <RequireRole roles={['ADMIN', 'NURSE', 'PHYSICIAN']}>
                    <Suspense fallback={<Loading label="Loading ward board" />}>
                        <WardPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route path="/patients" element={<Suspense fallback={<Loading label="Loading patient record" />}>
                        <PatientsPage />
                      </Suspense>} />
              <Route
                path="/lab"
                element={
                  <RequireRole roles={['ADMIN', 'LAB_TECH', 'PHYSICIAN']}>
                    <Suspense fallback={<Loading label="Loading laboratory" />}>
                        <LabPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route path="/scheduling" element={<Suspense fallback={<Loading label="Loading theatre schedule" />}>
                        <SchedulingPage />
                      </Suspense>} />
              <Route path="/pharmacy" element={<Suspense fallback={<Loading label="Loading pharmacy" />}>
                        <PharmacyPage />
                      </Suspense>} />
              <Route path="/reports" element={<Suspense fallback={<Loading label="Loading reports" />}>
                        <ReportsPage />
                      </Suspense>} />

              <Route
                path="/radiology"
                element={
                  <RequireRole roles={['ADMIN', 'RADIOGRAPHER', 'PHYSICIAN']}>
                    <Suspense fallback={<Loading label="Loading radiology" />}>
                        <RadiologyPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route
                path="/cashier"
                element={
                  <RequireRole roles={['ADMIN', 'BILLING']}>
                    <Suspense fallback={<Loading label="Loading cash office" />}>
                        <CashierPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route
                path="/billing"
                element={
                  <RequireRole roles={['BILLING', 'ADMIN']}>
                    <Suspense fallback={<Loading label="Loading billing" />}>
                        <BillingPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route
                path="/devices"
                element={
                  <RequireRole roles={['ADMIN', 'NURSE']}>
                    <Suspense fallback={<Loading label="Loading devices" />}>
                        <DevicesPage />
                      </Suspense>
                  </RequireRole>
                }
              />
              <Route
                path="/audit"
                element={
                  <RequireRole roles={['ADMIN']}>
                    <Suspense fallback={<Loading label="Loading audit trail" />}>
                        <AuditPage />
                      </Suspense>
                  </RequireRole>
                }
              />

              {/* Unknown path inside the shell — send them somewhere real. */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
