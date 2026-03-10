import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { VoiceCommandProvider } from './context/VoiceCommandContext';
import ProtectedRoute from './components/ProtectedRoute';

// Auth pages
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';

// App pages
import DashboardPage from './pages/DashboardPage';
import VisionAssistPage from './pages/VisionAssistPage';
import SpeechAssistPage from './pages/SpeechAssistPage';
import GestureAssistPage from './pages/GestureAssistPage';
import NavigationPage from './pages/NavigationPage';
import SettingsPage from './pages/SettingsPage';
import EmergencyPage from './pages/EmergencyPage';
import LogsPage from './pages/LogsPage';

const App = () => (
  <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <VoiceCommandProvider>
        {/* Global toast notifications */}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              fontSize: '0.875rem',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            },
          }}
        />

        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected routes */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/vision" element={<ProtectedRoute><VisionAssistPage /></ProtectedRoute>} />
          <Route path="/speech" element={<ProtectedRoute><SpeechAssistPage /></ProtectedRoute>} />
          <Route path="/gesture" element={<ProtectedRoute><GestureAssistPage /></ProtectedRoute>} />
          <Route path="/navigation" element={<ProtectedRoute><NavigationPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/emergency" element={<ProtectedRoute><EmergencyPage /></ProtectedRoute>} />
          <Route path="/logs" element={<ProtectedRoute><LogsPage /></ProtectedRoute>} />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </VoiceCommandProvider>
      </BrowserRouter>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
