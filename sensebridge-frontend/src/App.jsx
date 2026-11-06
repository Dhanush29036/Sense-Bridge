/**
 * App.jsx — wrapped with MultimodalFusionProvider
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import { AuthProvider }               from './context/AuthContext';
import { ThemeProvider }              from './context/ThemeContext';
import { VoiceCommandProvider }       from './context/VoiceCommandContext';
import { MultimodalFusionProvider }   from './context/MultimodalFusionContext';
import ProtectedRoute from './components/ProtectedRoute';

// Auth pages
import LoginPage    from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';

// App pages
import DashboardPage    from './pages/DashboardPage';
import VisionAssistPage from './pages/VisionAssistPage';
import SpeechAssistPage from './pages/SpeechAssistPage';
import GestureAssistPage from './pages/GestureAssistPage';
import NavigationPage   from './pages/NavigationPage';
import SettingsPage     from './pages/SettingsPage';
import EmergencyPage    from './pages/EmergencyPage';
import LogsPage         from './pages/LogsPage';
import AdminPage        from './pages/AdminPage';
import ResearchDashboard from './pages/ResearchDashboard';
import MultimodalPage    from './pages/MultimodalPage';

const App = () => (
  <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <MultimodalFusionProvider>
          <VoiceCommandProvider>
            <Toaster
              position="top-center"
              toastOptions={{
                duration: 3200,
                style: {
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  fontSize: '0.875rem',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 500,
                  maxWidth: '380px',
                },
              }}
            />

            <Routes>
              {/* Public routes */}
              <Route path="/login"    element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Protected routes */}
              <Route path="/dashboard"  element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
              <Route path="/vision"     element={<ProtectedRoute><VisionAssistPage /></ProtectedRoute>} />
              <Route path="/speech"     element={<ProtectedRoute><SpeechAssistPage /></ProtectedRoute>} />
              <Route path="/gesture"    element={<ProtectedRoute><GestureAssistPage /></ProtectedRoute>} />
              <Route path="/navigation" element={<ProtectedRoute><NavigationPage /></ProtectedRoute>} />
              <Route path="/settings"   element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/emergency"  element={<ProtectedRoute><EmergencyPage /></ProtectedRoute>} />
              <Route path="/logs"       element={<ProtectedRoute><LogsPage /></ProtectedRoute>} />
              <Route path="/admin"      element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
              <Route path="/research"   element={<ProtectedRoute><ResearchDashboard /></ProtectedRoute>} />
              <Route path="/multimodal" element={<ProtectedRoute><MultimodalPage /></ProtectedRoute>} />

              {/* Default redirect */}
              <Route path="/"  element={<Navigate to="/dashboard" replace />} />
              <Route path="*"  element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </VoiceCommandProvider>
        </MultimodalFusionProvider>
      </BrowserRouter>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
