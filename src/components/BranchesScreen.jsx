import React, { useState, useEffect } from 'react';
import { Building, Plus, AlertCircle, Sparkles, CheckCircle2, Layers } from 'lucide-react';
import DataTable from './DataTable.jsx';

export default function BranchesScreen({ user }) {
  const [branches, setBranches] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [newBranchPhone, setNewBranchPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBranchesAndSub = async () => {
    setLoading(true);
    try {
      const [branchData, subData] = await Promise.all([
        window.pharmacoreAPI.getBranches(),
        window.pharmacoreAPI.getCurrentSubscription().catch(() => null)
      ]);
      setBranches(branchData || []);
      setSubscription(subData);
    } catch (err) {
      console.error(err);
      setError('Failed to load branches.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.canViewAllBranches || user?.role === 'superadmin') {
      fetchBranchesAndSub();
    }
  }, [user]);

  const maxBranches = subscription?.maxBranches || 1;
  const isQuotaReached = branches.length >= maxBranches && user?.role !== 'superadmin';

  const handleAddBranch = async (e) => {
    e.preventDefault();
    setError('');
    
    const name = newBranchName.trim();
    if (!name) {
      setError('Branch name is required.');
      return;
    }

    if (isQuotaReached) {
      setError(`Branch limit reached (${branches.length}/${maxBranches}). Please upgrade your SaaS plan to add more branches.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await window.pharmacoreAPI.addBranch({ 
        name,
        address: newBranchAddress.trim() || null,
        phone: newBranchPhone.trim() || null
      });
      setNewBranchName('');
      setNewBranchAddress('');
      setNewBranchPhone('');
      setShowAddForm(false);
      fetchBranchesAndSub();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to add branch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user?.canViewAllBranches && user?.role !== 'superadmin') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-ink/60">
        <AlertCircle className="w-12 h-12 mb-4 text-amber" />
        <h2 className="text-xl font-bold text-ink/90">Access Denied</h2>
        <p className="mt-2 text-sm text-center max-w-md">
          You do not have permission to view or manage branches. Only pharmacy administrators can access this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Quota Pill */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-black text-ink tracking-tight">Branch Management</h1>
            {subscription && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${
                isQuotaReached ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {branches.length} / {maxBranches} Quota Used
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-ink/60">
            Manage physical pharmacy counter locations for {user?.pharmacyName || 'your pharmacy'}
          </p>
        </div>

        {!showAddForm && (
          <button
            onClick={() => {
              if (isQuotaReached) {
                setError(`Branch limit reached (${branches.length}/${maxBranches}). Upgrade your plan to add more branches.`);
              } else {
                setShowAddForm(true);
                setError('');
              }
            }}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-sm ${
              isQuotaReached 
                ? 'bg-amber-500 hover:bg-amber-600 text-white' 
                : 'bg-emerald hover:bg-emerald/90 text-white'
            }`}
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{isQuotaReached ? 'Upgrade Plan for More Branches' : 'Add New Branch'}</span>
          </button>
        )}
      </div>

      {error && (
        <div className="bg-terracotta/10 text-terracotta px-4 py-3 rounded-xl text-xs font-semibold border border-terracotta/20 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="font-bold">×</button>
        </div>
      )}

      {showAddForm && (
        <div className="bg-white rounded-2xl border border-ink/10 p-6 shadow-sm">
          <h2 className="text-base font-bold text-ink mb-4">Create New Pharmacy Branch</h2>
          <form onSubmit={handleAddBranch} className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  Branch Name *
                </label>
                <input
                  type="text"
                  required
                  className="w-full bg-clinical border border-ink/10 rounded-xl px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-emerald"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="e.g. Clifton Branch"
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  Location Address
                </label>
                <input
                  type="text"
                  className="w-full bg-clinical border border-ink/10 rounded-xl px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-emerald"
                  value={newBranchAddress}
                  onChange={(e) => setNewBranchAddress(e.target.value)}
                  placeholder="e.g. Block 2, Clifton"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  Branch Phone
                </label>
                <input
                  type="text"
                  className="w-full bg-clinical border border-ink/10 rounded-xl px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-emerald"
                  value={newBranchPhone}
                  onChange={(e) => setNewBranchPhone(e.target.value)}
                  placeholder="021-35876543"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setError(''); setNewBranchName(''); }}
                className="px-4 py-2 bg-clinical hover:bg-ink/10 text-ink/80 rounded-xl text-xs font-bold transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-emerald text-white rounded-xl text-xs font-bold hover:bg-emerald/90 transition-colors shadow-sm disabled:opacity-70 flex items-center gap-2"
              >
                {isSubmitting ? 'Creating Branch...' : 'Save Branch Location'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Branch Table with DataTable */}
      <DataTable
        columns={[
          {
            header: 'Branch Location',
            accessor: 'name',
            sortable: true,
            cell: (b) => (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                  <Building className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-extrabold text-slate-900 text-sm block">{b.name}</span>
                  {b.address && <span className="text-[11px] text-slate-500">{b.address}</span>}
                </div>
              </div>
            )
          },
          {
            header: 'Contact Phone',
            accessor: 'phone',
            cell: (b) => (
              <span className="text-xs font-medium text-slate-600">
                {b.phone || '—'}
              </span>
            )
          },
          {
            header: 'Branch System ID',
            accessor: 'id',
            sortable: true,
            cell: (b) => (
              <span className="font-mono text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {b.id?.slice(0, 13)}...
              </span>
            )
          },
          {
            header: 'Created On',
            accessor: 'createdAt',
            sortable: true,
            cell: (b) => (
              <span className="text-xs font-semibold text-slate-600">
                {b.createdAt ? new Date(b.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </span>
            )
          }
        ]}
        data={branches}
        searchKeys={['name', 'address', 'id']}
        searchPlaceholder="Search branch locations..."
        exportFileName="pharmacy-branches"
        loading={loading}
        emptyMessage="No branch locations found."
      />
    </div>
  );
}
