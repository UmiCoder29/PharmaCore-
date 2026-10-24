import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  Sparkles, 
  Clock, 
  Check, 
  Building, 
  Users, 
  ArrowUpRight, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  HelpCircle,
  PhoneCall,
  Mail,
  Zap,
  MessageSquare,
  Send,
  RefreshCw,
  CreditCard,
  Image as ImageIcon,
  Store,
  Save,
  Phone,
  MapPin
} from 'lucide-react';

export default function SubscriptionScreen({ user, onBrandingUpdated }) {
  const [subData, setSubData] = useState(null);
  const [inquiries, setInquiries] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState('professional');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requestSuccess, setRequestSuccess] = useState('');
  const [publicConfig, setPublicConfig] = useState(null);
  const chatBottomRef = useRef(null);

  // Pharmacy Branding Form State
  const [branding, setBranding] = useState({
    name: user?.pharmacyName || '',
    logoUrl: user?.pharmacyLogo || '',
    city: '',
    address: '',
    contactPhone: '',
    contactEmail: '',
    taxNumber: ''
  });
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingSuccess, setBrandingSuccess] = useState('');
  const [brandingError, setBrandingError] = useState('');
  const brandingLoadedRef = useRef(false);

  const fetchSubAndChat = async (isInitial = false) => {
    try {
      const [sub, msgs, plansData, config] = await Promise.all([
        window.pharmacoreAPI.getCurrentSubscription(),
        window.pharmacoreAPI.getPharmacyInquiries().catch(() => []),
        window.pharmacoreAPI.getSubscriptionPlans().catch(() => []),
        window.pharmacoreAPI.getPublicConfig().catch(() => null)
      ]);
      setSubData(sub);
      setInquiries(msgs || []);
      setPlans(plansData || []);
      setPublicConfig(config);

      if (sub && (!brandingLoadedRef.current || isInitial)) {
        setBranding({
          name: sub.name || user?.pharmacyName || '',
          logoUrl: sub.logoUrl || user?.pharmacyLogo || '',
          city: sub.city || '',
          address: sub.address || '',
          contactPhone: sub.contactPhone || '',
          contactEmail: sub.contactEmail || '',
          taxNumber: sub.taxNumber || ''
        });
        brandingLoadedRef.current = true;
      }
    } catch (err) {
      console.error('Failed to load subscription & chat:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubAndChat(true);
    const interval = setInterval(() => fetchSubAndChat(false), 5000);
    return () => clearInterval(interval);
  }, []);

  const branchPercent = subData ? Math.min(100, Math.round((subData.usedBranches / (subData.maxBranches || 1)) * 100)) : 0;
  const userPercent = subData ? Math.min(100, Math.round((subData.usedUsers / (subData.maxUsers || 1)) * 100)) : 0;

  const handleSendInquiry = async (e) => {
    e.preventDefault();
    if (!messageText.trim() || sending) return;

    setSending(true);
    setRequestSuccess('');
    try {
      await window.pharmacoreAPI.sendPharmacyInquiry(
        messageText.trim(),
        'upgrade',
        selectedPlan
      );
      setMessageText('');
      setRequestSuccess('Your upgrade request was sent to the SaaS Platform Admin! They will reply here shortly.');
      await fetchSubAndChat(false);
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      console.error('Failed to send upgrade request:', err);
    } finally {
      setSending(false);
    }
  };

  const handleSaveBranding = async (e) => {
    e.preventDefault();
    setSavingBranding(true);
    setBrandingSuccess('');
    setBrandingError('');
    try {
      const apiFn = 
        window.pharmacoreAPI?.updatePharmacyBranding || 
        window.pharmacoreAPI?.savePharmacyBranding ||
        window.pharmacoreAPI?.updatePharmacyProfile ||
        window.pharmacoreAPI?.savePharmacyProfile;

      if (!apiFn) {
        throw new Error('Branding API is not ready. Please restart the app.');
      }

      const res = await apiFn(branding);
      if (res && res.success) {
        setBrandingSuccess('Pharmacy branding & logo updated successfully!');
        setTimeout(() => setBrandingSuccess(''), 4000);
        if (onBrandingUpdated) {
          onBrandingUpdated(branding);
        }
        await fetchSubAndChat(true);
      } else {
        setBrandingError(res?.error || 'Failed to update branding.');
      }
    } catch (err) {
      console.error(err);
      setBrandingError(err.message || 'Error updating branding.');
    } finally {
      setSavingBranding(false);
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
      setBranding({ ...branding, logoUrl: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const billing = publicConfig?.billing || {};
  const identity = publicConfig?.identity || {};

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-[#071d1a] via-[#0b2b26] to-[#0e3b33] rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            {branding.logoUrl ? (
              <div className="w-16 h-16 rounded-2xl bg-white p-1.5 shadow-md flex items-center justify-center overflow-hidden shrink-0">
                <img src={branding.logoUrl} alt="Pharmacy Logo" className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-emerald/20 border border-emerald/30 flex items-center justify-center shrink-0">
                <Store className="w-8 h-8 text-emerald-300" />
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-3 py-1 bg-emerald/20 text-[#67e8b4] border border-emerald/30 text-xs font-mono font-bold uppercase rounded-full tracking-wider">
                  {subData?.planTier || 'Starter'} Plan
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  subData?.subscriptionStatus === 'active' ? 'bg-emerald text-white' :
                  subData?.subscriptionStatus === 'trial' ? 'bg-blue-500 text-white' : 'bg-terracotta text-white'
                }`}>
                  {subData?.subscriptionStatus?.toUpperCase() || 'ACTIVE'}
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-tight">{subData?.name || branding.name || 'Your Pharmacy'}</h1>
              <p className="text-xs text-emerald-100/70 mt-0.5 max-w-md">
                {identity.tagline || 'Managed SaaS Cloud Plan • Fast POS, multi-branch syncing, automated expiry checks, and live inventory.'}
              </p>
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-md border border-white/10 rounded-2xl p-5 text-center min-w-[200px]">
            <p className="text-xs font-mono uppercase tracking-wider text-emerald-200">Subscription Validity</p>
            <p className="text-3xl font-black text-white mt-1">
              {subData?.daysRemaining ?? 0} <span className="text-sm font-normal text-emerald-200">days left</span>
            </p>
            <p className="text-[11px] text-white/60 mt-1">
              {subData?.subscriptionEndsAt ? `Renews: ${new Date(subData.subscriptionEndsAt).toLocaleDateString()}` : 'Lifetime'}
            </p>
          </div>
        </div>

        {/* Decorative blur */}
        <div className="absolute right-[-10%] top-[-30%] w-72 h-72 bg-[#29c487]/20 rounded-full blur-[90px] pointer-events-none" />
      </div>

      {/* Quota Usage Meters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-ink/10 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald/10 text-emerald flex items-center justify-center">
                <Building className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-ink text-base">Branch Locations</h3>
                <p className="text-xs text-ink/50">Physical stores authorized on your plan</p>
              </div>
            </div>
            <span className="text-sm font-black text-ink">
              {subData?.usedBranches || 1} / {subData?.maxBranches || 1} Used
            </span>
          </div>

          <div className="w-full h-3 bg-clinical rounded-full overflow-hidden border border-ink/5">
            <div 
              className={`h-full transition-all duration-500 rounded-full ${
                branchPercent >= 100 ? 'bg-terracotta' : branchPercent >= 75 ? 'bg-amber' : 'bg-emerald'
              }`}
              style={{ width: `${branchPercent}%` }}
            />
          </div>
          <p className="text-xs text-ink/60">
            {branchPercent >= 100
              ? '⚠️ You have reached your maximum branch limit. Request an upgrade below to open more branches.'
              : `${(subData?.maxBranches || 1) - (subData?.usedBranches || 1)} additional branch slots available.`}
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-ink/10 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-ink text-base">Staff & Cashier Logins</h3>
                <p className="text-xs text-ink/50">Active user accounts allowed on your plan</p>
              </div>
            </div>
            <span className="text-sm font-black text-ink">
              {subData?.usedUsers || 1} / {subData?.maxUsers || 3} Used
            </span>
          </div>

          <div className="w-full h-3 bg-clinical rounded-full overflow-hidden border border-ink/5">
            <div 
              className={`h-full transition-all duration-500 rounded-full ${
                userPercent >= 100 ? 'bg-terracotta' : userPercent >= 75 ? 'bg-amber' : 'bg-emerald'
              }`}
              style={{ width: `${userPercent}%` }}
            />
          </div>
          <p className="text-xs text-ink/60">
            {userPercent >= 100
              ? '⚠️ User quota reached. Request an upgrade below to add more staff.'
              : `${(subData?.maxUsers || 3) - (subData?.usedUsers || 1)} staff slots remaining.`}
          </p>
        </div>
      </div>

      {/* Pharmacy Portal Branding & Logo Customizer */}
      <div className="bg-white rounded-3xl border border-ink/10 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-ink/10 pb-4">
          <div>
            <h2 className="text-xl font-black text-ink tracking-tight flex items-center gap-2">
              <Store className="w-5 h-5 text-emerald" />
              <span>Pharmacy Store Branding & Logo</span>
            </h2>
            <p className="text-xs font-semibold text-ink/60 mt-0.5">
              Customize your pharmacy name, upload your store logo, and set business details shown on customer receipts and your portal.
            </p>
          </div>
        </div>

        {brandingSuccess && (
          <div className="p-3.5 bg-emerald/10 border border-emerald/20 text-emerald text-xs font-bold rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{brandingSuccess}</span>
          </div>
        )}

        {brandingError && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{brandingError}</span>
          </div>
        )}

        <form onSubmit={handleSaveBranding} className="space-y-4 text-xs">
          {/* Logo Customizer */}
          <div className="bg-clinical p-4 rounded-2xl border border-ink/10 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-20 h-20 rounded-2xl bg-white border border-ink/10 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt="Store Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <ImageIcon className="w-8 h-8 text-ink/30" />
              )}
            </div>

            <div className="flex-1 space-y-2 w-full">
              <label className="block font-bold text-ink/80">Pharmacy Logo (PNG / JPG / WebP)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="block w-full text-xs text-ink/60 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald file:text-white hover:file:bg-emerald/90 cursor-pointer"
              />
              <input
                type="text"
                placeholder="Or paste public Image URL (https://...)"
                value={branding.logoUrl || ''}
                onChange={e => setBranding({ ...branding, logoUrl: e.target.value })}
                className="w-full bg-white border border-ink/10 rounded-xl px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-ink/80 mb-1">Pharmacy Business Name *</label>
              <input
                type="text"
                required
                value={branding.name}
                onChange={e => setBranding({ ...branding, name: e.target.value })}
                className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-bold outline-none focus:border-emerald"
              />
            </div>

            <div>
              <label className="block font-bold text-ink/80 mb-1">City / Region</label>
              <input
                type="text"
                placeholder="e.g. Lahore, Karachi, Islamabad"
                value={branding.city}
                onChange={e => setBranding({ ...branding, city: e.target.value })}
                className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-bold text-ink/80 mb-1">Phone / Mobile</label>
              <input
                type="text"
                placeholder="+92 300 1234567"
                value={branding.contactPhone}
                onChange={e => setBranding({ ...branding, contactPhone: e.target.value })}
                className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
              />
            </div>

            <div>
              <label className="block font-bold text-ink/80 mb-1">Email Address</label>
              <input
                type="email"
                placeholder="contact@pharmacy.pk"
                value={branding.contactEmail}
                onChange={e => setBranding({ ...branding, contactEmail: e.target.value })}
                className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald"
              />
            </div>

            <div>
              <label className="block font-bold text-ink/80 mb-1">FBR NTN / STRN Tax Number</label>
              <input
                type="text"
                placeholder="e.g. 7654321-0"
                value={branding.taxNumber}
                onChange={e => setBranding({ ...branding, taxNumber: e.target.value })}
                className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-mono font-semibold outline-none focus:border-emerald"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-ink/80 mb-1">Street Address (Printed on Receipts)</label>
            <input
              type="text"
              placeholder="Shop # 4, Main Commercial Market, Phase 5..."
              value={branding.address}
              onChange={e => setBranding({ ...branding, address: e.target.value })}
              className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-medium outline-none focus:border-emerald"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingBranding}
              className="px-6 py-2.5 bg-emerald hover:bg-emerald/90 text-white rounded-2xl font-bold transition-all shadow-md flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{savingBranding ? 'Saving...' : 'Save Store Branding'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Direct Upgrade Request & Chat with SuperAdmin */}
      <div className="bg-white rounded-3xl border border-ink/10 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ink/10 pb-4">
          <div>
            <h2 className="text-xl font-black text-ink tracking-tight flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald" />
              <span>Chat with SaaS Platform Representative (Free 24/7)</span>
            </h2>
            <p className="text-xs font-semibold text-ink/60 mt-0.5">
              Request subscription tier upgrades, ask technical questions, or request billing assistance directly from the platform owner.
            </p>
          </div>

          <button
            onClick={fetchSubAndChat}
            className="px-3 py-1.5 bg-clinical hover:bg-ink/10 rounded-xl text-xs font-bold text-ink flex items-center gap-1.5 self-start"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald" />
            <span>Refresh Messages</span>
          </button>
        </div>

        {/* Message Thread History */}
        <div className="bg-slate-50/70 rounded-2xl p-4 sm:p-6 max-h-72 overflow-y-auto space-y-3 custom-scrollbar border border-ink/5">
          {inquiries.length === 0 ? (
            <div className="text-center py-6 text-ink/40 text-xs">
              <Sparkles className="w-6 h-6 mx-auto mb-2 text-emerald/60" />
              No messages yet. Send a request below to upgrade your plan or ask questions!
            </div>
          ) : (
            inquiries.map((msg, idx) => {
              const isVendor = msg.senderRole === 'superadmin';
              return (
                <div
                  key={msg.id || idx}
                  className={`flex flex-col ${isVendor ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-ink/40 mb-1 px-1">
                    <span className="font-bold text-ink/70">
                      {isVendor ? '🛡️ PharmaCore Platform Support' : msg.senderName}
                    </span>
                    <span>•</span>
                    <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div className={`max-w-md rounded-2xl p-3.5 text-xs font-medium leading-relaxed shadow-sm ${
                    isVendor
                      ? 'bg-emerald text-white rounded-tl-none'
                      : 'bg-white border border-ink/10 text-ink rounded-tr-none'
                  }`}>
                    {msg.requestedPlan && !isVendor && (
                      <span className="inline-block px-2 py-0.5 bg-emerald/20 text-emerald text-[10px] font-bold rounded mb-1 uppercase">
                        Upgrade Request: {msg.requestedPlan} Plan
                      </span>
                    )}
                    <p>{msg.message}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatBottomRef} />
        </div>

        {requestSuccess && (
          <div className="p-3.5 bg-emerald/10 border border-emerald/20 text-emerald text-xs font-bold rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{requestSuccess}</span>
          </div>
        )}

        {/* Send Form */}
        <form onSubmit={handleSendInquiry} className="space-y-3">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="w-full sm:w-1/3">
              <label className="block text-[11px] font-bold text-ink/70 mb-1">Target Plan to Request</label>
              <select
                value={selectedPlan}
                onChange={e => setSelectedPlan(e.target.value)}
                className="w-full bg-clinical border border-ink/10 rounded-2xl px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-emerald capitalize"
              >
                {plans.filter(p => p.slug !== 'trial').map(p => (
                  <option key={p.id || p.slug} value={p.slug}>
                    {p.name} ({p.currency || 'PKR'} {p.priceMonthly?.toLocaleString()} / mo)
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-2/3">
              <label className="block text-[11px] font-bold text-ink/70 mb-1">Your Message or Requirements</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="e.g. We want to upgrade to Professional for 3 new branches and need invoice details."
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  className="flex-1 bg-clinical border border-ink/10 rounded-2xl px-4 py-2.5 text-xs font-medium outline-none focus:border-emerald focus:bg-white transition-all"
                />
                <button
                  type="submit"
                  disabled={sending || !messageText.trim()}
                  className="px-5 py-2.5 bg-emerald hover:bg-emerald/90 text-white rounded-2xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Request</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Payment Instructions Box */}
      {billing.bankName && (
        <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-black tracking-tight">Official Payment & Bank Accounts</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60 space-y-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-300 font-bold">Bank Transfer</p>
              <p className="font-extrabold text-sm">{billing.bankName}</p>
              <p className="text-slate-300">Title: <strong>{billing.accountTitle}</strong></p>
              <p className="font-mono text-slate-200">A/C: {billing.accountNumber}</p>
              {billing.iban && <p className="font-mono text-[10px] text-slate-400">IBAN: {billing.iban}</p>}
            </div>

            <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60 space-y-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-amber-300 font-bold">JazzCash</p>
              <p className="font-extrabold text-sm">{billing.jazzcashNumber || '0300-1234567'}</p>
              <p className="text-slate-300">Title: <strong>{billing.accountTitle}</strong></p>
              <p className="text-[11px] text-slate-400">Send proof to chat above</p>
            </div>

            <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60 space-y-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">EasyPaisa</p>
              <p className="font-extrabold text-sm">{billing.easypaisaNumber || '0300-1234567'}</p>
              <p className="text-slate-300">Title: <strong>{billing.accountTitle}</strong></p>
              <p className="text-[11px] text-slate-400">Instant verification & unlock</p>
            </div>
          </div>

          {billing.paymentInstructions && (
            <p className="text-xs text-slate-300 pt-2 border-t border-slate-800">
              💡 {billing.paymentInstructions}
            </p>
          )}
        </div>
      )}

      {/* Available Plan Tiers Breakdown */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-black text-ink tracking-tight">Available Subscription Tiers</h2>
          <p className="text-xs font-semibold text-ink/60">Choose the right capacity for your growing pharmacy network</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {plans.map((plan) => {
            const isCurrent = subData?.planTier === plan.slug;
            return (
              <div 
                key={plan.id || plan.slug}
                className={`bg-white rounded-3xl p-6 border shadow-sm flex flex-col justify-between ${
                  isCurrent ? 'border-2 border-emerald ring-2 ring-emerald/20' : 'border-ink/10'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-lg text-ink">{plan.name}</h3>
                    {isCurrent && (
                      <span className="px-2.5 py-0.5 bg-emerald/10 text-emerald text-[11px] font-bold rounded-full">Current</span>
                    )}
                  </div>
                  <p className="text-xs text-ink/60 min-h-[32px]">{plan.description}</p>
                  
                  <div className="py-2 border-y border-ink/5 font-mono text-xl font-black text-ink">
                    {plan.priceMonthly === 0 ? 'Free' : `${plan.currency || 'PKR'} ${plan.priceMonthly?.toLocaleString()}`}
                    {plan.priceMonthly > 0 && <span className="text-xs font-normal text-ink/50"> / mo</span>}
                  </div>

                  <ul className="space-y-2 text-xs text-ink/80 font-medium">
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald shrink-0" />
                      <span>{plan.maxBranches > 50 ? 'Unlimited Branches' : `${plan.maxBranches} Branch Locations`}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald shrink-0" />
                      <span>{plan.maxUsers > 50 ? 'Unlimited Users' : `${plan.maxUsers} Staff Accounts`}</span>
                    </li>
                    {(Array.isArray(plan.features) ? plan.features : []).slice(0, 4).map((f, i) => (
                      <li key={i} className="flex items-center gap-2 truncate">
                        <Check className="w-4 h-4 text-emerald shrink-0" />
                        <span className="truncate">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
