import React, { useState, useEffect } from 'react';
import LoginScreen       from './components/LoginScreen.jsx';
import OnboardingScreen  from './components/OnboardingScreen.jsx';
import Dashboard         from './components/Dashboard.jsx';
import LoadingDashboard  from './components/LoadingDashboard.jsx';
import ErrorBoundary     from './components/ErrorBoundary.jsx';

/**
 * Root application component (Multi-Tenant SaaS).
 */
export default function App() {
  const [authState, setAuthState] = useState('checking'); 
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    window.pharmacoreAPI.getIsFirstRun()
      .then(isFirstRun => {
        setAuthState(isFirstRun ? 'onboarding' : 'login');
      })
      .catch(err => {
        console.error('Failed to check first run state:', err);
        setAuthState('login');
      });
  }, []);

  function handleLogin(user) {
    setCurrentUser(user);
    setAuthState('loading-dashboard');
  }

  function handleLogout() {
    setCurrentUser(null);
    setAuthState('login');
  }

  return (
    <ErrorBoundary>
      {authState === 'checking' && (
        <div className="min-h-screen bg-[#071d1a] flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-emerald/30 border-t-emerald rounded-full animate-spin"></div>
        </div>
      )}

      {authState === 'onboarding' && (
        <OnboardingScreen
          onLogin={handleLogin}
          onSwitchToLogin={() => setAuthState('login')}
        />
      )}

      {authState === 'login' && (
        <LoginScreen
          onLogin={handleLogin}
          onSwitchToOnboarding={() => setAuthState('onboarding')}
        />
      )}

      {authState === 'loading-dashboard' && (
        <LoadingDashboard onComplete={() => setAuthState('dashboard')} />
      )}

      {authState === 'dashboard' && (
        <Dashboard user={currentUser} onLogout={handleLogout} />
      )}
    </ErrorBoundary>
  );
}
