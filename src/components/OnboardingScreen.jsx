import React, { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { 
  Building2, 
  ShieldCheck, 
  Sparkles, 
  ArrowRight, 
  Check, 
  Store, 
  Lock, 
  User, 
  Phone, 
  Mail, 
  MapPin,
  CheckCircle2,
  ChevronRight
} from 'lucide-react';

export default function OnboardingScreen({ onLogin, onSwitchToLogin }) {
  const [step, setStep] = useState(1); // 1: Pharmacy Info, 2: Owner Account, 3: Branch & Plan
  
  // Pharmacy Details
  const [pharmacyName, setPharmacyName] = useState('');
  const [city, setCity] = useState('Karachi');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  // Owner Details
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Setup & Plan
  const [branchName, setBranchName] = useState('Main Branch');
  const [planTier, setPlanTier] = useState('trial'); // trial, starter, professional

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const containerRef = useRef(null);
  const orbRefs = useRef([]);

  useEffect(() => {
    orbRefs.current.filter(Boolean).forEach((orb, i) => {
      gsap.to(orb, {
        x: i % 2 ? -25 : 30,
        y: i % 2 ? 20 : -25,
        scale: 1.06,
        duration: 6 + i,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      });
    });
  }, []);

  const handleNextStep1 = (e) => {
    e.preventDefault();
    setError('');
    if (!pharmacyName.trim() || pharmacyName.trim().length < 2) {
      setError('Please enter your pharmacy business name.');
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || username.trim().length < 3) {
      setError('Admin username must be at least 3 characters.');
      return;
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setStep(3);
  };

  const handleCompleteRegistration = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await window.pharmacoreAPI.registerPharmacy({
        pharmacyName: pharmacyName.trim(),
        city: city.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        name: name.trim() || pharmacyName.trim() + ' Admin',
        username: username.trim().toLowerCase(),
        password,
        branchName: branchName.trim() || 'Main Branch',
        planTier
      });

      if (!res.success) {
        setError(res.error || 'Failed to complete registration.');
        setLoading(false);
        return;
      }

      // Automatically login
      const loginRes = await window.pharmacoreAPI.login(username.trim().toLowerCase(), password);
      if (loginRes.success) {
        onLogin({
          username: loginRes.username,
          name: loginRes.name,
          role: loginRes.role,
          pharmacyId: loginRes.pharmacyId,
          pharmacyName: loginRes.pharmacyName,
          branchId: loginRes.branchId,
          canViewAllBranches: loginRes.canViewAllBranches,
          subscription: loginRes.subscription
        });
      } else {
        if (onSwitchToLogin) onSwitchToLogin();
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(err.message || 'An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <main ref={containerRef} className="relative min-h-screen grid lg:grid-cols-[1.1fr_0.9fr] bg-[#071d1a] font-body text-white overflow-hidden">
      {/* Background Ambience */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={el => orbRefs.current[0] = el} className="absolute -left-20 top-[-6rem] h-96 w-96 rounded-full bg-[#29c487]/20 blur-[110px]" />
        <div ref={el => orbRefs.current[1] = el} className="absolute right-[25%] top-[35%] h-80 w-80 rounded-full bg-[#f3ae4d]/15 blur-[100px]" />
        <div ref={el => orbRefs.current[2] = el} className="absolute -bottom-24 left-[30%] h-80 w-80 rounded-full bg-[#136b9e]/20 blur-[105px]" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.4)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.4)_1px,transparent_1px)] [background-size:50px_50px]" />
      </div>

      {/* Left Pitch Column */}
      <section className="relative z-10 flex flex-col justify-between p-8 sm:p-12 lg:p-16">
        <div className="flex items-center">
          <img src="./logo-dark.png" alt="PharmaCore - The Unified Pharmacy Ecosystem" className="h-14 w-auto object-contain drop-shadow-[0_8px_24px_rgba(41,196,135,0.35)]" />
        </div>

        <div className="max-w-xl py-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald/20 border border-emerald/30 text-[#67e8b4] text-xs font-mono font-bold uppercase tracking-wider mb-6">
            <Sparkles className="w-4 h-4" /> 14-Day Full Free Trial
          </div>
          <h1 className="font-title text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-white">
            Set up your pharmacy in <span className="text-[#f5bc63]">2 minutes</span>.
          </h1>
          <p className="mt-6 text-sm sm:text-base leading-relaxed text-emerald-50/70 max-w-md">
            Join modern pharmacies managing inventory, point-of-sale, batch expiry tracking, and customer records with lightning-fast cloud sync.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-4 text-xs text-emerald-100/80 font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#29c487]" /> No credit card required
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#29c487]" /> Instant cloud workspace
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#29c487]" /> Thermal receipt ready
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#29c487]" /> Complete batch inventory
            </div>
          </div>
        </div>

        <div className="text-[11px] font-mono text-emerald-50/50 uppercase tracking-widest">
          PharmaCore SaaS • Secure & Compliant
        </div>
      </section>

      {/* Right Form Card */}
      <section className="relative z-10 flex items-center justify-center bg-white p-6 sm:p-10 lg:p-12 text-ink">
        <div className="w-full max-w-md space-y-6">
          {/* Step Indicator */}
          <div className="flex items-center justify-between border-b border-ink/10 pb-4">
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald">
                Step {step} of 3
              </p>
              <h2 className="text-2xl font-title text-ink mt-0.5">
                {step === 1 && 'Pharmacy Profile'}
                {step === 2 && 'Owner Account'}
                {step === 3 && 'Branch & Plan'}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map(s => (
                <div 
                  key={s} 
                  className={`h-2 rounded-full transition-all ${
                    s === step ? 'w-6 bg-emerald' : s < step ? 'w-2 bg-emerald/60' : 'w-2 bg-ink/20'
                  }`}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3.5 bg-terracotta/10 border border-terracotta/20 text-terracotta text-xs font-semibold rounded-xl">
              {error}
            </div>
          )}

          {/* Step 1: Pharmacy Details */}
          {step === 1 && (
            <form onSubmit={handleNextStep1} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1.5">Pharmacy Business Name *</label>
                <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald/10">
                  <Store className="w-4 h-4 text-emerald mr-3" />
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. Al-Shifa Pharmacy"
                    value={pharmacyName}
                    onChange={e => setPharmacyName(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-ink/30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-ink/80 mb-1.5">City / Region *</label>
                  <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                    <MapPin className="w-4 h-4 text-emerald mr-2" />
                    <input
                      type="text"
                      required
                      placeholder="Karachi"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-ink/30"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink/80 mb-1.5">Phone Number</label>
                  <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                    <Phone className="w-4 h-4 text-emerald mr-2" />
                    <input
                      type="text"
                      placeholder="0300-1234567"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-ink/30"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1.5">Email Address</label>
                <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                  <Mail className="w-4 h-4 text-emerald mr-3" />
                  <input
                    type="email"
                    placeholder="contact@pharmacy.pk"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-ink/30"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-ink hover:bg-emerald text-white font-bold text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 mt-4"
              >
                <span>Continue to Account Setup</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* Step 2: Owner Credentials */}
          {step === 2 && (
            <form onSubmit={handleNextStep2} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1.5">Your Full Name</label>
                <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                  <User className="w-4 h-4 text-emerald mr-3" />
                  <input
                    type="text"
                    placeholder="Dr. Tariq Khan"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-ink/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1.5">Login Username *</label>
                <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                  <User className="w-4 h-4 text-emerald mr-3" />
                  <input
                    type="text"
                    required
                    placeholder="tariqadmin"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-ink/30"
                  />
                </div>
                <p className="text-[11px] text-ink/50 mt-1 font-mono">You will use this username to log in.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-ink/80 mb-1.5">Password *</label>
                  <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                    <Lock className="w-4 h-4 text-emerald mr-2" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full bg-transparent text-sm font-medium outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink/80 mb-1.5">Confirm *</label>
                  <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                    <Lock className="w-4 h-4 text-emerald mr-2" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full bg-transparent text-sm font-medium outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-1/3 py-3.5 bg-clinical hover:bg-ink/10 text-ink font-bold text-xs rounded-2xl transition-all"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-3.5 bg-ink hover:bg-emerald text-white font-bold text-xs rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <span>Select Plan</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Branch & Plan Selection */}
          {step === 3 && (
            <form onSubmit={handleCompleteRegistration} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1.5">Main Branch Name</label>
                <div className="flex items-center px-4 py-3 bg-clinical border border-ink/10 rounded-2xl focus-within:border-emerald focus-within:bg-white">
                  <Building2 className="w-4 h-4 text-emerald mr-3" />
                  <input
                    type="text"
                    value={branchName}
                    onChange={e => setBranchName(e.target.value)}
                    placeholder="Main Branch"
                    className="w-full bg-transparent text-sm font-medium outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-2">Choose Initial Plan</label>
                <div className="space-y-2.5">
                  <label className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition-all ${
                    planTier === 'trial' ? 'border-emerald bg-emerald/5 ring-1 ring-emerald' : 'border-ink/10 hover:bg-clinical'
                  }`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="plan"
                        value="trial"
                        checked={planTier === 'trial'}
                        onChange={() => setPlanTier('trial')}
                        className="text-emerald"
                      />
                      <div>
                        <p className="font-bold text-ink text-xs">14-Day Free Trial</p>
                        <p className="text-[11px] text-ink/50">Full features, 1 branch, 3 staff accounts</p>
                      </div>
                    </div>
                    <span className="font-bold text-xs text-emerald">Free</span>
                  </label>

                  <label className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition-all ${
                    planTier === 'starter' ? 'border-emerald bg-emerald/5 ring-1 ring-emerald' : 'border-ink/10 hover:bg-clinical'
                  }`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="plan"
                        value="starter"
                        checked={planTier === 'starter'}
                        onChange={() => setPlanTier('starter')}
                        className="text-emerald"
                      />
                      <div>
                        <p className="font-bold text-ink text-xs">Starter Tier</p>
                        <p className="text-[11px] text-ink/50">1 Branch, 3 Users, POS & Stock</p>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-xs text-ink">PKR 3,000/mo</span>
                  </label>

                  <label className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition-all ${
                    planTier === 'professional' ? 'border-emerald bg-emerald/5 ring-1 ring-emerald' : 'border-ink/10 hover:bg-clinical'
                  }`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="plan"
                        value="professional"
                        checked={planTier === 'professional'}
                        onChange={() => setPlanTier('professional')}
                        className="text-emerald"
                      />
                      <div>
                        <p className="font-bold text-ink text-xs">Professional Tier (Recommended)</p>
                        <p className="text-[11px] text-ink/50">5 Branches, 15 Users, Analytics & FBR</p>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-xs text-emerald font-bold">PKR 8,000/mo</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={loading}
                  className="w-1/3 py-4 bg-clinical hover:bg-ink/10 text-ink font-bold text-xs rounded-2xl transition-all"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-2/3 py-4 bg-emerald hover:bg-emerald/90 text-white font-bold text-sm rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Launch Pharmacy</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Switch to login */}
          <div className="text-center pt-2">
            <p className="text-xs text-ink/60">
              Already have a pharmacy account?{' '}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="font-bold text-emerald hover:underline"
              >
                Sign In
              </button>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
