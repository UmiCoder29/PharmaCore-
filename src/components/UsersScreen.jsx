import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Edit2, KeyRound, User, Shield, Building, Plus, RefreshCw, Sparkles, Users } from 'lucide-react';
import DataTable from './DataTable.jsx';

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    const epoch = new Date(0).getTime();
    if (d.getTime() === epoch) return 'Unknown';
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function UsersScreen({ user }) {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('pharmacist');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');

  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editNewUsername, setEditNewUsername] = useState('');
  const [editNewName, setEditNewName] = useState('');
  const [editBranchId, setEditBranchId] = useState('');
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editSuccess, setEditSuccess] = useState('');

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetShowNew, setResetShowNew] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState('');

  const fetchUsersAndBranches = async () => {
    setLoading(true);
    try {
      const [userData, branchData, subData] = await Promise.all([
        window.pharmacoreAPI.getUsers(),
        window.pharmacoreAPI.getBranches(),
        window.pharmacoreAPI.getCurrentSubscription().catch(() => null)
      ]);
      setUsers(userData || []);
      setBranches(branchData || []);
      setSubscription(subData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndBranches();
  }, []);

  useEffect(() => {
    if (user && !user.canViewAllBranches && user.branchId) {
      setSelectedBranchId(user.branchId);
    }
  }, [user]);

  const maxUsers = subscription?.maxUsers || 3;
  const isQuotaReached = users.length >= maxUsers && user?.role !== 'superadmin';

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (isQuotaReached) {
      setError(`Staff quota reached (${users.length}/${maxUsers}). Please upgrade your SaaS plan to add more staff accounts.`);
      return;
    }

    const cleanUsername = username.trim();
    const cleanName = name.trim();

    if (!cleanUsername) {
      setError('Employee ID is required.');
      return;
    }
    
    if (cleanUsername.length < 3) {
      setError('Employee ID must be at least 3 characters long.');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      setError('Employee ID can only contain letters, numbers, and underscores.');
      return;
    }

    if (!cleanName) {
      setError('Name is required.');
      return;
    }

    if (cleanName.length < 2) {
      setError('Name must be at least 2 characters long.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (!selectedBranchId && role !== 'owner' && role !== 'superadmin') {
      if (user?.canViewAllBranches) {
         setError('Please select a branch to assign this user to.');
      } else {
         setError('Branch assignment is required.');
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await window.pharmacoreAPI.createUser(
        username.trim(), name.trim(), password, role, selectedBranchId || null
      );
      if (result.success) {
        setSuccess(`User ${name || username} created successfully.`);
        setUsername('');
        setName('');
        setPassword('');
        setRole('pharmacist');
        if (user?.canViewAllBranches) {
          setSelectedBranchId('');
        }
        fetchUsersAndBranches();
      } else {
        setError(result.error || 'Failed to create user.');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (targetUser) => {
    setEditTarget(targetUser);
    setEditNewUsername(targetUser.username);
    setEditNewName(targetUser.name || targetUser.username);
    setEditBranchId(targetUser.branchId || '');
    setEditError('');
    setEditSuccess('');
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditTarget(null);
    setEditNewUsername('');
    setEditNewName('');
    setEditError('');
    setEditSuccess('');
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError('');
    setEditSuccess('');
    if (!editTarget) return;

    const trimmed = editNewUsername.trim();
    const trimmedName = editNewName.trim();
    if (trimmed.length < 3) {
      setEditError('Employee ID must be at least 3 characters.');
      return;
    }

    setEditSubmitting(true);
    try {
      const usernameResult = await window.pharmacoreAPI.updateUsername(editTarget.id, trimmed, trimmedName);
      
      let branchResult = { success: true };
      if (user?.canViewAllBranches && editBranchId && editBranchId !== (editTarget.branchId || '')) {
        branchResult = await window.pharmacoreAPI.updateUserBranch(editTarget.id, editBranchId);
      }

      if (usernameResult.success && branchResult.success) {
        setEditSuccess(`User profile updated successfully.`);
        await fetchUsersAndBranches();
        setTimeout(() => {
          closeEditModal();
        }, 1000);
      } else {
        setEditError(usernameResult.error || branchResult.error || 'Failed to update user profile.');
      }
    } catch (err) {
      setEditError('An unexpected error occurred.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const openResetModal = (targetUser) => {
    setResetTarget(targetUser);
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetShowNew(false);
    setResetError('');
    setResetSuccess('');
    setShowResetModal(true);
  };

  const closeResetModal = () => {
    setShowResetModal(false);
    setResetTarget(null);
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetShowNew(false);
    setResetError('');
    setResetSuccess('');
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetSuccess('');
    if (!resetTarget) return;

    if (resetNewPassword.length < 8) {
      setResetError('Password must be at least 8 characters.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    setResetSubmitting(true);
    try {
      const result = await window.pharmacoreAPI.resetUserPassword(resetTarget.id, resetNewPassword);
      if (result.success) {
        setResetSuccess('Password reset successfully. Share the new password with the user.');
        setTimeout(() => {
          closeResetModal();
        }, 1800);
      } else {
        setResetError(result.error || 'Failed to reset password.');
      }
    } catch (err) {
      setResetError('An unexpected error occurred.');
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-2xl font-bold text-ink">Staff & Users Management</h3>
            {subscription && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${
                isQuotaReached ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {users.length} / {maxUsers} Staff Accounts
              </span>
            )}
          </div>
          <p className="text-sm text-ink/60 font-medium">Create and manage access for pharmacists and cashiers.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Add Account Card */}
        <div className="bg-white border border-ink/20 rounded-2xl p-6 shadow-sm h-fit">
          <div className="relative mb-4">
            <h4 className="text-base font-bold text-ink">Add New Staff Account</h4>
            <div className="absolute bottom-0 left-0 w-12 h-0.5 bg-emerald"></div>
          </div>

          {isQuotaReached && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-semibold">
              ⚠️ You have reached the maximum staff limit ({users.length}/{maxUsers}) on your current plan. Upgrade to add more team members.
            </div>
          )}

          <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-ink/80 uppercase tracking-wider mb-1.5">Employee Login ID *</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={isSubmitting}
                required
                minLength={3}
                pattern="^\S+$"
                className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded-xl px-3.5 py-2.5 text-ink outline-none transition-all"
                placeholder="e.g. pharmacist_ali"
              />
            </div>

            <div>
              <label className="block font-bold text-ink/80 uppercase tracking-wider mb-1.5">Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={isSubmitting}
                required
                minLength={2}
                className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded-xl px-3.5 py-2.5 text-ink outline-none transition-all"
                placeholder="e.g. Ali Raza"
              />
            </div>

            <div>
              <label className="block font-bold text-ink/80 uppercase tracking-wider mb-1.5">Initial Password (min 8 chars) *</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isSubmitting}
                required
                minLength={8}
                className="w-full bg-clinical border border-ink/20 focus:border-emerald focus:ring-1 focus:ring-emerald/20 rounded-xl px-3.5 py-2.5 text-ink outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block font-bold text-ink/80 uppercase tracking-wider mb-1.5">Role</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-clinical border border-ink/20 focus:border-emerald rounded-xl px-3.5 py-2.5 text-ink outline-none font-semibold cursor-pointer"
              >
                <option value="pharmacist">Pharmacist / Cashier</option>
                <option value="admin">Branch Administrator</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-ink/80 uppercase tracking-wider mb-1.5">Assigned Branch</label>
              <select
                value={selectedBranchId}
                onChange={e => setSelectedBranchId(e.target.value)}
                disabled={isSubmitting || (!user?.canViewAllBranches && user?.role !== 'superadmin')}
                required
                className="w-full bg-clinical border border-ink/20 focus:border-emerald rounded-xl px-3.5 py-2.5 text-ink outline-none font-semibold cursor-pointer"
              >
                <option value="" disabled>Select branch</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="bg-terracotta/10 border border-terracotta/20 rounded-xl px-3 py-2 text-terracotta text-xs font-semibold">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-emerald/10 border border-emerald/20 rounded-xl px-3 py-2 text-emerald text-xs font-semibold">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-emerald hover:bg-emerald/90 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all text-xs tracking-wide shadow-md"
            >
              {isSubmitting ? 'Creating User...' : 'Save Staff Account'}
            </button>
          </form>
        </div>

        {/* User Table */}
        <div className="lg:col-span-2">
          <DataTable
            columns={[
              {
                header: 'User Account',
                accessor: 'name',
                sortable: true,
                cell: (u) => (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-black uppercase text-xs shadow-sm">
                      {(u.name || u.username)[0]}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-extrabold text-slate-900 text-sm">{u.name || u.username}</span>
                      <span className="font-mono text-[10px] font-bold text-slate-400">ID: {u.username}</span>
                    </div>
                  </div>
                )
              },
              {
                header: 'Role',
                accessor: 'role',
                sortable: true,
                cell: (u) => (
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    u.role === 'admin'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : u.role === 'superadmin'
                      ? 'bg-purple-100 text-purple-800 border border-purple-200'
                      : 'bg-slate-100 text-slate-700 border border-slate-200'
                  }`}>
                    {u.role}
                  </span>
                )
              },
              {
                header: 'Branch',
                accessor: (u) => branches.find(b => b.id === u.branchId)?.name || 'All Branches',
                sortable: true,
                cell: (u) => (
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-bold">
                    {branches.find(b => b.id === u.branchId)?.name || (u.canViewAllBranches ? 'All Branches' : '—')}
                  </span>
                )
              },
              {
                header: 'Created On',
                accessor: 'createdAt',
                sortable: true,
                cell: (u) => <span className="text-xs font-semibold text-slate-600">{formatDateTime(u.createdAt)}</span>
              },
              {
                header: 'Actions',
                align: 'right',
                cell: (u) => (
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditModal(u)}
                      className="flex items-center gap-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-sm"
                    >
                      <Edit2 className="w-3 h-3 text-slate-500" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => openResetModal(u)}
                      className="flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                    >
                      <KeyRound className="w-3 h-3 text-amber-600" /> Reset
                    </button>
                  </div>
                )
              }
            ]}
            data={users}
            searchKeys={['name', 'username', 'role']}
            searchPlaceholder="Search users by name, login ID, role..."
            exportFileName="pharmacy-staff-users"
            loading={loading}
            emptyMessage="No staff users found."
          />
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && editTarget && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Edit User Account</h3>
              <button onClick={closeEditModal} className="text-slate-400 hover:text-slate-600 font-bold">×</button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Employee ID</label>
                <input
                  type="text"
                  value={editNewUsername}
                  onChange={e => setEditNewUsername(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  value={editNewName}
                  onChange={e => setEditNewName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                />
              </div>

              {user?.canViewAllBranches && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Reassign Branch</label>
                  <select
                    value={editBranchId}
                    onChange={e => setEditBranchId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                  >
                    <option value="">Keep current branch</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {editError && <div className="text-terracotta font-semibold">{editError}</div>}
              {editSuccess && <div className="text-emerald font-semibold">{editSuccess}</div>}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button type="button" onClick={closeEditModal} className="px-4 py-2 bg-slate-100 rounded-xl font-bold">Cancel</button>
                <button type="submit" disabled={editSubmitting} className="px-4 py-2 bg-emerald text-white rounded-xl font-bold">
                  {editSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Reset Password Modal */}
      {showResetModal && resetTarget && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Reset Password for {resetTarget.name || resetTarget.username}</h3>
              <button onClick={closeResetModal} className="text-slate-400 hover:text-slate-600 font-bold">×</button>
            </div>

            <form onSubmit={handleResetSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">New Password (min 8 chars)</label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={e => setResetNewPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={resetConfirmPassword}
                  onChange={e => setResetConfirmPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                  placeholder="••••••••"
                />
              </div>

              {resetError && <div className="text-terracotta font-semibold">{resetError}</div>}
              {resetSuccess && <div className="text-emerald font-semibold">{resetSuccess}</div>}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button type="button" onClick={closeResetModal} className="px-4 py-2 bg-slate-100 rounded-xl font-bold">Cancel</button>
                <button type="submit" disabled={resetSubmitting} className="px-4 py-2 bg-ink text-white rounded-xl font-bold">
                  {resetSubmitting ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
