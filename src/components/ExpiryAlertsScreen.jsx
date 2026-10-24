import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Clock, Trash2, RefreshCw, Package, Activity, Layers, ArrowUpDown } from 'lucide-react';
import DataTable from './DataTable.jsx';
import { LOW_STOCK_THRESHOLD } from '../utils/constants.js';

export default function ExpiryAlertsScreen({ user }) {
  const [activeTab, setActiveTab]           = useState('expiry'); // 'expiry' or 'stock'
  const [expiredBatches, setExpiredBatches] = useState([]);   // isExpired === true
  const [activeBatches, setActiveBatches]   = useState([]);   // from getMedicines (non-expired)
  const [lowStockMeds, setLowStockMeds]     = useState([]);   // Medicines below threshold
  const [loading, setLoading]               = useState(true);
  const [threshold, setThreshold]           = useState(30);
  const [showAll, setShowAll]               = useState(false);
  const [error, setError]                   = useState('');
  const [discarding, setDiscarding]         = useState(null);

  const isAdmin = user.role === 'admin';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [medsData, expiredData, thresholdData] = await Promise.all([
        window.pharmacoreAPI.getMedicines(),
        window.pharmacoreAPI.getExpiredBatches(),
        window.pharmacoreAPI.getExpiryThreshold(),
      ]);

      const flat = medsData.flatMap(m =>
        (m.batches || []).map(b => ({ ...b, medicineName: m.name, barcode: m.barcode }))
      );
      
      const lowMeds = medsData.map(m => {
        const totalStock = (m.batches || []).filter(b => !b.isExpired).reduce((s, b) => s + b.quantityInStock, 0);
        return { ...m, totalStock };
      }).filter(m => m.totalStock <= LOW_STOCK_THRESHOLD).sort((a, b) => a.totalStock - b.totalStock);

      setActiveBatches(flat);
      setExpiredBatches(expiredData);
      setThreshold(thresholdData);
      setLowStockMeds(lowMeds);
    } catch (err) {
      console.error(err);
      setError('Failed to load inventory data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleThresholdChange = async (newVal) => {
    if (!isAdmin) return;
    const val = Math.max(1, Math.min(365, parseInt(newVal) || 30));
    try {
      await window.pharmacoreAPI.setExpiryThreshold(val);
      setThreshold(val);
    } catch (err) {
      console.error('Failed to update threshold:', err);
    }
  };

  const handleDiscard = async (batchId) => {
    if (!isAdmin) return;
    if (!window.confirm('Permanently discard this expired batch? This cannot be undone.')) return;
    setDiscarding(batchId);
    try {
      await window.pharmacoreAPI.deleteBatch(batchId);
      setExpiredBatches(prev => prev.filter(b => b.id !== batchId));
    } catch (err) {
      alert(err.message || 'Failed to discard batch.');
    } finally {
      setDiscarding(null);
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const categorized = activeBatches.map(b => {
    const exp = new Date(b.expiryDate);
    exp.setHours(0, 0, 0, 0);
    const days = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
    const status = days <= 0 ? 'expired' : days <= threshold ? 'near-expiry' : 'healthy';
    const potentialLoss = isAdmin && b.costPerUnit && b.quantityInStock
      ? b.costPerUnit * b.quantityInStock : null;
    return { ...b, daysUntilExpiry: days, status, potentialLoss };
  }).sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

  const nearExpiry = categorized.filter(b => b.status === 'near-expiry');
  const healthy    = categorized.filter(b => b.status === 'healthy');

  const expiredLoss = isAdmin
    ? expiredBatches.reduce((sum, b) => sum + ((b.costPerUnit || 0) * (b.quantityInStock || 0)), 0)
    : 0;

  const formatDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
  const formatRs   = (v) => v != null ? `Rs ${Number(v).toFixed(2)}` : '—';

  // Columns for Expired Batches
  const expiredColumns = [
    {
      header: 'Medicine Name',
      accessor: 'medicineName',
      sortable: true,
      cell: (b) => <span className="font-extrabold text-slate-900 text-sm">{b.medicineName}</span>
    },
    {
      header: 'Batch #',
      accessor: 'batchNumber',
      sortable: true,
      cell: (b) => <span className="font-mono text-slate-600 font-bold text-xs">{b.batchNumber || '—'}</span>
    },
    {
      header: 'Expired Date',
      accessor: 'expiryDate',
      sortable: true,
      cell: (b) => <span className="font-mono text-rose-600 font-bold text-xs">{formatDate(b.expiryDate)}</span>
    },
    {
      header: 'Units to Discard',
      accessor: 'quantityInStock',
      sortable: true,
      align: 'right',
      cell: (b) => <span className="font-mono font-black text-slate-900 text-xs">{b.quantityInStock}</span>
    },
    ...(isAdmin ? [
      {
        header: 'Potential Loss',
        accessor: (b) => (b.costPerUnit || 0) * (b.quantityInStock || 0),
        sortable: true,
        align: 'right',
        cell: (b) => (
          <span className="font-mono font-black text-rose-600 text-xs">
            {formatRs((b.costPerUnit || 0) * (b.quantityInStock || 0))}
          </span>
        )
      },
      {
        header: 'Action',
        align: 'right',
        cell: (b) => (
          <button
            onClick={() => handleDiscard(b.id)}
            disabled={discarding === b.id}
            title="Permanently discard this batch"
            className="inline-flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-extrabold px-2.5 py-1 rounded-lg text-xs transition-colors shadow-sm disabled:opacity-50"
          >
            <Trash2 size={12} />
            {discarding === b.id ? 'Discarding…' : 'Discard'}
          </button>
        )
      }
    ] : [])
  ];

  // Columns for Active / Near Expiry Batches
  const activeExpiryColumns = [
    {
      header: 'Status',
      accessor: 'daysUntilExpiry',
      sortable: true,
      cell: (b) => {
        if (b.status === 'expired') {
          return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-700 border border-rose-200">Expired</span>;
        }
        if (b.status === 'near-expiry') {
          return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">Expires in {b.daysUntilExpiry}d</span>;
        }
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">{b.daysUntilExpiry}d left</span>;
      }
    },
    {
      header: 'Medicine Name',
      accessor: 'medicineName',
      sortable: true,
      cell: (b) => <span className="font-extrabold text-slate-900 text-sm">{b.medicineName}</span>
    },
    {
      header: 'Batch #',
      accessor: 'batchNumber',
      sortable: true,
      cell: (b) => <span className="font-mono text-slate-600 font-bold text-xs">{b.batchNumber || '—'}</span>
    },
    {
      header: 'Expiry Date',
      accessor: 'expiryDate',
      sortable: true,
      cell: (b) => <span className="font-mono text-slate-700 text-xs font-semibold">{formatDate(b.expiryDate)}</span>
    },
    {
      header: 'Quantity In Stock',
      accessor: 'quantityInStock',
      sortable: true,
      align: 'right',
      cell: (b) => <span className="font-mono font-black text-slate-900 text-xs">{b.quantityInStock}</span>
    },
    ...(isAdmin ? [{
      header: 'Stock Value at Risk',
      accessor: 'potentialLoss',
      sortable: true,
      align: 'right',
      cell: (b) => <span className="font-mono font-bold text-slate-700 text-xs">{formatRs(b.potentialLoss)}</span>
    }] : [])
  ];

  // Columns for Low Stock Medicines
  const lowStockColumns = [
    {
      header: 'Medicine Name',
      accessor: 'name',
      sortable: true,
      cell: (m) => (
        <div>
          <span className="font-extrabold text-slate-900 text-sm">{m.name}</span>
          <p className="font-mono text-[10px] text-slate-400">Barcode: {m.barcode || '—'}</p>
        </div>
      )
    },
    {
      header: 'Category',
      accessor: (m) => m.categories?.name || '—',
      sortable: true,
      cell: (m) => <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-bold">{m.categories?.name || '—'}</span>
    },
    {
      header: 'Total Remaining Stock',
      accessor: 'totalStock',
      sortable: true,
      align: 'right',
      cell: (m) => (
        <span className={`font-mono font-black text-sm ${m.totalStock === 0 ? 'text-rose-600' : 'text-amber-600'}`}>
          {m.totalStock} {m.unitName || 'Tablet'}s
        </span>
      )
    },
    {
      header: 'Status',
      align: 'center',
      cell: (m) => (
        m.totalStock === 0 ? (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-200">
            Out of Stock
          </span>
        ) : (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-200">
            Low Stock (≤ {LOW_STOCK_THRESHOLD})
          </span>
        )
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Expiry & Low Stock Alerts</h3>
          <p className="text-xs font-semibold text-slate-500">
            Automated FEFO tracking, near-expiry alerts, loss estimation, and stock replenishment triggers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <div className="bg-white border-2 border-slate-200 rounded-xl px-3.5 py-2 flex items-center gap-2 shadow-sm">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Alert Window:
              </label>
              <input
                type="number"
                min="1" max="365"
                value={threshold}
                onChange={(e) => handleThresholdChange(e.target.value)}
                className="w-16 bg-slate-50 border border-slate-300 focus:border-emerald-600 rounded-lg px-2 py-1 text-xs font-bold text-center outline-none"
              />
              <span className="text-xs font-bold text-slate-500">days</span>
            </div>
          )}
          <button
            onClick={fetchData}
            title="Refresh"
            className="bg-white border border-slate-300 hover:bg-slate-100 p-2.5 rounded-xl text-slate-700 shadow-sm transition-all"
          >
            <RefreshCw size={16} className={`text-emerald-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('expiry')}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all ${
            activeTab === 'expiry' 
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/20' 
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Expiry Alerts ({expiredBatches.length + nearExpiry.length})
        </button>
        <button
          onClick={() => setActiveTab('stock')}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
            activeTab === 'stock' 
              ? 'bg-amber-600 text-white shadow-md shadow-amber-950/20' 
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Low Stock Alerts
          {lowStockMeds.length > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${activeTab === 'stock' ? 'bg-amber-800 text-white' : 'bg-amber-100 text-amber-800'}`}>
              {lowStockMeds.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Expiry Alerts Tab ── */}
      {activeTab === 'expiry' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border-2 border-rose-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-rose-600">Expired Batches</p>
                <h4 className="text-3xl font-black text-rose-600 font-mono mt-1">{expiredBatches.length}</h4>
                {isAdmin && expiredBatches.length > 0 && (
                  <p className="text-xs text-rose-700 font-bold mt-1">Loss: {formatRs(expiredLoss)}</p>
                )}
              </div>
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
              </div>
            </div>

            <div className="bg-white border-2 border-amber-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-amber-600">Near Expiry</p>
                <h4 className="text-3xl font-black text-amber-700 font-mono mt-1">{nearExpiry.length}</h4>
                <p className="text-xs text-slate-500 font-semibold mt-1">Within {threshold} days</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center">
                <Clock className="w-6 h-6 stroke-[2.5]" />
              </div>
            </div>

            <div className="bg-white border-2 border-emerald-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Healthy Stock</p>
                <h4 className="text-3xl font-black text-emerald-700 font-mono mt-1">{healthy.length}</h4>
                <p className="text-xs text-slate-500 font-semibold mt-1">&gt; {threshold} days validity</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 stroke-[2.5]" />
              </div>
            </div>
          </div>

          {/* Section 1: Expired Batches DataTable */}
          <div className="space-y-2">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
              Expired Batches (Auto-removed from Dispensing)
            </h4>
            <DataTable
              columns={expiredColumns}
              data={expiredBatches}
              searchKeys={['medicineName', 'batchNumber']}
              searchPlaceholder="Search expired medicines or batch numbers..."
              exportFileName="expired-batches"
              loading={loading}
              emptyMessage="No expired batches found — excellent inventory turnover!"
            />
          </div>

          {/* Section 2: Active Inventory Expiry Status DataTable */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                Active Inventory — Expiry Watchlist
              </h4>
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all border ${
                  showAll ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {showAll ? 'Showing All Batches' : 'Filter: Near Expiry Only'}
              </button>
            </div>
            <DataTable
              columns={activeExpiryColumns}
              data={categorized.filter(b => showAll || b.status === 'near-expiry')}
              searchKeys={['medicineName', 'batchNumber']}
              searchPlaceholder="Search active batches..."
              exportFileName="active-expiry-watchlist"
              loading={loading}
              emptyMessage="No active batches expiring within this threshold."
            />
          </div>

        </div>
      )}

      {/* ── Low Stock Alerts Tab ── */}
      {activeTab === 'stock' && (
        <div className="space-y-3 animate-in fade-in duration-300">
          <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            Medicines Below Stock Replenishment Threshold ({LOW_STOCK_THRESHOLD} units)
          </h4>
          <DataTable
            columns={lowStockColumns}
            data={lowStockMeds}
            searchKeys={['name', 'barcode', (m) => m.categories?.name]}
            searchPlaceholder="Search low stock medicines..."
            exportFileName="low-stock-medicines"
            loading={loading}
            emptyMessage="All medicines have adequate stock levels!"
          />
        </div>
      )}

    </div>
  );
}
