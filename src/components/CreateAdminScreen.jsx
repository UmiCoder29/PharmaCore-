import React, { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function CreateAdminScreen({ onCreated }) {
  const [branchName, setBranchName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const [phase, setPhase] = useState('form');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  const float1Ref = useRef(null);
  const float2Ref = useRef(null);
  const float3Ref = useRef(null);
  const float4Ref = useRef(null);
  const float5Ref = useRef(null);
  const float6Ref = useRef(null);
  const logoGlowRef = useRef(null);

  const reviewSectionRef = useRef(null);
  const recoveryBoxRef = useRef(null);
  const warningIconRef = useRef(null);
  const warningTitleRef = useRef(null);
  const warningLinesRef = useRef([]);
  const checkboxRowRef = useRef(null);
  const finalBtnRef = useRef(null);

  useEffect(() => {
    if (logoGlowRef.current) {
      gsap.to(logoGlowRef.current, {
        boxShadow: '0 0 20px rgba(27, 122, 67, 0.4), 0 0 40px rgba(27, 122, 67, 0.2), 0 0 60px rgba(27, 122, 67, 0.1)',
        duration: 2.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      });
    }
    if (float1Ref.current) {
      gsap.to(float1Ref.current, {
        y: '+=25', x: '+=15', rotation: 360, duration: 8,
        repeat: -1, yoyo: true, ease: 'sine.inOut'
      });
    }
    if (float2Ref.current) {
      gsap.to(float2Ref.current, {
        y: '-=30', x: '+=20', rotation: -180, duration: 9,
        repeat: -1, yoyo: true, ease: 'sine.inOut'
      });
    }
    if (float3Ref.current) {
      gsap.to(float3Ref.current, {
        y: '+=20', x: '-=15', rotation: 120, duration: 7,
        repeat: -1, yoyo: true, ease: 'sine.inOut'
      });
    }
    if (float4Ref.current) {
      gsap.to(float4Ref.current, {
        y: '-=25', x: '-=20', rotation: -90, duration: 10,
        repeat: -1, yoyo: true, ease: 'sine.inOut'
      });
    }
    if (float5Ref.current) {
      gsap.to(float5Ref.current, {
        y: '+=15', x: '+=25', rotation: 240, duration: 8.5,
        repeat: -1, yoyo: true, ease: 'sine.inOut'
      });
    }
    if (float6Ref.current) {
      gsap.to(float6Ref.current, {
        y: '-=15', x: '-=10', rotation: -360, duration: 7.5,
        repeat: -1, yoyo: true, ease: 'sine.inOut'
      });
    }
  }, []);

  useEffect(() => {
    if (phase !== 'review') return;

    const tl = gsap.timeline();

    if (reviewSectionRef.current) {
      gsap.set(reviewSectionRef.current, { autoAlpha: 0, y: 30 });
      tl.to(reviewSectionRef.current, {
        autoAlpha: 1,
        y: 0,
        duration: 0.7,
        ease: 'power3.out'
      }, 0);
    }

    if (recoveryBoxRef.current) {
      gsap.set(recoveryBoxRef.current, { autoAlpha: 0, y: 20, scale: 0.98 });
      tl.to(recoveryBoxRef.current, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.55,
        ease: 'back.out(1.4)',
        onComplete: () => {
          gsap.to(recoveryBoxRef.current, {
            boxShadow: '0 0 0 2px rgba(234, 179, 8, 0.25), 0 10px 25px -5px rgba(234, 179, 8, 0.15)',
            duration: 1.6,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut'
          });
        }
      }, 0.15);
    }

    if (warningIconRef.current) {
      gsap.set(warningIconRef.current, { scale: 0, rotation: -20 });
      tl.to(warningIconRef.current, {
        scale: 1,
        rotation: 0,
        duration: 0.5,
        ease: 'back.out(2)',
        onComplete: () => {
          gsap.to(warningIconRef.current, {
            scale: 1.1,
            duration: 1.2,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut'
          });
        }
      }, 0.35);
    }

    if (warningTitleRef.current) {
      gsap.set(warningTitleRef.current, { autoAlpha: 0, x: -15 });
      tl.to(warningTitleRef.current, {
        autoAlpha: 1,
        x: 0,
        duration: 0.45,
        ease: 'power2.out'
      }, 0.5);
    }

    const lines = warningLinesRef.current.filter(Boolean);
    lines.forEach((line, i) => {
      gsap.set(line, { autoAlpha: 0, x: -10 });
      tl.to(line, {
        autoAlpha: 1,
        x: 0,
        duration: 0.4,
        ease: 'power2.out'
      }, 0.6 + i * 0.11);
    });

    if (checkboxRowRef.current) {
      gsap.set(checkboxRowRef.current, { autoAlpha: 0, y: 12 });
      tl.to(checkboxRowRef.current, {
        autoAlpha: 1,
        y: 0,
        duration: 0.45,
        ease: 'power2.out'
      }, 0.6 + lines.length * 0.11 + 0.05);
    }

    if (finalBtnRef.current) {
      gsap.set(finalBtnRef.current, { autoAlpha: 0, y: 15 });
      tl.to(finalBtnRef.current, {
        autoAlpha: 1,
        y: 0,
        duration: 0.5,
        ease: 'power3.out'
      }, 0.6 + lines.length * 0.11 + 0.2);
    }
  }, [phase]);

  useEffect(() => {
    if (!acknowledged || !finalBtnRef.current) return;
    gsap.fromTo(finalBtnRef.current,
      { scale: 1 },
      { scale: 1.03, duration: 0.25, yoyo: true, repeat: 1, ease: 'power2.out' }
    );
  }, [acknowledged]);

  const formatRecoveryKey = (key) => {
    if (!key) return '';
    return key.match(/.{1,8}/g)?.join(' ') || key;
  };

  const copyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Could not copy to clipboard. Please select and copy manually.');
    }
  };

  const handlePrepareSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (branchName.trim().length < 2) {
      setError('Branch name is required (e.g. "Main Branch" or "DHA Branch").');
      return;
    }
    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await window.pharmacoreAPI.prepareAdmin(username.trim(), password, branchName.trim());
      if (result.success) {
        setRecoveryKey(result.recoveryKey);
        setPhase('review');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setError(result.error || 'Failed to prepare account.');
      }
    } catch (err) {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!acknowledged) return;

    setLoading(true);
    try {
      const result = await window.pharmacoreAPI.finalizeAdmin(username.trim(), branchName.trim());
      if (result.success) {
        onCreated({ username: username.trim(), role: 'admin' });
      } else {
        setError(result.error || 'Failed to create account.');
        if (result.error && result.error.includes('start over')) {
          setPhase('form');
        }
      }
    } catch (err) {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setPhase('form');
    setAcknowledged(false);
    setRecoveryKey('');
    setError('');
  };

  const warningParagraphs = [
    'IMPORTANT: This system does not store your password anywhere, and there is no way for anyone — including the developer — to recover it if lost.',
    'If you forget your admin password and do not have your Recovery Key saved, all data in this system will become permanently inaccessible.',
    'Remembering your password and safely storing your Recovery Key is entirely your responsibility.'
  ];

  return (
    <div className="min-h-screen bg-clinical flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-emerald/20/30 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-emerald/10/40 rounded-full blur-[140px] pointer-events-none" />

      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <svg ref={float1Ref} className="w-10 h-10 text-emerald/40/20 absolute" style={{ left: '10%', top: '15%' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="9" width="18" height="12" rx="2" />
          <path d="M14 9V5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
          <path d="M12 12v6M9 15h6" />
        </svg>
        <svg ref={float2Ref} className="w-8 h-8 text-emerald/15 absolute" style={{ left: '80%', top: '10%' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="5" width="14" height="14" rx="7" />
          <path d="M12 5v14" />
        </svg>
        <svg ref={float3Ref} className="w-6 h-6 text-emerald/40/15 absolute" style={{ left: '8%', top: '55%' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <svg ref={float4Ref} className="w-12 h-12 text-emerald/12 absolute" style={{ left: '85%', top: '65%' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="9" width="18" height="12" rx="2" />
          <path d="M14 9V5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
          <path d="M12 12v6M9 15h6" />
        </svg>
        <svg ref={float5Ref} className="w-7 h-7 text-emerald/40/18 absolute" style={{ left: '15%', top: '80%' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="5" width="14" height="14" rx="7" />
          <path d="M12 5v14" />
        </svg>
        <svg ref={float6Ref} className="w-5 h-5 text-emerald/15 absolute" style={{ left: '78%', top: '45%' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>

      <div className="w-full max-w-2xl z-10">
        <div className="text-center mb-8 flex flex-col items-center">
          <img
            ref={logoGlowRef}
            src="./logo-light.png"
            alt="PharmaCore - The Unified Pharmacy Ecosystem"
            className="h-16 w-auto object-contain mb-3 drop-shadow-[0_4px_16px_rgba(27,122,67,0.25)]"
          />
          <p className="text-ink/60 text-sm font-mono tracking-widest uppercase">
            First-Time Setup
          </p>
        </div>

        <div className="bg-white border border-ink/20 rounded-lg p-8 ">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-ink">
              {phase === 'form' ? 'Create Admin Account' : 'Review & Confirm Setup'}
            </h2>
            <p className="text-ink/70 text-sm mt-1 leading-relaxed">
              {phase === 'form'
                ? 'This will be the primary administrator account. Your password also encrypts the local database — keep it safe.'
                : 'Please carefully review and acknowledge before the account is finalized.'}
            </p>
          </div>

          {phase === 'form' && (
            <form onSubmit={handlePrepareSubmit} className="space-y-5" autoComplete="off">
              <div>
                <label className="block text-xs font-semibold text-ink/80 uppercase tracking-wider mb-2">
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-emerald" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                    </svg>
                    Branch / Location Name
                  </span>
                </label>
                <input
                  id="create-branch"
                  type="text"
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  placeholder="e.g. Main Branch, DHA Branch, Gulshan Outlet"
                  disabled={loading}
                  className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded px-4 py-3 text-ink placeholder-ink/40 text-sm outline-none transition-all duration-200 disabled:opacity-50"
                  autoFocus
                />
                <p className="mt-1.5 text-[11px] text-ink/40 leading-relaxed">
                  Set once on first launch and stored permanently. All sales &amp; medicines will be tagged with this branch.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink/80 uppercase tracking-wider mb-2">
                  Username
                </label>
                <input
                  id="create-username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="e.g. admin"
                  disabled={loading}
                  className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded px-4 py-3 text-ink placeholder-ink/40 text-sm outline-none transition-all duration-200 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink/80 uppercase tracking-wider mb-2">
                  Password
                </label>
                <input
                  id="create-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  disabled={loading}
                  className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded px-4 py-3 text-ink placeholder-ink/40 text-sm outline-none transition-all duration-200 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink/80 uppercase tracking-wider mb-2">
                  Confirm Password
                </label>
                <input
                  id="create-confirm"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  disabled={loading}
                  className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded px-4 py-3 text-ink placeholder-ink/40 text-sm outline-none transition-all duration-200 disabled:opacity-50"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 bg-terracotta/5 border border-red-200 rounded px-4 py-3">
                  <svg className="w-4 h-4 text-terracotta shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-terracotta text-sm leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full bg-emerald hover:bg-emerald/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded transition-all duration-200 text-sm tracking-wide overflow-hidden"
              >
                <span className="absolute bottom-0 left-0 h-0.5 w-0 bg-emerald/40 transition-all duration-300 group-hover:w-full"></span>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Preparing secure setup…
                  </span>
                ) : 'Continue'}
              </button>
            </form>
          )}

          {phase === 'review' && (
            <div ref={reviewSectionRef} className="space-y-6">
              <div
                ref={recoveryBoxRef}
                className="relative border-2 border-amber-300 bg-amber/5/60 rounded-lg p-5"
                style={{ boxShadow: '0 4px 14px -4px rgba(234, 179, 8, 0.2)' }}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-md bg-amber-400/20 flex items-center justify-center shrink-0">
                      <svg className="w-4.5 h-4.5 text-amber" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-amber-900 tracking-tight">Your Recovery Key</h3>
                      <p className="text-xs text-amber/80">Save this key in a safe place — it is shown only once.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={copyRecoveryKey}
                    className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded border border-amber-300 bg-white hover:bg-amber/10 text-amber transition-all duration-200"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="bg-white border border-amber-200 rounded p-4 select-all">
                  <code className="block text-sm font-mono tracking-[0.15em] text-ink break-all leading-relaxed">
                    {formatRecoveryKey(recoveryKey)}
                  </code>
                </div>
              </div>

              <div className="border-2 border-red-200 bg-terracotta/5/60 rounded-lg p-5 overflow-hidden">
                <div className="flex items-start gap-3 mb-3">
                  <div
                    ref={warningIconRef}
                    className="shrink-0 w-10 h-10 rounded-full bg-terracotta/10 border border-red-200 flex items-center justify-center mt-0.5"
                  >
                    <svg className="w-5.5 h-5.5 text-terracotta" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3
                      ref={warningTitleRef}
                      className="text-base font-extrabold text-terracotta tracking-tight uppercase"
                    >
                      Critical Security Warning
                    </h3>
                  </div>
                </div>

                <div className="space-y-3 pl-[52px]">
                  {warningParagraphs.map((text, i) => (
                    <p
                      key={i}
                      ref={el => { warningLinesRef.current[i] = el; }}
                      className="text-sm leading-relaxed text-red-900/90"
                    >
                      {text}
                    </p>
                  ))}
                </div>
              </div>

              <div
                ref={checkboxRowRef}
                className="bg-clinical border border-ink/20 rounded-lg px-4 py-4"
              >
                <label className="flex items-start gap-3 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={e => setAcknowledged(e.target.checked)}
                    className="mt-0.5 w-5 h-5 shrink-0 rounded border-2 border-cream-400 text-emerald focus:ring-2 focus:ring-pharmacy-400/30 focus:ring-offset-0 cursor-pointer transition-colors"
                  />
                  <span className="text-sm font-semibold text-ink/90 leading-relaxed group-hover:text-ink">
                    I understand this is my responsibility
                  </span>
                </label>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 bg-terracotta/5 border border-red-200 rounded px-4 py-3">
                  <svg className="w-4 h-4 text-terracotta shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-terracotta text-sm leading-relaxed">{error}</p>
                </div>
              )}

              <div className="space-y-3 pt-1">
                <button
                  ref={finalBtnRef}
                  type="button"
                  onClick={handleFinalizeSubmit}
                  disabled={!acknowledged || loading}
                  className={`group relative w-full font-bold py-3.5 rounded transition-all duration-200 text-sm tracking-wide overflow-hidden ${
                    acknowledged && !loading
                      ? 'bg-emerald hover:bg-emerald/90 text-white  hover:'
                      : 'bg-ink/5 text-ink/40 cursor-not-allowed'
                  }`}
                >
                  <span className={`absolute bottom-0 left-0 h-0.5 w-0 transition-all duration-300 group-hover:w-full ${
                    acknowledged ? 'bg-emerald/40' : 'bg-ink/10'
                  }`}></span>
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Creating account & encrypting database…
                    </span>
                  ) : (
                    acknowledged ? 'Create Account' : 'Check the box above to continue'
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleBack}
                  disabled={loading}
                  className="w-full py-2.5 text-sm font-semibold text-ink/70 hover:text-ink hover:bg-ink/10 rounded transition-all duration-200 disabled:opacity-50"
                >
                  ← Back to account details
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 flex items-start gap-2 text-ink/60 text-xs leading-relaxed">
            <svg className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Database encrypted with AES-256-GCM · Key derived from your password via scrypt · Never stored in plaintext
          </div>
        </div>
      </div>
    </div>
  );
}
