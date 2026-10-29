import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  ShieldCheck, 
  Sparkles, 
  Building, 
  CreditCard, 
  Megaphone, 
  Lock, 
  CheckCircle2, 
  Save, 
  RefreshCw,
  Sliders,
  Globe,
  Image as ImageIcon,
  HelpCircle,
  AlertTriangle
} from 'lucide-react';

export default function SaasSettingsScreen({ user }) {
  const [activeCategory, setActiveCategory] = useState('general'); // general, trial, billing, broadcast, security
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');

  // Platform Identity
  const [identity, setIdentity] = useState({
    platformName: 'PharmaCore Cloud ERP',
    tagline: 'Modern Pharmacy SaaS & POS Suite',
    supportEmail: 'support@pharmacore.pk',
    supportPhone: '+92 300 1234567',
    companyName: 'PharmaCore Technologies Pvt Ltd',
    version: '2.4.0',
    logoUrl: ''
  });


  // Trial Policy
  const [trial, setTrial] = useState({
    defaultDurationDays: 14,
    defaultMaxBranches: 1,
    defaultMaxUsers: 3,
    allowPublicRegistration: true,
    autoLockExpired: true
  });

  // Billing & Bank Accounts
  const [billing, setBilling] = useState({
    bankName: 'Meezan Bank Ltd',
    accountTitle: 'PharmaCore Technologies',
    accountNumber: '02010108765432',
    iban: 'PK36MEZN0002010108765432',
    jazzcashNumber: '03001234567',
    easypaisaNumber: '03001234567',
    paymentInstructions: 'Please send screenshot of transfer on WhatsApp to +92 300 1234567 with your Pharmacy Name for instant activation.'
  });

  // Broadcast Notice
  const [broadcast, setBroadcast] = useState({
    enabled: false,
    type: 'info',
    message: '',
    dismissible: true
  });

  // Security
  const [security, setSecurity] = useState({
    minPasswordLength: 8,
    sessionTimeoutMinutes: 480,
    enforceStrongPassword: true,
    maxFailedLoginAttempts: 5
  });

  const fetchSettings = async () => {
    setLoading(true);
    setSaveError('');
    try {
      const res = await window.pharmacoreAPI.getPlatformSettings();
      if (res && res.success === false) {
        setSaveError(res.error || 'Failed to load platform settings.');
        return;
      }
      const data = res?.data || res || {};
      setSettings(data);
      if (data?.platform_identity) {
        const val = typeof data.platform_identity === 'string' ? JSON.parse(data.platform_identity) : data.platform_identity;
        setIdentity(prev => ({ ...prev, ...val }));
      }
      if (data?.trial_policy) {
        const val = typeof data.trial_policy === 'string' ? JSON.parse(data.trial_policy) : data.trial_policy;
        setTrial(prev => ({ ...prev, ...val }));
      }
      if (data?.billing_instructions) {
        const val = typeof data.billing_instructions === 'string' ? JSON.parse(data.billing_instructions) : data.billing_instructions;
        setBilling(prev => ({ ...prev, ...val }));
      }
      if (data?.broadcast_announcement) {
        const val = typeof data.broadcast_announcement === 'string' ? JSON.parse(data.broadcast_announcement) : data.broadcast_announcement;
        setBroadcast(prev => ({ ...prev, ...val }));
      }
      if (data?.security_policy) {
        const val = typeof data.security_policy === 'string' ? JSON.parse(data.security_policy) : data.security_policy;
        setSecurity(prev => ({ ...prev, ...val }));
      }
    } catch (err) {
      console.error('Failed to load platform settings:', err);
      setSaveError(err.message || 'Failed to load platform settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveCategory = async (key, value, category) => {
    setSaving(true);
    setSaveSuccess('');
    setSaveError('');

    try {
      const apiFn = 
        window.pharmacoreAPI?.updatePlatformSettings || 
        window.pharmacoreAPI?.updatePlatformSetting ||
        window.pharmacoreAPI?.savePlatformSettings;

      if (!apiFn) {
        throw new Error('Settings API is not ready. Please restart the app.');
      }

      const res = await apiFn(key, value, category);
      if (res && res.success) {
        setSaveSuccess('Configuration updated and synced across all pharmacy workspaces.');
        setSettings(prev => ({ ...prev, [key]: value }));
        setTimeout(() => setSaveSuccess(''), 4000);
      } else {
        setSaveError(res?.error || 'Failed to update settings.');
      }
    } catch (err) {
      console.error(err);
      setSaveError(err.message || 'Error updating settings.');
    } finally {
      setSaving(false);
    }
  };


  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      alert('Logo image should be under 1.5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setIdentity({ ...identity, logoUrl: reader.result });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-ink tracking-tight">Core Platform Settings</h1>
            <span className="px-2.5 py-0.5 bg-emerald/10 text-emerald rounded-full text-xs font-mono font-bold">
              Global SaaS Config
            </span>
          </div>
          <p className="text-xs font-semibold text-ink/60 mt-0.5">
            Manage portal branding & logo, live database environment connection keys, trial policies, and broadcast announcements.
          </p>
        </div>

        <button
          onClick={fetchSettings}
          className="p-2.5 bg-white border border-ink/10 rounded-2xl hover:bg-slate-50 transition-all text-ink shadow-sm self-start"
          title="Refresh Settings"
        >
          <RefreshCw className="w-4 h-4 text-emerald" />
        </button>
      </div>

      {saveSuccess && (
        <div className="p-3.5 bg-emerald/10 border border-emerald/20 text-emerald text-xs font-bold rounded-2xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {saveError && (
        <div className="p-3.5 bg-terracotta/10 border border-terracotta/20 text-terracotta text-xs font-bold rounded-2xl">
          {saveError}
        </div>
      )}

      {/* Main Settings Navigation & Content */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-white rounded-3xl border border-ink/10 shadow-sm p-6 sm:p-8">
        {/* Left Category Menu */}
        <div className="md:col-span-4 space-y-1.5 border-b md:border-b-0 md:border-r border-ink/10 pb-6 md:pb-0 md:pr-6">
          <button
            onClick={() => setActiveCategory('general')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-xs transition-all text-left ${
              activeCategory === 'general' ? 'bg-emerald text-white shadow-md' : 'hover:bg-slate-100 text-ink/80'
            }`}
          >
            <Globe className="w-4 h-4 shrink-0" />
            <span>Portal Branding & Logo</span>
          </button>


          <button
            onClick={() => setActiveCategory('trial')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-xs transition-all text-left ${
              activeCategory === 'trial' ? 'bg-emerald text-white shadow-md' : 'hover:bg-slate-100 text-ink/80'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>Trial & Onboarding Rules</span>
          </button>

          <button
            onClick={() => setActiveCategory('billing')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-bold text-xs transition-all text-left ${
              activeCategory === 'billing' ? 'bg-emerald text-white shadow-md' : 'hover:bg-slate-100 text-ink/80'
            }`}
          >
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4 shrink-0" />
              <span>Bank & Payment Accounts</span>
            </div>
            {!settings.billing_instructions && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'billing' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'}`}>
                Not saved
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveCategory('broadcast')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-bold text-xs transition-all text-left ${
              activeCategory === 'broadcast' ? 'bg-emerald text-white shadow-md' : 'hover:bg-slate-100 text-ink/80'
            }`}
          >
            <div className="flex items-center gap-3">
              <Megaphone className="w-4 h-4 shrink-0" />
              <span>Broadcast Announcements</span>
            </div>
            {!settings.broadcast_announcement && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'broadcast' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'}`}>
                Not saved
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveCategory('security')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-xs transition-all text-left ${
              activeCategory === 'security' ? 'bg-emerald text-white shadow-md' : 'hover:bg-slate-100 text-ink/80'
            }`}
          >
            <Lock className="w-4 h-4 shrink-0" />
            <span>Security & Login Policy</span>
          </button>
        </div>

        {/* Right Tab Content */}
        <div className="md:col-span-8 space-y-6">
          {/* TAB 1: Platform Branding & Logo */}
          {activeCategory === 'general' && (
            <form onSubmit={(e) => { e.preventDefault(); handleSaveCategory('platform_identity', identity, 'general'); }} className="space-y-4 text-xs">
              <div>
                <h3 className="text-base font-black text-ink mb-1">Global Portal Branding & Logo</h3>
                <p className="text-ink/50 text-[11px]">Customize the SaaS platform logo, name, and support contacts.</p>
              </div>

              {/* Portal Logo Upload & Preview */}
              <div className="bg-clinical p-4 rounded-2xl border border-ink/10 space-y-3">
                <label className="block font-bold text-ink/80">Platform Portal Logo</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white border border-ink/10 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                    {identity.logoUrl ? (
                      <img src={identity.logoUrl} alt="Portal Logo" className="w-full h-full object-contain p-1" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-ink/30" />
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="block w-full text-xs text-ink/60 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald file:text-white hover:file:bg-emerald/90 cursor-pointer"
                    />
                    <input
                      type="text"
                      placeholder="Or paste image URL (https://...)"
                      value={identity.logoUrl || ''}
                      onChange={e => setIdentity({ ...identity, logoUrl: e.target.value })}
                      className="w-full bg-white border border-ink/10 rounded-xl px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-ink/80 mb-1">Platform Name</label>
                  <input
                    type="text"
                    value={identity.platformName}
                    onChange={e => setIdentity({ ...identity, platformName: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">Tagline / Slogan</label>
                  <input
                    type="text"
                    value={identity.tagline}
                    onChange={e => setIdentity({ ...identity, tagline: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-medium outline-none focus:border-emerald"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-ink/80 mb-1">Support Email</label>
                  <input
                    type="email"
                    value={identity.supportEmail}
                    onChange={e => setIdentity({ ...identity, supportEmail: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-medium outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">Support Phone / WhatsApp</label>
                  <input
                    type="text"
                    value={identity.supportPhone}
                    onChange={e => setIdentity({ ...identity, supportPhone: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-medium outline-none focus:border-emerald"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-ink/80 mb-1">Legal Company Name</label>
                <input
                  type="text"
                  value={identity.companyName}
                  onChange={e => setIdentity({ ...identity, companyName: e.target.value })}
                  className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-medium outline-none focus:border-emerald"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-emerald hover:bg-emerald/90 text-white font-bold rounded-2xl transition-all shadow-md flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>Save Portal Branding</span>
              </button>
            </form>
          )}



          {/* TAB 3: Trial & Onboarding Policy */}
          {activeCategory === 'trial' && (
            <form onSubmit={(e) => { e.preventDefault(); handleSaveCategory('trial_policy', trial, 'trial'); }} className="space-y-4 text-xs">
              <div>
                <h3 className="text-base font-black text-ink mb-1">Free Trial & Onboarding Quotas</h3>
                <p className="text-ink/50 text-[11px]">Define default duration and quotas applied when new pharmacies sign up.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-bold text-ink/80 mb-1">Trial Validity (Days)</label>
                  <input
                    type="number"
                    min="1"
                    value={trial.defaultDurationDays}
                    onChange={e => setTrial({ ...trial, defaultDurationDays: parseInt(e.target.value, 10) || 14 })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">Trial Branch Limit</label>
                  <input
                    type="number"
                    min="1"
                    value={trial.defaultMaxBranches}
                    onChange={e => setTrial({ ...trial, defaultMaxBranches: parseInt(e.target.value, 10) || 1 })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">Trial User Account Limit</label>
                  <input
                    type="number"
                    min="1"
                    value={trial.defaultMaxUsers}
                    onChange={e => setTrial({ ...trial, defaultMaxUsers: parseInt(e.target.value, 10) || 3 })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trial.allowPublicRegistration}
                    onChange={e => setTrial({ ...trial, allowPublicRegistration: e.target.checked })}
                    className="rounded text-emerald"
                  />
                  <span className="font-bold text-ink">Allow Public Self-Registration on Login Screen</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trial.autoLockExpired}
                    onChange={e => setTrial({ ...trial, autoLockExpired: e.target.checked })}
                    className="rounded text-emerald"
                  />
                  <span className="font-bold text-ink">Automatically Lock Access when Trial or Subscription Expires</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-emerald hover:bg-emerald/90 text-white font-bold rounded-2xl transition-all shadow-md flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>Save Onboarding Policy</span>
              </button>
            </form>
          )}

          {/* TAB 4: Bank & Payment Instructions */}
          {activeCategory === 'billing' && (
            <form onSubmit={(e) => { e.preventDefault(); handleSaveCategory('billing_instructions', billing, 'billing'); }} className="space-y-4 text-xs">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-black text-ink">Payment Instructions & Direct Bank Accounts</h3>
                  {!settings.billing_instructions && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold">
                      Default (not saved yet)
                    </span>
                  )}
                </div>
                <p className="text-ink/50 text-[11px]">These details are displayed to pharmacy owners on their Subscription & Renewal Screen.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-ink/80 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={billing.bankName}
                    onChange={e => setBilling({ ...billing, bankName: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">Account Title</label>
                  <input
                    type="text"
                    value={billing.accountTitle}
                    onChange={e => setBilling({ ...billing, accountTitle: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-ink/80 mb-1">Account Number</label>
                  <input
                    type="text"
                    value={billing.accountNumber}
                    onChange={e => setBilling({ ...billing, accountNumber: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-mono font-semibold outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">IBAN Number</label>
                  <input
                    type="text"
                    value={billing.iban}
                    onChange={e => setBilling({ ...billing, iban: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-mono font-semibold outline-none focus:border-emerald"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-ink/80 mb-1">JazzCash Account</label>
                  <input
                    type="text"
                    value={billing.jazzcashNumber}
                    onChange={e => setBilling({ ...billing, jazzcashNumber: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">EasyPaisa Account</label>
                  <input
                    type="text"
                    value={billing.easypaisaNumber}
                    onChange={e => setBilling({ ...billing, easypaisaNumber: e.target.value })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-ink/80 mb-1">Transfer Verification Notice</label>
                <textarea
                  rows="3"
                  value={billing.paymentInstructions}
                  onChange={e => setBilling({ ...billing, paymentInstructions: e.target.value })}
                  className="w-full bg-clinical border border-ink/10 rounded-2xl p-3 text-xs font-medium outline-none focus:border-emerald custom-scrollbar leading-relaxed"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-emerald hover:bg-emerald/90 text-white font-bold rounded-2xl transition-all shadow-md flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>Save Payment Instructions</span>
              </button>
            </form>
          )}

          {/* TAB 5: Broadcast Announcements */}
          {activeCategory === 'broadcast' && (
            <form onSubmit={(e) => { e.preventDefault(); handleSaveCategory('broadcast_announcement', broadcast, 'broadcast'); }} className="space-y-4 text-xs">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-black text-ink">Global System Announcement Banner</h3>
                  {!settings.broadcast_announcement && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold">
                      Default (not saved yet)
                    </span>
                  )}
                </div>
                <p className="text-ink/50 text-[11px]">Display an alert or notice banner across all active pharmacy workstations in real time.</p>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={broadcast.enabled}
                  onChange={e => setBroadcast({ ...broadcast, enabled: e.target.checked })}
                  className="rounded text-emerald"
                />
                <span className="font-bold text-ink">Enable System Broadcast Banner</span>
              </label>

              <div>
                <label className="block font-bold text-ink/80 mb-1">Banner Alert Type</label>
                <select
                  value={broadcast.type}
                  onChange={e => setBroadcast({ ...broadcast, type: e.target.value })}
                  className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                >
                  <option value="info">Info (Blue)</option>
                  <option value="warning">Warning / Maintenance Notice (Amber)</option>
                  <option value="success">Success / New Feature (Green)</option>
                  <option value="alert">Critical Alert (Red)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-ink/80 mb-1">Broadcast Message</label>
                <textarea
                  rows="3"
                  placeholder="e.g. Scheduled cloud maintenance this Sunday from 2:00 AM to 3:00 AM PKT."
                  value={broadcast.message}
                  onChange={e => setBroadcast({ ...broadcast, message: e.target.value })}
                  className="w-full bg-clinical border border-ink/10 rounded-2xl p-3 text-xs font-medium outline-none focus:border-emerald custom-scrollbar leading-relaxed"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-emerald hover:bg-emerald/90 text-white font-bold rounded-2xl transition-all shadow-md flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>Publish Broadcast Announcement</span>
              </button>
            </form>
          )}

          {/* TAB 6: Security Policy */}
          {activeCategory === 'security' && (
            <form onSubmit={(e) => { e.preventDefault(); handleSaveCategory('security_policy', security, 'security'); }} className="space-y-4 text-xs">
              <div>
                <h3 className="text-base font-black text-ink mb-1">System Security & Session Policies</h3>
                <p className="text-ink/50 text-[11px]">Enforce password complexity, session timeouts, and rate limits.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-ink/80 mb-1">Minimum Password Length</label>
                  <input
                    type="number"
                    min="6"
                    value={security.minPasswordLength}
                    onChange={e => setSecurity({ ...security, minPasswordLength: parseInt(e.target.value, 10) || 8 })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>

                <div>
                  <label className="block font-bold text-ink/80 mb-1">Session Inactivity Timeout (Minutes)</label>
                  <input
                    type="number"
                    min="15"
                    value={security.sessionTimeoutMinutes}
                    onChange={e => setSecurity({ ...security, sessionTimeoutMinutes: parseInt(e.target.value, 10) || 480 })}
                    className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={security.enforceStrongPassword}
                    onChange={e => setSecurity({ ...security, enforceStrongPassword: e.target.checked })}
                    className="rounded text-emerald"
                  />
                  <span className="font-bold text-ink">Enforce Uppercase, Lowercase, and Number requirements for all users</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-emerald hover:bg-emerald/90 text-white font-bold rounded-2xl transition-all shadow-md flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>Save Security Policy</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
