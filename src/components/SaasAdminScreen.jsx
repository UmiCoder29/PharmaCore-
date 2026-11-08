import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Users, 
  DollarSign, 
  ShieldCheck, 
  Plus, 
  Search, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  MoreVertical, 
  RefreshCw, 
  Sparkles, 
  Calendar, 
  ArrowUpRight,
  Store,
  Layers,
  Edit3,
  X,
  Tag,
  Shield,
  Sliders,
  Check,
  Lock,
  Mail,
  Phone,
  MapPin,
  UserPlus,
  Copy
} from 'lucide-react';
import DataTable from './DataTable.jsx';

function generateUsername(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  let clean = fullName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!clean) return '';
  if (clean.length < 3) clean = clean.padEnd(3, '_');
  if (clean.length > 50) clean = clean.slice(0, 50).replace(/_+$/, '');
  return clean;
}

export default function SaasAdminScreen({ user }) {
  const [pharmacies, setPharmacies] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, trial, suspended
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState({ message: '', type: '' });
  const [provisionedCredentials, setProvisionedCredentials] = useState(null);
  const [copied, setCopied] = useState(false);

  // Create Pharmacy Form
  const [formData, setFormData] = useState({
    pharmacyName: '',
    city: 'Karachi',
    phone: '',
    email: '',
    username: '',
    name: '',
    branchName: 'Main Branch',
    planTier: 'trial'
  });

  // Edit Subscription Form
  const [editData, setEditData] = useState({
    planTier: 'professional',
    subscriptionStatus: 'active',
    maxBranches: 5,
    maxUsers: 15,
    extensionDays: 30
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pharmRes, statsRes] = await Promise.all([
        window.pharmacoreAPI.getPharmacies(),
        window.pharmacoreAPI.getPlatformStats()
      ]);

      if (pharmRes && pharmRes.success === false) {
        showNotice(pharmRes.error || 'Failed to load pharmacies.', 'error');
        setPharmacies([]);
      } else {
        setPharmacies(Array.isArray(pharmRes) ? pharmRes : (pharmRes?.data || []));
      }

      if (statsRes && statsRes.success === false) {
        showNotice(statsRes.error || 'Failed to load platform stats.', 'error');
        setStats(null);
      } else {
        setStats(statsRes?.data || statsRes || null);
      }
    } catch (err) {
      console.error('Failed to load SaaS data:', err);
      showNotice('Failed to load platform data: ' + (err.message || ''), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showNotice = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification({ message: '', type: '' }), 5000);
  };

  const handleCreatePharmacy = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const res = await window.pharmacoreAPI.createPharmacy({
        pharmacyName: formData.pharmacyName,
        city: formData.city,
        phone: formData.phone || null,
        adminEmail: formData.email,
        adminDisplayName: formData.name || null,
        adminUsername: formData.username,
        branchName: formData.branchName,
        planTier: formData.planTier
      });
      if (res.success) {
        showNotice(`Pharmacy "${formData.pharmacyName}" provisioned successfully!`);
        setShowCreateModal(false);
        setProvisionedCredentials({
          pharmacyName: res.pharmacy?.name || formData.pharmacyName,
          pharmacySlug: res.pharmacy?.slug || '',
          email: res.admin?.email || formData.email,
          username: res.finalUsername || res.admin?.username || formData.username,
          temporaryPassword: res.temporaryPassword,
          note: res.note || null
        });
        setFormData({
          pharmacyName: '',
          city: 'Karachi',
          phone: '',
          email: '',
          username: '',
          name: '',
          branchName: 'Main Branch',
          planTier: 'trial'
        });
        fetchData();
      } else {
        showNotice(res.error || 'Failed to create pharmacy tenant. The owner login email may already be registered.', 'error');
      }
    } catch (err) {
      showNotice(err.message || 'Error provisioning pharmacy.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenEdit = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    setEditData({
      planTier: pharmacy.planTier || 'starter',
      subscriptionStatus: pharmacy.subscriptionStatus || 'active',
      maxBranches: pharmacy.maxBranches || 1,
      maxUsers: pharmacy.maxUsers || 3,
      extensionDays: 30
    });
    setShowEditModal(true);
  };

  const handleUpdateSubscription = async (e) => {
    e.preventDefault();
    if (!selectedPharmacy) return;
    setActionLoading(true);
    try {
      const currentExpiry = selectedPharmacy.subscriptionEndsAt 
        ? new Date(selectedPharmacy.subscriptionEndsAt) 
        : new Date();
      
      const newExpiry = new Date(Math.max(currentExpiry.getTime(), Date.now()));
      if (editData.extensionDays > 0) {
        newExpiry.setDate(newExpiry.getDate() + parseInt(editData.extensionDays, 10));
      }

      const res = await window.pharmacoreAPI.updatePharmacySubscription(selectedPharmacy.id, {
        planTier: editData.planTier,
        subscriptionStatus: editData.subscriptionStatus,
        subscriptionEndsAt: editData.extensionDays > 0 ? newExpiry.toISOString() : undefined,
        maxBranches: editData.maxBranches,
        maxUsers: editData.maxUsers
      });

      if (res && res.success === false) {
        showNotice(res.error || 'Failed to update subscription.', 'error');
        return;
      }

      showNotice(`Subscription for "${selectedPharmacy.name}" updated.`);
      setShowEditModal(false);
      fetchData();
    } catch (err) {
      showNotice(err.message || 'Failed to update subscription.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (pharmacy, newStatus) => {
    setActionLoading(true);
    try {
      const res = await window.pharmacoreAPI.togglePharmacyStatus(pharmacy.id, newStatus);
      if (res && res.success === false) {
        showNotice(res.error || 'Failed to change status.', 'error');
        return;
      }
      showNotice(`Pharmacy "${pharmacy.name}" status changed to ${newStatus}.`);
      fetchData();
    } catch (err) {
      showNotice(err.message || 'Failed to change status.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickExtend = async (pharmacy, days) => {
    setActionLoading(true);
    try {
      const currentExpiry = pharmacy.subscriptionEndsAt ? new Date(pharmacy.subscriptionEndsAt) : new Date();
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      baseDate.setDate(baseDate.getDate() + days);

      const res = await window.pharmacoreAPI.updatePharmacySubscription(pharmacy.id, {
        subscriptionStatus: 'active',
        subscriptionEndsAt: baseDate.toISOString()
      });

      if (res && res.success === false) {
        showNotice(res.error || 'Failed to extend subscription.', 'error');
        return;
      }

      showNotice(`Extended "${pharmacy.name}" by ${days} days.`);
      fetchData();
    } catch (err) {
      showNotice(err.message || 'Failed to extend subscription.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Filter pharmacies
  const filteredPharmacies = pharmacies.filter((p) => {
    const matchesSearch = 
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.city?.toLowerCase().includes(search.toLowerCase()) ||
      p.slug?.toLowerCase().includes(search.toLowerCase()) ||
      p.contactEmail?.toLowerCase().includes(search.toLowerCase());

    if (statusFilter === 'all') return matchesSearch;
    if (statusFilter === 'active') return matchesSearch && p.subscriptionStatus === 'active';
    if (statusFilter === 'trial') return matchesSearch && p.subscriptionStatus === 'trial';
    if (statusFilter === 'suspended') return matchesSearch && ['suspended', 'past_due', 'cancelled'].includes(p.subscriptionStatus);
    return matchesSearch;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {notification.message && (
        <div className={`p-4 rounded-xl flex items-center justify-between text-sm font-semibold shadow-lg transition-all animate-bounce ${
          notification.type === 'error' ? 'bg-terracotta text-white' : 'bg-emerald text-white'
        }`}>
          <span>{notification.message}</span>
          <button onClick={() => setNotification({ message: '', type: '' })} className="opacity-80 hover:opacity-100">×</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-[#071d1a] to-[#0d3b35] p-6 sm:p-8 rounded-3xl text-white shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 bg-emerald/20 text-[#67e8b4] border border-emerald/30 text-xs font-mono font-bold uppercase rounded-full tracking-wider">
              SaaS Control Center
            </span>
            <span className="text-xs text-white/60 font-mono">Multi-Tenant B2B Platform</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight">Pharmacy Clients & Subscriptions</h1>
          <p className="text-sm text-emerald-100/70 mt-1 max-w-xl">
            Manage your subscribed pharmacy clients, monitor monthly recurring revenue, adjust licensing tiers, and onboard new pharmacies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl transition-all flex items-center justify-center"
            title="Refresh Data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-3.5 bg-[#29c487] hover:bg-[#20aa74] text-[#071d1a] font-bold text-sm rounded-2xl shadow-lg hover:shadow-emerald/30 transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5 stroke-[2.5]" />
            <span>Provision New Pharmacy</span>
          </button>
        </div>
      </div>

      {/* Platform Analytics KPI Grid */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-ink/10 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-ink/50 uppercase tracking-wider">Total Clients</p>
              <p className="text-2xl font-black text-ink mt-1">{stats.totalPharmacies}</p>
              <p className="text-xs font-semibold text-emerald mt-1">
                {stats.activeSubscriptions} Active • {stats.trialSubscriptions} Trial
              </p>
            </div>
            <div className="w-12 h-12 bg-emerald/10 text-emerald rounded-2xl flex items-center justify-center">
              <Store className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-ink/10 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-ink/50 uppercase tracking-wider">Estimated MRR</p>
              <p className="text-2xl font-black text-ink mt-1">
                {stats.currency} {stats.estimatedMRR?.toLocaleString()}
              </p>
              <p className="text-xs font-semibold text-ink/60 mt-1">Monthly recurring</p>
            </div>
            <div className="w-12 h-12 bg-amber/10 text-amber rounded-2xl flex items-center justify-center">
              <DollarSign className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-ink/10 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-ink/50 uppercase tracking-wider">Platform Revenue</p>
              <p className="text-2xl font-black text-ink mt-1">
                {stats.totalSalesRevenue !== null && stats.totalSalesRevenue !== undefined
                  ? `${stats.currency || 'PKR'} ${stats.totalSalesRevenue.toLocaleString()}`
                  : <span className="text-sm font-semibold text-ink/40">Not available yet</span>
                }
              </p>
              <p className="text-xs font-semibold text-ink/60 mt-1">Tenant GMV volume</p>
            </div>
            <div className="w-12 h-12 bg-emerald/10 text-emerald rounded-2xl flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-ink/10 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-ink/50 uppercase tracking-wider">Active Staff Users</p>
              <p className="text-2xl font-black text-ink mt-1">{stats.totalUsers}</p>
              <p className="text-xs font-semibold text-ink/60 mt-1">Across all clients</p>
            </div>
            <div className="w-12 h-12 bg-blue-500/10 text-blue-600 rounded-2xl flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-ink/10 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-ink/50 uppercase tracking-wider">Total Branches</p>
              <p className="text-2xl font-black text-ink mt-1">{stats.totalBranches}</p>
              <p className="text-xs font-semibold text-ink/60 mt-1">Operational locations</p>
            </div>
            <div className="w-12 h-12 bg-purple-500/10 text-purple-600 rounded-2xl flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
          </div>
        </div>
      )}

      {/* Directory & Filters */}
      <div className="bg-white rounded-3xl border border-ink/10 shadow-sm overflow-hidden p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
            {[
              { id: 'all', label: `All (${pharmacies.length})` },
              { id: 'active', label: `Active (${pharmacies.filter(p => p.subscriptionStatus === 'active').length})` },
              { id: 'trial', label: `Trial (${pharmacies.filter(p => p.subscriptionStatus === 'trial').length})` },
              { id: 'suspended', label: `Suspended (${pharmacies.filter(p => ['suspended', 'past_due', 'cancelled'].includes(p.subscriptionStatus)).length})` },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-ink text-white shadow-md'
                    : 'bg-clinical hover:bg-ink/5 text-ink/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[260px]">
            <Search className="w-4 h-4 text-ink/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search pharmacy, city, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-clinical border border-ink/10 rounded-2xl text-xs font-medium outline-none focus:border-emerald focus:bg-white focus:ring-2 focus:ring-emerald/10 transition-all"
            />
          </div>
        </div>

        {/* Pharmacy Client Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-ink/10 text-[11px] font-mono font-bold uppercase tracking-wider text-ink/50 bg-clinical/50">
                <th className="py-3 px-4 rounded-l-xl">Pharmacy Business</th>
                <th className="py-3 px-4">Plan Tier</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Subscription Valid Until</th>
                <th className="py-3 px-4">Branches</th>
                <th className="py-3 px-4">Staff Quota</th>
                <th className="py-3 px-4">Total Revenue</th>
                <th className="py-3 px-4 text-right rounded-r-xl">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5 text-sm">
              {loading ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-ink/40 font-medium">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald" />
                    Loading pharmacy tenants...
                  </td>
                </tr>
              ) : filteredPharmacies.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-ink/50">
                    <Store className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No pharmacies found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredPharmacies.map((pharm) => {
                  const isExpired = pharm.subscriptionEndsAt && new Date(pharm.subscriptionEndsAt) < new Date();
                  const daysLeft = pharm.subscriptionEndsAt
                    ? Math.ceil((new Date(pharm.subscriptionEndsAt) - new Date()) / (1000 * 60 * 60 * 24))
                    : 0;

                  return (
                    <tr key={pharm.id} className="hover:bg-clinical/40 transition-colors">
                      <td className="py-4 px-4 font-semibold text-ink">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-emerald/10 text-emerald font-black flex items-center justify-center text-base">
                            {pharm.name?.charAt(0) || 'P'}
                          </div>
                          <div>
                            <p className="font-bold text-ink">{pharm.name}</p>
                            <p className="text-xs text-ink/50 font-mono">
                              {pharm.city || 'Pakistan'} • {pharm.slug}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize ${
                          pharm.planTier === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                          pharm.planTier === 'professional' ? 'bg-emerald-100 text-emerald-800' :
                          pharm.planTier === 'starter' ? 'bg-blue-100 text-blue-700' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {pharm.planTier}
                        </span>
                      </td>

                      <td className="py-4 px-4">
                        {pharm.subscriptionStatus === 'active' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Active
                          </span>
                        ) : pharm.subscriptionStatus === 'trial' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                            <Clock className="w-3.5 h-3.5 text-blue-600" /> Free Trial
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-terracotta/10 text-terracotta">
                            <XCircle className="w-3.5 h-3.5" /> Suspended
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-4">
                        <div>
                          <p className={`text-xs font-bold ${isExpired ? 'text-terracotta' : 'text-ink/80'}`}>
                            {pharm.subscriptionEndsAt ? new Date(pharm.subscriptionEndsAt).toLocaleDateString() : 'N/A'}
                          </p>
                          <p className="text-[11px] font-mono text-ink/50">
                            {isExpired ? 'Expired' : `${daysLeft} days remaining`}
                          </p>
                        </div>
                      </td>

                      <td className="py-4 px-4 text-xs font-medium text-ink/80">
                        {pharm.branchCount || 1} / {pharm.maxBranches || 1}
                      </td>

                      <td className="py-4 px-4 text-xs font-medium text-ink/80">
                        {pharm.userCount || 1} / {pharm.maxUsers || 3}
                      </td>

                      <td className="py-4 px-4 font-mono text-xs font-bold text-ink">
                        PKR {pharm.totalSalesVolume?.toLocaleString() || 0}
                      </td>

                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleQuickExtend(pharm, 30)}
                            className="px-2.5 py-1 bg-emerald/10 hover:bg-emerald text-emerald hover:text-white rounded-lg text-xs font-bold transition-colors"
                            title="Extend 30 Days"
                          >
                            +30d
                          </button>
                          
                          <button
                            onClick={() => handleOpenEdit(pharm)}
                            className="p-1.5 bg-clinical hover:bg-ink/10 text-ink/80 rounded-lg transition-colors"
                            title="Edit Plan / Quotas"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {pharm.subscriptionStatus === 'active' || pharm.subscriptionStatus === 'trial' ? (
                            <button
                              onClick={() => handleToggleStatus(pharm, 'suspended')}
                              className="p-1.5 bg-terracotta/10 hover:bg-terracotta text-terracotta hover:text-white rounded-lg transition-colors"
                              title="Suspend Access"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleStatus(pharm, 'active')}
                              className="p-1.5 bg-emerald/10 hover:bg-emerald text-emerald hover:text-white rounded-lg transition-colors"
                              title="Reactivate Access"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Provision Pharmacy Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="relative z-[101] bg-white text-slate-900 rounded-[28px] max-w-xl w-full shadow-2xl border border-slate-200/80 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-5 sm:px-8 text-white flex items-center justify-between border-b border-slate-700/60">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-inner shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
                    Provision New Client Pharmacy
                  </h2>
                  <p className="text-xs text-slate-300 font-medium">
                    Deploy isolated tenant workspace, main branch & owner account
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center font-bold text-sm transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreatePharmacy} className="p-6 sm:p-8 space-y-4 max-h-[calc(85vh-140px)] overflow-y-auto custom-scrollbar text-xs">
              {/* Section 1: Business Identity */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Store className="w-3.5 h-3.5 text-emerald-600" />
                  <span>1. Pharmacy Business Info</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Pharmacy Business Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Al-Shifa Pharmacy"
                      value={formData.pharmacyName}
                      onChange={(e) => setFormData({ ...formData, pharmacyName: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">City / Region *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Karachi, Lahore, Islamabad"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 shadow-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Contact Phone</label>
                    <input
                      type="text"
                      placeholder="0300-1234567"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Owner login email *</label>
                    <input
                      type="email"
                      required
                      placeholder="owner@pharmacy.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Owner Login Account */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Lock className="w-3.5 h-3.5 text-emerald-600" />
                  <span>2. Master Owner Login Account</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Owner Full Name</label>
                    <input
                      type="text"
                      placeholder="Dr. Tariq Khan"
                      value={formData.name}
                      onChange={(e) => {
                        const newName = e.target.value;
                        setFormData(prev => ({
                          ...prev,
                          name: newName,
                          username: generateUsername(newName)
                        }));
                      }}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Login Username *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. dr_tariq_khan"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm font-mono"
                    />
                    <p className="text-[10px] text-slate-500 font-medium mt-1">
                      Auto-generated (3-50 chars, lowercase letters, numbers, underscores). You can edit it.
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 3: Branch & Plan Tier */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Layers className="w-3.5 h-3.5 text-emerald-600" />
                  <span>3. Branch & Plan Allocation</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Initial Main Branch Name</label>
                    <input
                      type="text"
                      value={formData.branchName}
                      onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Initial Subscription Tier</label>
                    <select
                      value={formData.planTier}
                      onChange={(e) => setFormData({ ...formData, planTier: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    >
                      <option value="trial">14-Day Free Trial (1 Branch, 3 Staff)</option>
                      <option value="starter">Starter Plan (1 Branch, 3 Staff)</option>
                      <option value="professional">Professional Plan (5 Branches, 15 Staff)</option>
                      <option value="enterprise">Enterprise Plan (50 Branches, 100 Staff)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
                >
                  {actionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                  <span>Complete Provisioning</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-Time Credential Card Modal */}
      {provisionedCredentials && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="relative z-[111] bg-white text-slate-900 rounded-[28px] max-w-lg w-full shadow-2xl border border-slate-200/80 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-slate-900 px-6 py-5 sm:px-8 text-white flex items-center justify-between border-b border-emerald-800/40">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-inner shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
                    Pharmacy Provisioned
                  </h2>
                  <p className="text-xs text-emerald-200 font-medium">
                    One-time initial owner login credentials
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8 space-y-5 text-xs">
              {/* Warning Banner */}
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3 text-amber-900">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-extrabold text-[11px] uppercase tracking-wider text-amber-800">
                    One-Time Credential Notice
                  </p>
                  <p className="text-xs leading-relaxed font-medium text-amber-900">
                    Copy this password now. It will not be shown again. The owner will be required to set a new password on their first login.
                  </p>
                </div>
              </div>

              {/* Username adjustment notice if collision occurred */}
              {provisionedCredentials.note && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 font-medium flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>{provisionedCredentials.note}</span>
                </div>
              )}

              {/* Credentials Details Card */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
                <div className="flex justify-between items-center py-1.5 border-b border-slate-200/60">
                  <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Pharmacy Business</span>
                  <span className="font-extrabold text-slate-900 text-sm">{provisionedCredentials.pharmacyName}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-200/60">
                  <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Owner Login Email</span>
                  <span className="font-mono font-bold text-slate-900">{provisionedCredentials.email}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-200/60">
                  <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Admin Username</span>
                  <span className="font-mono font-bold text-slate-900">{provisionedCredentials.username}</span>
                </div>
                <div className="pt-2">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Temporary Password</span>
                    <button
                      type="button"
                      onClick={() => {
                        const text = `PharmaCore Credentials\nPharmacy: ${provisionedCredentials.pharmacyName}\nEmail: ${provisionedCredentials.email}\nUsername: ${provisionedCredentials.username}\nTemporary Password: ${provisionedCredentials.temporaryPassword}`;
                        navigator.clipboard.writeText(text);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 3000);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied!' : 'Copy Credentials'}</span>
                    </button>
                  </div>
                  <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-sm font-black rounded-xl tracking-wider select-all border border-slate-800 text-center">
                    {provisionedCredentials.temporaryPassword}
                  </div>
                </div>
              </div>

              {/* Done button */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setProvisionedCredentials(null);
                    setCopied(false);
                  }}
                  className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Done & Close</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern Edit Subscription Modal */}
      {showEditModal && selectedPharmacy && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="relative z-[101] bg-white text-slate-900 rounded-[28px] max-w-lg w-full shadow-2xl border border-slate-200/80 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-5 sm:px-8 text-white flex items-center justify-between border-b border-slate-700/60">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-inner shrink-0">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black tracking-tight text-white">
                    Manage Tenant Subscription
                  </h2>
                  <p className="text-xs text-slate-300 font-medium">
                    {selectedPharmacy.name} <span className="text-emerald-400 font-mono">({selectedPharmacy.slug})</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center font-bold text-sm transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateSubscription} className="p-6 sm:p-8 space-y-4 text-xs">
              {/* Section 1: Tier & Status */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Tag className="w-3.5 h-3.5 text-emerald-600" />
                  <span>1. Plan Tier & Subscription Status</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Plan Tier</label>
                    <select
                      value={editData.planTier}
                      onChange={(e) => setEditData({ ...editData, planTier: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    >
                      <option value="trial">Free Trial</option>
                      <option value="starter">Starter Tier</option>
                      <option value="professional">Professional Tier</option>
                      <option value="enterprise">Enterprise Tier</option>
                      <option value="ultimate_chain">Ultimate Chain ERP</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Subscription Status</label>
                    <select
                      value={editData.subscriptionStatus}
                      onChange={(e) => setEditData({ ...editData, subscriptionStatus: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                    >
                      <option value="active">Active (Full Access)</option>
                      <option value="trial">Free Trial</option>
                      <option value="suspended">Suspended (Locked)</option>
                      <option value="past_due">Past Due (Renewal Pending)</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2: Capacity Quotas */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>2. Branch & User Capacity Limits</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Max Branches Quota</label>
                    <input
                      type="number"
                      min="1"
                      value={editData.maxBranches}
                      onChange={(e) => setEditData({ ...editData, maxBranches: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 font-bold outline-none focus:border-emerald-600 shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Max Users Quota</label>
                    <input
                      type="number"
                      min="1"
                      value={editData.maxUsers}
                      onChange={(e) => setEditData({ ...editData, maxUsers: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 font-bold outline-none focus:border-emerald-600 shadow-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Validity Extension */}
              <div className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-[11px] uppercase tracking-wider">
                  <Clock className="w-3.5 h-3.5 text-emerald-600" />
                  <span>3. Subscription Validity Extension</span>
                </div>

                <div>
                  <select
                    value={editData.extensionDays}
                    onChange={(e) => setEditData({ ...editData, extensionDays: parseInt(e.target.value, 10) })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 outline-none focus:border-emerald-600 shadow-sm"
                  >
                    <option value={0}>Do not change expiry date</option>
                    <option value={14}>+14 Days (Trial Extension)</option>
                    <option value={30}>+30 Days (1 Month)</option>
                    <option value={90}>+90 Days (Quarterly)</option>
                    <option value={180}>+180 Days (Half Year)</option>
                    <option value={365}>+365 Days (1 Year)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
                >
                  {actionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
