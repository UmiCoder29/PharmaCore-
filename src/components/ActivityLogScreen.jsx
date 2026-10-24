import React, { useState, useEffect } from 'react';
import { Activity, ShieldAlert, CheckCircle2, XCircle, Laptop, Calendar, User, RefreshCw } from 'lucide-react';
import DataTable from './DataTable.jsx';

export default function ActivityLogScreen({ user }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Date Presets & Filters
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchActivity = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await window.pharmacoreAPI.getLoginActivity();
      setActivity(data || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load activity log.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivity();
  }, []);

  const filteredActivity = activity.filter(entry => {
    if (statusFilter === 'success' && entry.action === 'login_failed') return false;
    if (statusFilter === 'failed' && entry.action !== 'login_failed') return false;
    return true;
  });

  const formatDateTime = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  };

  const columns = [
    {
      header: 'Date & Time',
      accessor: 'createdAt',
      sortable: true,
      cell: (entry) => <span className="font-bold text-slate-800 text-xs">{formatDateTime(entry.createdAt)}</span>
    },
    {
      header: 'User Account',
      accessor: (entry) => entry.name || entry.username,
      sortable: true,
      cell: (entry) => (
        <div>
          <span className="font-extrabold text-slate-900 text-xs">{entry.name || entry.username}</span>
          <p className="font-mono text-[10px] text-slate-400">ID: {entry.username}</p>
        </div>
      )
    },
    {
      header: 'Role',
      accessor: (entry) => entry.appUsers?.role || '—',
      sortable: true,
      cell: (entry) => (
        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-bold capitalize">
          {entry.appUsers?.role || '—'}
        </span>
      )
    },
    {
      header: 'Device / Hostname',
      accessor: 'deviceName',
      sortable: true,
      cell: (entry) => (
        <div className="flex items-center gap-1.5 text-slate-700 text-xs font-semibold">
          <Laptop className="w-3.5 h-3.5 text-slate-400" />
          <span>{entry.deviceName || 'Local POS Terminal'}</span>
        </div>
      )
    },
    {
      header: 'Security Event',
      accessor: 'action',
      sortable: true,
      cell: (entry) => {
        const isFailure = entry.action === 'login_failed';
        return isFailure ? (
          <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-800 border border-rose-200 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
            <XCircle className="w-3 h-3 text-rose-600" /> Login Failed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Success ({(entry.action || 'login').replace(/_/g, ' ')})
          </span>
        );
      }
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">System Security & Activity Log</h3>
          <p className="text-xs font-semibold text-slate-500">
            Real-time audit trails of authentication events, terminal logins, and security alerts.
          </p>
        </div>
        <button
          onClick={fetchActivity}
          disabled={loading}
          className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold px-3.5 py-2 rounded-xl text-xs shadow-sm transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Log</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold">
          {error}
        </div>
      )}

      {/* ── DataTable with Search & Status Filters ── */}
      <DataTable
        columns={columns}
        data={filteredActivity}
        searchKeys={['name', 'username', 'deviceName', 'action', (entry) => entry.appUsers?.role]}
        searchPlaceholder="Search audit events by user, employee ID, terminal..."
        exportFileName="security-activity-log"
        loading={loading}
        emptyMessage="No activity events recorded."
        filters={(
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
            >
              <option value="all">All Security Events</option>
              <option value="success">Successful Logins</option>
              <option value="failed">Failed Login Attempts</option>
            </select>
          </div>
        )}
      />
    </div>
  );
}
