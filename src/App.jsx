import React, { useState, useEffect } from 'react';
import LoginScreen       from './components/LoginScreen.jsx';
import OnboardingScreen  from './components/OnboardingScreen.jsx';
import Dashboard         from './components/Dashboard.jsx';
import LoadingDashboard  from './components/LoadingDashboard.jsx';

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

  if (authState === 'checking') {
    return (
      <div className="min-h-screen bg-[#071d1a] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald/30 border-t-emerald rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authState === 'onboarding') {
    return (
      <OnboardingScreen
        onLogin={handleLogin}
        onSwitchToLogin={() => setAuthState('login')}
      />
    );
  }

  if (authState === 'login') {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onSwitchToOnboarding={() => setAuthState('onboarding')}
      />
    );
  }

  if (authState === 'loading-dashboard') {
    return <LoadingDashboard onComplete={() => setAuthState('dashboard')} />;
  }

  return <Dashboard user={currentUser} onLogout={handleLogout} />;
}
