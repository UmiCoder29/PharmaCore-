import React, { useState, useEffect } from 'react';
import { 
  CreditCard, 
  Sparkles, 
  Check, 
  Building, 
  Users, 
  Zap, 
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Eye,
  EyeOff,
  DollarSign,
  Layers,
  AlertCircle,
  X,
  Tag,
  Sliders,
  Shield,
  Award,
  Clock
} from 'lucide-react';

export default function SaasPlansScreen({ user }) {
  const [plans, setPlans] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null); // null = create, object = edit

  // Form State
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [priceMonthly, setPriceMonthly] = useState('3000');
  const [priceAnnual, setPriceAnnual] = useState('30000');
  const [currency, setCurrency] = useState('PKR');
  const [maxBranches, setMaxBranches] = useState('1');
  const [maxUsers, setMaxUsers] = useState('3');
  const [featuresText, setFeaturesText] = useState('');
  const [badge, setBadge] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchPlansAndStats = async () => {
    setLoading(true);
    try {
      const [plansData, statsData] = await Promise.all([
        window.pharmacoreAPI.getSubscriptionPlans(),
        window.pharmacoreAPI.getPlatformStats().catch(() => null)
      ]);
      if (plansData && plansData.success === false) {
        setPlans([]);
      } else {
        setPlans(Array.isArray(plansData) ? plansData : (plansData?.data || []));
      }
      setStats(statsData?.data || statsData || null);
    } catch (err) {
      console.error('Error fetching plans:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlansAndStats();
  }, []);

  const openCreateModal = () => {
    setEditingPlan(null);
    setName('');
    setSlug('');
    setDescription('');
    setPriceMonthly('5000');
    setPriceAnnual('50000');
    setCurrency('PKR');
    setMaxBranches('2');
    setMaxUsers('5');
    setFeaturesText('2 Store Branches\nUp to 5 Staff Accounts\nFull POS & Receipts\nExpiry Alerts');
    setBadge('');
    setIsPublic(true);
    setIsActive(true);
    setSortOrder((plans.length + 1).toString());
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (plan) => {
    setEditingPlan(plan);
    setName(plan.name || '');
    setSlug(plan.slug || '');
    setDescription(plan.description || '');
    setPriceMonthly((plan.priceMonthly || 0).toString());
    setPriceAnnual((plan.priceAnnual || 0).toString());
    setCurrency(plan.currency || 'PKR');
    setMaxBranches((plan.maxBranches || 1).toString());
    setMaxUsers((plan.maxUsers || 3).toString());
    setFeaturesText(Array.isArray(plan.features) ? plan.features.join('\n') : '');
    setBadge(plan.badge || '');
    setIsPublic(plan.isPublic !== false);
    setIsActive(plan.isActive !== false);
    setSortOrder((plan.sortOrder || 0).toString());
    setFormError('');
    setShowModal(true);
  };

  const handleSavePlan = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim()) {
      setFormError('Plan Name is required.');
      return;
    }

    setIsSaving(true);
    try {
      const features = featuresText
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean);

      const planData = {
        name: name.trim(),
        slug: slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'),
        description: description.trim(),
        priceMonthly: parseFloat(priceMonthly) || 0,
        priceAnnual: parseFloat(priceAnnual) || 0,
        currency: currency.trim() || 'PKR',
        maxBranches: parseInt(maxBranches, 10) || 1,
        maxUsers: parseInt(maxUsers, 10) || 3,
        features,
        badge: badge.trim() || null,
        isPublic,
        isActive,
        sortOrder: parseInt(sortOrder, 10) || 0
      };

      if (editingPlan) {
        const res = await window.pharmacoreAPI.updateSubscriptionPlan(editingPlan.id, planData);
        if (!res.success) {
          setFormError(res.error || 'Failed to update plan.');
          setIsSaving(false);
          return;
        }
      } else {
        const res = await window.pharmacoreAPI.createSubscriptionPlan(planData);
        if (!res.success) {
          setFormError(res.error || 'Failed to create plan.');
          setIsSaving(false);
          return;
        }
      }

      setShowModal(false);
      fetchPlansAndStats();
    } catch (err) {
      console.error(err);
      setFormError(err.message || 'An error occurred.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePlan = async (id, planName) => {
    if (!window.confirm(`Are you sure you want to delete the plan "${planName}"?`)) return;
    try {
      const res = await window.pharmacoreAPI.deleteSubscriptionPlan(id);
      if (res.success) {
        fetchPlansAndStats();
      } else {
        alert(res.error || 'Failed to delete plan.');
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting plan.');
    }
  };

  const handleToggleActive = async (plan) => {
    try {
      await window.pharmacoreAPI.updateSubscriptionPlan(plan.id, {
        isActive: !plan.isActive
      });
      fetchPlansAndStats();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-ink tracking-tight">Subscription Plans & Tier Builder</h1>
            <span className="px-2.5 py-0.5 bg-emerald/10 text-emerald rounded-full text-xs font-mono font-bold">
              SaaS Engine
            </span>
          </div>
          <p className="text-xs font-semibold text-ink/60 mt-0.5">
            Add new subscription packages, configure pricing in PKR, set branch/user quota limits, and define feature matrices.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchPlansAndStats}
            className="p-2.5 bg-white border border-ink/10 rounded-2xl hover:bg-slate-50 transition-all text-ink shadow-sm"
            title="Refresh Plans"
          >
            <RefreshCw className="w-4 h-4 text-emerald" />
          </button>

          <button
            onClick={openCreateModal}
            className="px-4 py-2.5 bg-emerald hover:bg-emerald/90 text-white rounded-2xl text-xs font-bold transition-all shadow-md flex items-center gap-2"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Create New Plan</span>
          </button>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {plans.map((plan) => {
          const isTrial = plan.slug === 'trial';
          return (
            <div 
              key={plan.id || plan.slug}
              className={`bg-white rounded-3xl p-6 border shadow-sm flex flex-col justify-between relative transition-all duration-200 ${
                !plan.isActive 
                  ? 'opacity-60 border-dashed border-slate-300' 
                  : plan.badge === 'Most Popular'
                  ? 'border-2 border-emerald ring-2 ring-emerald/10'
                  : 'border-ink/10'
              }`}
            >
              {plan.badge && (
                <div className={`absolute top-0 right-0 text-[10px] font-mono font-bold uppercase px-3 py-1 rounded-bl-xl text-white ${
                  plan.badge === 'Most Popular' ? 'bg-emerald' : 'bg-purple-600'
                }`}>
                  {plan.badge}
                </div>
              )}

              <div className="space-y-4">
                <div className="pr-12">
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-lg text-ink truncate">{plan.name}</h3>
                  </div>
                  <p className="text-[11px] text-ink/50 mt-1 font-mono uppercase tracking-wider">
                    Slug: {plan.slug}
                  </p>
                </div>

                <p className="text-xs text-ink/60 min-h-[32px] line-clamp-2">
                  {plan.description || 'Commercial SaaS subscription tier.'}
                </p>

                {/* Price Display */}
                <div className="py-2.5 border-y border-ink/5">
                  <div className="font-mono text-xl font-black text-ink">
                    {plan.priceMonthly === 0 ? 'Free' : `${plan.currency || 'PKR'} ${plan.priceMonthly.toLocaleString()}`}
                    {plan.priceMonthly > 0 && <span className="text-xs font-normal text-ink/50"> / mo</span>}
                  </div>
                  {plan.priceAnnual > 0 && (
                    <p className="text-[10px] font-mono text-emerald font-bold mt-0.5">
                      Annual: {plan.currency || 'PKR'} {plan.priceAnnual.toLocaleString()} / yr
                    </p>
                  )}
                </div>

                {/* Quotas */}
                <div className="grid grid-cols-2 gap-2 bg-clinical p-2.5 rounded-2xl text-[11px] font-semibold text-ink/80">
                  <div className="flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-emerald" />
                    <span>{plan.maxBranches > 50 ? 'Unlimited' : `${plan.maxBranches} Branch`}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-blue-600" />
                    <span>{plan.maxUsers > 50 ? 'Unlimited' : `${plan.maxUsers} Users`}</span>
                  </div>
                </div>

                {/* Features List */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Included Features</p>
                  <ul className="space-y-1.5 text-xs text-ink/75 font-medium">
                    {(Array.isArray(plan.features) ? plan.features : []).slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-center gap-2 truncate">
                        <Check className="w-3.5 h-3.5 text-emerald shrink-0" />
                        <span className="truncate">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 pt-4 border-t border-ink/10 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleToggleActive(plan)}
                  className={`p-2 rounded-xl text-xs font-bold border transition-all ${
                    plan.isActive 
                      ? 'bg-emerald/10 text-emerald border-emerald/20 hover:bg-emerald/20' 
                      : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                  }`}
                  title={plan.isActive ? 'Active on Storefront' : 'Hidden / Inactive'}
                >
                  {plan.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditModal(plan)}
                    className="px-3 py-1.5 bg-clinical hover:bg-ink/10 text-ink rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-slate-600" />
                    <span>Edit</span>
                  </button>

                  {!['trial', 'starter', 'professional', 'enterprise'].includes(plan.slug) && (
                    <button
                      onClick={() => handleDeletePlan(plan.id, plan.name)}
                      className="p-2 bg-terracotta/10 hover:bg-terracotta/20 text-terracotta rounded-xl text-xs transition-all"
                      title="Delete Plan"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modern High-End Plan Builder / Editor Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="relative z-[101] bg-white text-slate-900 rounded-[28px] max-w-2xl w-full shadow-2xl border border-slate-200/80 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header with Gradient & Icon */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-5 sm:px-8 text-white flex items-center justify-between border-b border-slate-700/60 relative">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-inner shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
                    {editingPlan ? `Edit Tier: ${editingPlan.name}` : 'Create Subscription Package'}
                  </h2>
                  <p className="text-xs text-slate-300 font-medium">
                    Configure pricing, quotas, feature checklist & client entitlements
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowModal(false)} 
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center font-bold text-sm transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="mx-6 sm:mx-8 mt-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-2xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Scrollable Form Body */}
            <form onSubmit={handleSavePlan} className="p-6 sm:p-8 space-y-5 max-h-[calc(85vh-140px)] overflow-y-auto custom-scrollbar text-xs">
              
              {/* Section 1: Identity & Slug */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Tag className="w-3.5 h-3.5 text-emerald-600" />
                  <span>1. Plan Identity & Slug</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Plan Display Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Professional Growth Tier"
                      value={name}
                      onChange={e => {
                        setName(e.target.value);
                        if (!editingPlan) {
                          setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
                        }
                      }}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">System Slug Identifier</label>
                    <input
                      type="text"
                      placeholder="e.g. professional_growth"
                      value={slug}
                      onChange={e => setSlug(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Target Audience & Short Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Designed for busy multi-counter retail & chain pharmacies"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm"
                  />
                </div>
              </div>

              {/* Section 2: Commercial Pricing */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    <span>2. Commercial Pricing</span>
                  </div>
                  {parseFloat(priceMonthly) > 0 && parseFloat(priceAnnual) > 0 && (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full">
                      Annual Discount: {Math.max(0, Math.round((1 - (parseFloat(priceAnnual) / (parseFloat(priceMonthly) * 12))) * 100))}% OFF
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Monthly Fee ({currency})</label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        placeholder="5000"
                        value={priceMonthly}
                        onChange={e => setPriceMonthly(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Annual Fee (12 Months)</label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        placeholder="50000"
                        value={priceAnnual}
                        onChange={e => setPriceAnnual(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Currency Code</label>
                    <input
                      type="text"
                      value={currency}
                      onChange={e => setCurrency(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 uppercase shadow-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Branch & User Quotas */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Building className="w-3.5 h-3.5 text-emerald-600" />
                  <span>3. Capacity & Quota Limits</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-700 flex items-center gap-1.5">
                        <Building className="w-4 h-4 text-emerald-600" />
                        <span>Branch Locations</span>
                      </label>
                      <span className="font-mono font-bold text-slate-500 text-[11px]">Stores Allowed</span>
                    </div>
                    <input
                      type="number"
                      min="1"
                      placeholder="3"
                      value={maxBranches}
                      onChange={e => setMaxBranches(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:bg-white focus:border-emerald-600"
                    />
                  </div>

                  <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-700 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-blue-600" />
                        <span>Staff Accounts</span>
                      </label>
                      <span className="font-mono font-bold text-slate-500 text-[11px]">Logins Allowed</span>
                    </div>
                    <input
                      type="number"
                      min="1"
                      placeholder="10"
                      value={maxUsers}
                      onChange={e => setMaxUsers(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:bg-white focus:border-emerald-600"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Marketing Badge & Feature Highlights */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3.5">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Award className="w-3.5 h-3.5 text-emerald-600" />
                  <span>4. Badge Tag & Feature Checklist</span>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Marketing Tag Badge (Optional)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Most Popular, Best Value, Enterprise"
                      value={badge}
                      onChange={e => setBadge(e.target.value)}
                      className="flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    />
                    {badge && (
                      <span className="px-3 py-1 bg-purple-600 text-white rounded-xl font-mono text-[10px] font-black uppercase">
                        {badge}
                      </span>
                    )}
                  </div>

                  {/* Preset Badge Chips */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {['Most Popular', 'Best Value', 'Enterprise', 'Single Store', 'Trial'].map(b => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBadge(b)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                          badge === b 
                            ? 'bg-purple-600 text-white shadow-sm' 
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        + {b}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-bold text-slate-700">Included Features (1 per line)</label>
                    <span className="text-[10px] text-slate-400 font-mono">Lines: {featuresText.split('\n').filter(Boolean).length}</span>
                  </div>
                  <textarea
                    rows="4"
                    placeholder="Up to 3 Store Branches&#10;Up to 10 Cashier Accounts&#10;Thermal Printing&#10;FEFO Batch Expiry"
                    value={featuresText}
                    onChange={e => setFeaturesText(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl p-3 text-xs font-medium text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all custom-scrollbar leading-relaxed shadow-sm font-sans"
                  />

                  {/* Quick Feature Helper Chips */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[
                      'Thermal & POS Receipt Printing',
                      'FEFO Expiry & Low Stock Alerts',
                      'FBR Digital POS Invoicing',
                      'Cross-Branch Inventory Sync',
                      'Customer Ledger & Wholesale',
                      'Local Offline Mode & Sync',
                      'Priority 24/7 Phone Support'
                    ].map(feat => (
                      <button
                        key={feat}
                        type="button"
                        onClick={() => {
                          const current = featuresText.trim();
                          if (!current.includes(feat)) {
                            setFeaturesText(current ? `${current}\n${feat}` : feat);
                          }
                        }}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-all"
                      >
                        + {feat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 5: Visibility Switches */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <label className="flex items-center gap-3 cursor-pointer w-full sm:w-auto">
                  <div 
                    onClick={() => setIsActive(!isActive)}
                    className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer ${
                      isActive ? 'bg-emerald-600' : 'bg-slate-300'
                    }`}
                  >
                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                      isActive ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-xs">Plan is Active</p>
                    <p className="text-[10px] text-slate-500">Enable purchasing & assignment in SaaS engine</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer w-full sm:w-auto">
                  <div 
                    onClick={() => setIsPublic(!isPublic)}
                    className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer ${
                      isPublic ? 'bg-emerald-600' : 'bg-slate-300'
                    }`}
                  >
                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                      isPublic ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-xs">Public Onboarding</p>
                    <p className="text-[10px] text-slate-500">Show on public signup pricing table</p>
                  </div>
                </label>
              </div>

              {/* Sticky / Fixed Footer Action Bar */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  <span>Status: {isActive ? 'Live' : 'Draft'}</span>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50 flex items-center gap-2 text-xs"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving Package...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>{editingPlan ? 'Save Changes' : 'Publish Subscription Tier'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
