import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './print.css'
import { LoginPage } from './pages/LoginPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { PatientsPage } from './pages/PatientsPage.tsx'
import { SchedulingPage } from './pages/SchedulingPage.tsx'
import { PharmacyPage } from './pages/PharmacyPage.tsx'
import { BillingPage } from './pages/BillingPage.tsx'
import { ReportsPage } from './pages/ReportsPage.tsx'
import { DevicesPage } from './pages/DevicesPage.tsx'
import { AuditPage } from './pages/AuditPage.tsx'
import { RequireAuth } from './routes/RequireAuth.tsx'
import { RequireRole } from './routes/RequireRole.tsx'
import { AppLayout } from './routes/AppLayout.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { queryClient } from './lib/queryClient.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/scheduling" element={<SchedulingPage />} />
              <Route path="/pharmacy" element={<PharmacyPage />} />
              <Route path="/reports" element={<ReportsPage />} />

              <Route
                path="/billing"
                element={
                  <RequireRole roles={['BILLING', 'ADMIN']}>
                    <BillingPage />
                  </RequireRole>
                }
              />
              <Route
                path="/devices"
                element={
                  <RequireRole roles={['ADMIN', 'NURSE']}>
                    <DevicesPage />
                  </RequireRole>
                }
              />
              <Route
                path="/audit"
                element={
                  <RequireRole roles={['ADMIN']}>
                    <AuditPage />
                  </RequireRole>
                }
              />

              {/* Unknown path inside the shell — send them somewhere real. */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
