import React, { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Store, Lock, User, Sparkles, ArrowRight, KeyRound, ShieldAlert } from 'lucide-react';

export default function LoginScreen({ onLogin, onSwitchToOnboarding }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Forced password change state
  const [step, setStep] = useState('login'); // 'login' | 'changePassword'
  const [pendingUser, setPendingUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

  const shellRef = useRef(null);
  const formRef = useRef(null);
  const orbRefs = useRef([]);

  useLayoutEffect(() => {
    const context = gsap.context(() => {
      gsap.fromTo('[data-login-reveal]', { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.75, stagger: 0.1, ease: 'power3.out' });
      orbRefs.current.filter(Boolean).forEach((orb, index) => gsap.to(orb, { x: index % 2 ? -28 : 32, y: index % 2 ? 22 : -26, scale: 1.08, duration: 5 + index, repeat: -1, yoyo: true, ease: 'sine.inOut' }));
    }, shellRef);
    return () => context.revert();
  }, [step]);

  const handleLoginSubmit = async event => {
    event.preventDefault();
    setLoginError('');
    if (!username.trim() || !password) {
      setLoginError('Invalid email or password.');
      return;
    }
    const trimmed = username.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setLoginError('Invalid email or password.');
      return;
    }
    setLoginLoading(true);
    gsap.to(formRef.current, { scale: 0.985, duration: 0.16, yoyo: true, repeat: 1 });
    
    try {
      const result = await window.pharmacoreAPI.login(trimmed, password);
      if (result.success) {
        if (result.mustChangePassword) {
          setPendingUser(result);
          setStep('changePassword');
          setLoginLoading(false);
        } else {
          onLogin({
            username: result.username,
            name: result.name,
            role: result.role,
            pharmacyId: result.pharmacyId,
            pharmacyName: result.pharmacyName,
            branchId: result.branchId,
            canViewAllBranches: result.canViewAllBranches,
            subscription: result.subscription
          });
        }
      } else {
        setLoginError('Invalid email or password.');
        setPassword('');
        setLoginLoading(false);
      }
    } catch {
      setLoginError('Invalid email or password.');
      setLoginLoading(false);
    }
  };

  const handleChangePasswordSubmit = async event => {
    event.preventDefault();
    setChangePasswordError('');
    if (!newPassword || newPassword.length < 8) {
      setChangePasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError('Passwords do not match.');
      return;
    }
    setChangePasswordLoading(true);

    try {
      const res = await window.pharmacoreAPI.changePassword(newPassword);
      if (res.success) {
        onLogin({
          username: pendingUser.username,
          name: pendingUser.name,
          role: pendingUser.role,
          pharmacyId: pendingUser.pharmacyId,
          pharmacyName: pendingUser.pharmacyName,
          branchId: pendingUser.branchId,
          canViewAllBranches: pendingUser.canViewAllBranches,
          subscription: pendingUser.subscription
        });
      } else {
        setChangePasswordError(res.error || 'Failed to update password.');
        setChangePasswordLoading(false);
      }
    } catch (err) {
      setChangePasswordError('An error occurred while setting your new password.');
      setChangePasswordLoading(false);
    }
  };

  return (
    <main ref={shellRef} className="relative grid min-h-screen overflow-hidden bg-[#071d1a] font-body text-white lg:grid-cols-[1.15fr_0.85fr]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={el => orbRefs.current[0] = el} className="absolute -left-24 top-[-8rem] h-96 w-96 rounded-full bg-[#29c487]/25 blur-[105px]" />
        <div ref={el => orbRefs.current[1] = el} className="absolute right-[20%] top-[38%] h-72 w-72 rounded-full bg-[#f3ae4d]/20 blur-[95px]" />
        <div ref={el => orbRefs.current[2] = el} className="absolute -bottom-28 left-[35%] h-80 w-80 rounded-full bg-[#136b9e]/25 blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.45)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.45)_1px,transparent_1px)] [background-size:54px_54px]" />
      </div>

      {/* Left branding */}
      <section className="relative z-10 flex min-h-[44vh] flex-col justify-between p-7 sm:p-12 lg:p-16">
        <div data-login-reveal className="flex items-center">
          <img src="./logo-dark.png" alt="PharmaCore - The Unified Pharmacy Ecosystem" className="h-14 w-auto object-contain drop-shadow-[0_8px_24px_rgba(41,196,135,0.35)]" />
        </div>

        <div className="max-w-xl py-12 lg:py-0">
          <p data-login-reveal className="mb-5 text-[11px] font-mono font-bold uppercase tracking-[.25em] text-[#7be7bd]">
            Your counter, in control
          </p>
          <h1 data-login-reveal className="font-title text-5xl leading-[0.96] tracking-[-.045em] text-white sm:text-6xl xl:text-7xl">
            The calm behind every <span className="text-[#f5bc63]">busy</span> pharmacy.
          </h1>
          <p data-login-reveal className="mt-7 max-w-md text-sm leading-7 text-emerald-50/65">
            A focused cloud workspace for dispensing safely, managing multi-tenant inventory, serving patients quickly, and tracking every sale in real time.
          </p>
        </div>

        <div data-login-reveal className="flex items-center gap-3 text-xs font-medium text-emerald-100/75">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34d399] opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#67e8b4]" />
          </span>
          Secure multi-tenant workstation · Pakistan
        </div>
      </section>

      {/* Right Form Card */}
      <section className="relative z-10 flex items-center justify-center bg-white/95 p-6 text-ink sm:p-12 lg:bg-white">
        <div ref={formRef} data-login-reveal className="w-full max-w-md">
          {step === 'login' ? (
            <>
              <div className="mb-8">
                <p className="text-[10px] font-mono font-bold uppercase tracking-[.24em] text-emerald">Protected access</p>
                <h2 className="mt-2 font-title text-4xl tracking-[-.04em] text-ink">Welcome back.</h2>
                <p className="mt-2 text-sm leading-6 text-ink/55">Sign in to open your pharmacy workstation.</p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-ink/75">Email Address</span>
                  <div className="flex items-center rounded-2xl border border-ink/10 bg-clinical px-4 transition-all focus-within:border-emerald/50 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald/10">
                    <User className="mr-3 h-4 w-4 text-emerald" />
                    <input
                      autoFocus
                      type="email"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      disabled={loginLoading}
                      placeholder="e.g. admin@yourpharmacy.com"
                      className="w-full bg-transparent py-4 text-sm font-medium outline-none placeholder:text-ink/30 disabled:opacity-50"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-ink/75">Password</span>
                  <div className="flex items-center rounded-2xl border border-ink/10 bg-clinical px-4 transition-all focus-within:border-emerald/50 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald/10">
                    <Lock className="mr-3 h-4 w-4 text-emerald" />
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={loginLoading}
                      placeholder="Enter your password"
                      className="w-full bg-transparent py-4 text-sm font-medium outline-none placeholder:text-ink/30 disabled:opacity-50"
                    />
                  </div>
                </label>

                {loginError && (
                  <div className="rounded-xl border border-terracotta/20 bg-terracotta/5 px-4 py-3 text-xs font-medium text-terracotta">
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="group relative mt-2 flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-ink py-4 text-sm font-bold text-white shadow-[0_16px_28px_rgba(16,27,45,.2)] transition-all hover:-translate-y-0.5 hover:bg-emerald disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="absolute inset-y-0 left-[-35%] w-1/3 -skew-x-12 bg-white/15 transition-all duration-700 group-hover:left-[120%]" />
                  {loginLoading ? 'Verifying access…' : 'Enter workspace'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
              </form>

              {/* New Pharmacy Signup Link */}
              {onSwitchToOnboarding && (
                <div className="mt-8 pt-6 border-t border-ink/10 text-center">
                  <p className="text-xs text-ink/60 mb-2">Want to sell with PharmaCore at your pharmacy?</p>
                  <button
                    type="button"
                    onClick={onSwitchToOnboarding}
                    className="w-full py-3 bg-clinical hover:bg-emerald/10 text-emerald font-bold text-xs rounded-2xl border border-emerald/20 transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Register New Pharmacy & Start Free Trial</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Forced Password Change View */}
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-700 text-xs font-bold mb-3">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <span>First Login Security Requirement</span>
                </div>
                <h2 className="font-title text-3xl tracking-[-.04em] text-ink">Set New Password</h2>
                <p className="mt-2 text-sm leading-6 text-ink/60">
                  Welcome, <strong>{pendingUser?.name || pendingUser?.username}</strong>. You must create your personal password before accessing the system.
                </p>
              </div>

              <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-ink/75">New Password (min 8 characters)</span>
                  <div className="flex items-center rounded-2xl border border-ink/10 bg-clinical px-4 transition-all focus-within:border-emerald/50 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald/10">
                    <KeyRound className="mr-3 h-4 w-4 text-emerald" />
                    <input
                      autoFocus
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      disabled={changePasswordLoading}
                      placeholder="Enter new strong password"
                      className="w-full bg-transparent py-4 text-sm font-medium outline-none placeholder:text-ink/30 disabled:opacity-50"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-ink/75">Confirm New Password</span>
                  <div className="flex items-center rounded-2xl border border-ink/10 bg-clinical px-4 transition-all focus-within:border-emerald/50 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald/10">
                    <Lock className="mr-3 h-4 w-4 text-emerald" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      disabled={changePasswordLoading}
                      placeholder="Repeat new password"
                      className="w-full bg-transparent py-4 text-sm font-medium outline-none placeholder:text-ink/30 disabled:opacity-50"
                    />
                  </div>
                </label>

                {changePasswordError && (
                  <div className="rounded-xl border border-terracotta/20 bg-terracotta/5 px-4 py-3 text-xs font-medium text-terracotta">
                    {changePasswordError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={changePasswordLoading}
                  className="group relative mt-2 flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-emerald py-4 text-sm font-bold text-white shadow-[0_16px_28px_rgba(41,196,135,.2)] transition-all hover:-translate-y-0.5 hover:bg-emerald/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {changePasswordLoading ? 'Updating credentials…' : 'Save Password & Continue'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-[10px] font-mono uppercase tracking-[.16em] text-ink/35">
            PharmaCore Cloud · secure multi-tenant SaaS
          </p>
        </div>
      </section>
    </main>
  );
}
