import React, { useState, useEffect } from 'react';
import { ChevronLeft, TrendingUp, DollarSign, Calendar, AlertTriangle, Package, Edit2, Trash2, ArrowRight, RefreshCw, Phone, Mail } from 'lucide-react';
import DataTable from './DataTable.jsx';
import { isValidEmail, isValidPhone } from '../utils/validation.js';

export default function SuppliersScreen({ user }) {
  const [dashboardStats, setDashboardStats] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Master/Detail State
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [supplierDetails, setSupplierDetails] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Form state
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = user.role === 'admin';

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const data = await window.pharmacoreAPI.invoke('api:get-supplier-dashboard');
      setDashboardStats(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetails = async (supplierId) => {
    setDetailsLoading(true);
    try {
      const data = await window.pharmacoreAPI.invoke('api:get-supplier-details', supplierId);
      setSupplierDetails(data);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    if (selectedSupplier) {
      fetchDetails(selectedSupplier.id);
    }
  }, [selectedSupplier]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setContactPhone('');
    setContactEmail('');
    setError('');
  };

  const handleEdit = (supplier, e) => {
    e.stopPropagation();
    setEditingId(supplier.id);
    setName(supplier.name);
    setContactPhone(supplier.contactPhone);
    setContactEmail(supplier.contactEmail);
    setError('');
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!isAdmin || !window.confirm('Are you sure you want to delete this supplier?')) return;
    try {
      await window.pharmacoreAPI.deleteSupplier(id);
      fetchDashboard();
      if (selectedSupplier?.id === id) setSelectedSupplier(null);
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Supplier name is required.');
      return;
    }

    const nameLower = name.trim().toLowerCase();
    const isDuplicate = dashboardStats.some(s => s.name.toLowerCase() === nameLower && s.id !== editingId);
    
    if (isDuplicate) {
      setError('A supplier with this name already exists.');
      return;
    }

    if (contactPhone && !isValidPhone(contactPhone)) {
      setError('Contact phone must contain only numbers and symbols (+, -, space). No letters allowed.');
      return;
    }

    if (contactEmail && !isValidEmail(contactEmail)) {
      setError('Invalid email address format.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = { name: name.trim(), contactPhone: contactPhone.trim(), contactEmail: contactEmail.trim() };
      
      if (editingId) {
        await window.pharmacoreAPI.updateSupplier(editingId, payload);
      } else {
        await window.pharmacoreAPI.addSupplier(payload);
      }
      resetForm();
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (val) => `Rs ${Number(val || 0).toFixed(2)}`;

  if (selectedSupplier) {
    // ── DETAIL VIEW ──
    const totalSpent = selectedSupplier.totalSpent || 0;
    const totalProfit = selectedSupplier.totalProfitGenerated || 0;
    const reorders = supplierDetails.filter(d => d.suggestReorder);

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
        {/* Detail Header */}
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              setSelectedSupplier(null);
              fetchDashboard();
            }}
            className="p-2 hover:bg-ink/5 rounded-lg transition-colors text-ink/60 hover:text-ink"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h3 className="text-3xl font-title font-medium text-ink mb-1">{selectedSupplier.name}</h3>
            <p className="text-sm text-ink/60 flex gap-4 mt-0.5">
              <span>{selectedSupplier.contactPhone || 'No Phone'}</span>
              <span>{selectedSupplier.contactEmail || 'No Email'}</span>
            </p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-5 rounded-none border border-ink/10  flex items-start gap-4">
            <div className="p-3 bg-terracotta/5 text-terracotta/80 rounded-lg"><DollarSign size={24} /></div>
            <div>
              <p className="text-xs font-semibold text-ink/60 uppercase">Total Spent</p>
              <p className="text-xl font-bold text-ink mt-1">{formatCurrency(totalSpent)}</p>
            </div>
          </div>
          <div className="bg-white p-5 rounded-none border border-ink/10  flex items-start gap-4">
            <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg"><TrendingUp size={24} /></div>
            <div>
              <p className="text-xs font-semibold text-ink/60 uppercase">Profit Generated</p>
              <p className="text-xl font-bold text-ink mt-1">{formatCurrency(totalProfit)}</p>
            </div>
          </div>
          <div className="bg-white p-5 rounded-none border border-ink/10  flex items-start gap-4">
            <div className="p-3 bg-emerald/5 text-emerald/90 rounded-lg"><Calendar size={24} /></div>
            <div>
              <p className="text-xs font-semibold text-ink/60 uppercase">Last Purchase</p>
              <p className="text-xl font-bold text-ink mt-1">
                {selectedSupplier.lastPurchaseDate ? selectedSupplier.lastPurchaseDate.split('T')[0] : 'Never'}
              </p>
            </div>
          </div>
        </div>

        {/* Reorder Suggestions */}
        {reorders.length > 0 && (
          <div className="bg-amber/5 border border-amber-200 rounded-none p-5">
            <h4 className="flex items-center gap-2 text-amber font-bold mb-3">
              <AlertTriangle size={18} /> Reorder Suggestions
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reorders.map(r => (
                <div key={r.id} className="bg-white/60 p-3 rounded-lg border border-amber-100 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-ink text-sm">{r.medicineName}</p>
                    <p className="text-xs text-ink/60 mt-0.5">Batch {r.batchNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-amber">{r.remainingStock} units left</p>
                    <p className="text-[10px] text-ink/40 mt-0.5">
                      {r.salesVelocityPerDay > 0 ? `${r.salesVelocityPerDay.toFixed(1)} sold / day` : 'Slow moving'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Purchase History Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-black text-slate-900">Purchase & Batch Order History</h4>
          </div>
          <DataTable
            columns={[
              {
                header: 'Medicine',
                accessor: (d) => d.medicine?.name || 'Unknown',
                sortable: true,
                cell: (d) => (
                  <div>
                    <p className="font-extrabold text-slate-900 text-xs">{d.medicine?.name || 'Unknown'}</p>
                    <span className="font-mono text-[10px] text-slate-500">Batch: {d.batchNumber}</span>
                  </div>
                )
              },
              {
                header: 'Date Purchased',
                accessor: 'datePurchased',
                sortable: true,
                cell: (d) => <span className="font-mono text-xs text-slate-700">{d.datePurchased ? d.datePurchased.split('T')[0] : '—'}</span>
              },
              {
                header: 'Purchased Qty',
                accessor: 'originalQuantity',
                sortable: true,
                align: 'right',
                cell: (d) => <span className="font-mono font-bold text-slate-800 text-xs">{d.originalQuantity}</span>
              },
              {
                header: 'Cost Per Unit',
                accessor: 'costPerUnit',
                sortable: true,
                align: 'right',
                cell: (d) => <span className="font-mono font-semibold text-slate-600 text-xs">{formatCurrency(d.costPerUnit)}</span>
              },
              {
                header: 'Current Stock',
                accessor: 'quantityInStock',
                sortable: true,
                align: 'right',
                cell: (d) => (
                  <span className={`font-mono font-black text-xs ${d.quantityInStock > 10 ? 'text-emerald-700' : d.quantityInStock > 0 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {d.quantityInStock}
                  </span>
                )
              }
            ]}
            data={supplierDetails}
            searchKeys={[(d) => d.medicine?.name, 'batchNumber']}
            searchPlaceholder="Search purchased medicines or batch #..."
            loading={detailsLoading}
            emptyMessage="No purchases found for this supplier."
            exportFileName={`${selectedSupplier?.name || 'supplier'}-purchases`}
          />
        </div>
      </div>
    );
  }

  // ── MASTER VIEW ──
  const masterColumns = [
    {
      header: 'Supplier Name',
      accessor: 'name',
      sortable: true,
      cell: (s) => (
        <div>
          <span className="font-black text-slate-900 text-sm group-hover:text-emerald-700 transition-colors">{s.name}</span>
          <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500 mt-0.5">
            {s.contactPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" />{s.contactPhone}</span>}
            {s.contactEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-slate-400" />{s.contactEmail}</span>}
            {!s.contactPhone && !s.contactEmail && <span className="text-slate-400">No contact info</span>}
          </div>
        </div>
      )
    },
    {
      header: 'Total Spent',
      accessor: 'totalSpent',
      sortable: true,
      align: 'right',
      cell: (s) => (
        <span className="font-mono font-bold text-slate-700 text-xs">
          {formatCurrency(s.totalSpent)}
        </span>
      )
    },
    {
      header: 'Profit Generated',
      accessor: 'totalProfitGenerated',
      sortable: true,
      align: 'right',
      cell: (s) => (
        <span className="font-mono font-black text-emerald-700 text-sm">
          {formatCurrency(s.totalProfitGenerated)}
        </span>
      )
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (s) => (
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setSelectedSupplier(s)}
            className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold px-2.5 py-1 rounded-lg text-xs transition-colors shadow-sm"
          >
            Insights <ArrowRight className="w-3 h-3" />
          </button>
          {isAdmin && (
            <>
              <button
                onClick={(e) => handleEdit(s, e)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                title="Edit Supplier"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => handleDelete(s.id, e)}
                className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                title="Delete Supplier"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Supplier Dashboard</h3>
          <p className="text-xs font-semibold text-slate-500">
            Track purchases, analyze vendor profitability, review reorder alerts, and manage distributor contacts.
          </p>
        </div>
        <button
          onClick={fetchDashboard}
          disabled={loading}
          className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold px-3.5 py-2 rounded-xl text-xs shadow-sm transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col: Create/Edit Form (Admin only) */}
        {isAdmin ? (
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-sm h-fit space-y-4">
            <div>
              <h4 className="text-base font-black text-slate-900">
                {editingId ? 'Edit Supplier' : 'Add New Supplier'}
              </h4>
              <p className="text-[11px] font-semibold text-slate-400">Save distributor contact information</p>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Supplier Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 text-xs font-bold outline-none transition-all"
                  placeholder="e.g. OBS Pakistan Ltd / Highnoon Labs"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Contact Phone</label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 text-xs font-bold outline-none transition-all"
                  placeholder="e.g. +92 300 1234567"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Contact Email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 text-xs font-bold outline-none transition-all"
                  placeholder="e.g. orders@distributor.pk"
                />
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-rose-700 text-xs font-bold">
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-2.5 rounded-xl transition-all text-xs shadow-md"
                >
                  {isSubmitting ? 'Saving...' : (editingId ? 'Update Supplier' : 'Save Supplier')}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={isSubmitting}
                    className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl transition-all text-xs border border-slate-300"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        ) : (
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-sm h-fit flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
              <Package className="w-6 h-6" />
            </div>
            <p className="text-slate-800 text-sm font-bold">Read-Only View</p>
            <p className="text-slate-500 text-xs mt-1">Only administrators can add or edit suppliers.</p>
          </div>
        )}

        {/* Right Col: Suppliers Dashboard List with DataTable */}
        <div className="lg:col-span-2">
          <DataTable
            columns={masterColumns}
            data={dashboardStats}
            searchKeys={['name', 'contactPhone', 'contactEmail']}
            searchPlaceholder="Search suppliers by name, phone, email..."
            exportFileName="suppliers-dashboard"
            loading={loading}
            emptyMessage="No suppliers registered yet."
            onRowClick={(s) => setSelectedSupplier(s)}
          />
        </div>

      </div>
    </div>
  );
}
