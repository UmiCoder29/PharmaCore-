import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, Package, AlertCircle, RotateCcw, ShieldAlert, Check, X } from 'lucide-react';
import DataTable from './DataTable.jsx';

export default function ReturnsScreen({ user, initialSaleId, clearInitialSaleId }) {
  const isAdmin = user.role === 'admin';
  const [activeTab, setActiveTab] = useState(initialSaleId ? 'new' : 'history');
  
  // Data States
  const [sales, setSales] = useState([]);
  const [returns, setReturns] = useState([]);
  const [quarantineItems, setQuarantineItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // New Return States
  const [searchSaleId, setSearchSaleId] = useState(initialSaleId || '');
  const [selectedSale, setSelectedSale] = useState(null);
  const [returnItems, setReturnItems] = useState([]); 
  const [refundMethod, setRefundMethod] = useState('Cash');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchReturns();
    if (isAdmin) fetchQuarantine();
    fetchSales();
  }, [isAdmin]);

  useEffect(() => {
    if (initialSaleId) {
      setActiveTab('new');
      setSearchSaleId(initialSaleId);
      handleSearchSale(initialSaleId);
    }
  }, [initialSaleId, sales]);

  const fetchSales = async () => {
    try {
      const data = await window.pharmacoreAPI.getSales();
      setSales(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchReturns = async () => {
    setLoading(true);
    try {
      const data = await window.pharmacoreAPI.getReturns();
      setReturns(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuarantine = async () => {
    try {
      const data = await window.pharmacoreAPI.getQuarantine();
      setQuarantineItems(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearchSale = (overrideId = null) => {
    const idToSearch = overrideId || searchSaleId;
    if (!idToSearch) return;
    
    const sale = sales.find(s => s.id === idToSearch || s.invoiceNumber === idToSearch);
    if (!sale) {
      setError('Sale not found. Please check the ID or invoice number.');
      setSelectedSale(null);
      setReturnItems([]);
      return;
    }

    setError('');
    setSelectedSale(sale);
    const initialItems = (sale.items || sale.saleItems || []).map(item => ({
      saleItemId: item.id,
      medicineId: item.medicineId,
      batchId: item.batchId,
      batchNumber: item.batchNumber,
      name: item.name,
      quantityToReturn: 0,
      maxQuantity: item.quantity,
      priceAtSale: (item.subtotalItem || (item.priceAtSale * item.quantity)) / item.quantity,
      reason: 'Wrong item given',
      condition: 'unopened'
    }));
    setReturnItems(initialItems);
  };

  const handleReturnItemChange = (saleItemId, field, value) => {
    setReturnItems(prev => prev.map(item => {
      if (item.saleItemId === saleItemId) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  const totalRefundAmount = returnItems.reduce((sum, item) => {
    return sum + (item.quantityToReturn * item.priceAtSale);
  }, 0);

  const handleSubmitReturn = async () => {
    const itemsToReturn = returnItems.filter(item => item.quantityToReturn > 0);
    if (itemsToReturn.length === 0) {
      setError('Please select at least one item to return.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const payloadItems = itemsToReturn.map(item => ({
        sale_item_id: item.saleItemId,
        quantity: item.quantityToReturn,
        reason: item.reason,
        condition: item.condition
      }));

      const returnId = crypto.randomUUID();
      const result = await window.pharmacoreAPI.processReturn({
        returnId,
        saleId: selectedSale.id,
        items: payloadItems,
        refundMethod
      });

      if (result.success) {
        alert('Return processed successfully!');
        setSelectedSale(null);
        setSearchSaleId('');
        setReturnItems([]);
        if (clearInitialSaleId) clearInitialSaleId();
        setActiveTab('history');
        fetchReturns();
        if (isAdmin) fetchQuarantine();
      }
    } catch (err) {
      setError(err.message || 'Failed to process return.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (returnId) => {
    if (!window.confirm('Approve this Cash return and restore stock?')) return;
    try {
      await window.pharmacoreAPI.approveReturn(returnId);
      fetchReturns();
      if (isAdmin) fetchQuarantine();
    } catch (err) {
      alert(err.message || 'Failed to approve return');
    }
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  // Columns for Returns History
  const returnColumns = [
    {
      header: 'Return Date & Time',
      accessor: 'returnDate',
      sortable: true,
      cell: (r) => <span className="font-bold text-slate-800 text-xs">{formatDateTime(r.returnDate)}</span>
    },
    {
      header: 'Original Sale ID',
      accessor: 'saleId',
      sortable: true,
      cell: (r) => (
        <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200" title={r.saleId}>
          {r.saleId?.slice(0, 8)}...
        </span>
      )
    },
    {
      header: 'Refund Amount',
      accessor: 'totalRefundAmount',
      sortable: true,
      align: 'right',
      cell: (r) => (
        <span className="font-mono font-black text-rose-600 text-sm">
          Rs {Number(r.totalRefundAmount || 0).toFixed(2)}
        </span>
      )
    },
    {
      header: 'Method',
      accessor: 'refundMethod',
      sortable: true,
      cell: (r) => (
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${r.refundMethod === 'Cash' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-700'}`}>
          {r.refundMethod}
        </span>
      )
    },
    {
      header: 'Status',
      accessor: 'status',
      sortable: true,
      cell: (r) => (
        r.status === 'completed' ? (
          <div className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 px-2.5 py-0.5 rounded-full border border-emerald-200 text-[10px] font-black uppercase">
            <CheckCircle className="w-3 h-3 text-emerald-600" /> Completed
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 px-2.5 py-0.5 rounded-full border border-amber-200 text-[10px] font-black uppercase">
            <Clock className="w-3 h-3 text-amber-600" /> Pending Approval
          </div>
        )
      )
    },
    ...(isAdmin ? [{
      header: 'Actions',
      align: 'right',
      cell: (r) => (
        r.status === 'pending' ? (
          <button
            onClick={() => handleApprove(r.id)}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg text-xs font-black shadow-sm transition-all"
          >
            <Check className="w-3 h-3" /> Approve
          </button>
        ) : <span className="text-slate-400 text-xs">—</span>
      )
    }] : [])
  ];

  // Columns for Quarantine Items
  const quarantineColumns = [
    {
      header: 'Quarantine Date',
      accessor: (item) => item.returns?.returnDate,
      sortable: true,
      cell: (item) => <span className="font-bold text-slate-800 text-xs">{formatDateTime(item.returns?.returnDate)}</span>
    },
    {
      header: 'Medicine & Batch',
      accessor: (item) => item.medicines?.name,
      sortable: true,
      cell: (item) => (
        <div>
          <span className="font-extrabold text-slate-900 text-xs">{item.medicines?.name}</span>
          <p className="font-mono text-[10px] text-slate-500">Batch: {item.batchNumber || item.batchId?.slice(0, 8)}</p>
        </div>
      )
    },
    {
      header: 'Quantity',
      accessor: 'quantity',
      sortable: true,
      align: 'right',
      cell: (item) => <span className="font-mono font-black text-rose-600 text-xs">{item.quantity}</span>
    },
    {
      header: 'Return Reason',
      accessor: 'reason',
      sortable: true,
      cell: (item) => <span className="text-xs text-slate-700 font-semibold">{item.reason}</span>
    },
    {
      header: 'Condition',
      accessor: 'condition',
      sortable: true,
      cell: (item) => (
        <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-black uppercase">
          {item.condition}
        </span>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Customer Returns & Quarantine</h3>
          <p className="text-xs font-semibold text-slate-500">
            Process item returns, restore sellable inventory, and manage damaged/opened quarantined drugs.
          </p>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('new')}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
            activeTab === 'new' 
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/20' 
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" /> Process New Return
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all ${
            activeTab === 'history' 
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/20' 
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Returns History ({returns.length})
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('quarantine')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
              activeTab === 'quarantine' 
                ? 'bg-rose-600 text-white shadow-md shadow-rose-950/20' 
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Quarantine ({quarantineItems.length})
          </button>
        )}
      </div>

      {/* ── NEW RETURN TAB ── */}
      {activeTab === 'new' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h4 className="text-base font-black text-slate-900">Find Sale / Invoice to Return</h4>
            <div className="flex gap-2 max-w-xl">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Paste or scan Sale ID or Invoice Number..."
                  value={searchSaleId}
                  onChange={(e) => setSearchSaleId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>
              <button
                onClick={() => handleSearchSale()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-black text-xs transition-all shadow-md"
              >
                Find Sale
              </button>
            </div>
            {error && (
              <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">{error}</p>
            )}
          </div>

          {selectedSale && (
            <div className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <div>
                  <h4 className="text-sm font-black text-slate-900">Invoice: {selectedSale.invoiceNumber || selectedSale.id}</h4>
                  <p className="text-xs font-semibold text-slate-500">Date: {formatDateTime(selectedSale.dateTime)} | Cashier: {selectedSale.cashierName || selectedSale.cashierUserId}</p>
                </div>
                <button
                  onClick={() => setSelectedSale(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-x-auto p-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 uppercase font-black text-[10px] border-b border-slate-200">
                      <th className="px-3 py-2.5">Item Name</th>
                      <th className="px-3 py-2.5">Sold Qty</th>
                      <th className="px-3 py-2.5">Unit Price</th>
                      <th className="px-3 py-2.5">Return Qty</th>
                      <th className="px-3 py-2.5">Reason</th>
                      <th className="px-3 py-2.5">Condition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {returnItems.map(item => (
                      <tr key={item.saleItemId} className="hover:bg-slate-50">
                        <td className="px-3 py-3 font-bold text-slate-900">{item.name}</td>
                        <td className="px-3 py-3 font-mono font-semibold text-slate-700">{item.maxQuantity}</td>
                        <td className="px-3 py-3 font-mono font-semibold text-slate-700">Rs {item.priceAtSale.toFixed(2)}</td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            max={item.maxQuantity}
                            value={item.quantityToReturn}
                            onChange={(e) => handleReturnItemChange(item.saleItemId, 'quantityToReturn', Math.min(item.maxQuantity, Math.max(0, parseInt(e.target.value) || 0)))}
                            className="w-20 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 font-mono font-bold text-xs outline-none focus:border-emerald-600"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={item.reason}
                            disabled={item.quantityToReturn === 0}
                            onChange={(e) => handleReturnItemChange(item.saleItemId, 'reason', e.target.value)}
                            className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-semibold outline-none"
                          >
                            <option value="Wrong item given">Wrong item given</option>
                            <option value="Wrong prescription">Wrong prescription</option>
                            <option value="Customer changed mind (unopened)">Customer changed mind (unopened)</option>
                            <option value="Suspected counterfeit or quality issue">Suspected counterfeit or quality issue</option>
                            <option value="Other">Other</option>
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={item.condition}
                            disabled={item.quantityToReturn === 0}
                            onChange={(e) => handleReturnItemChange(item.saleItemId, 'condition', e.target.value)}
                            className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-semibold outline-none"
                          >
                            <option value="unopened">Unopened (Return to Stock)</option>
                            <option value="opened">Opened (Quarantine)</option>
                            <option value="N/A">N/A</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-700">Refund Method:</span>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                    className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Store Credit">Store Credit</option>
                  </select>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-sm font-black text-slate-700">Total Refund: <strong className="text-emerald-700 font-mono text-base">Rs {totalRefundAmount.toFixed(2)}</strong></span>
                  <button
                    onClick={handleSubmitReturn}
                    disabled={submitting || totalRefundAmount === 0}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-6 py-2 rounded-xl font-black text-xs shadow-md transition-all"
                  >
                    {submitting ? 'Processing...' : 'Complete Return'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {activeTab === 'history' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <DataTable
            columns={returnColumns}
            data={returns}
            searchKeys={['saleId', 'refundMethod', 'status']}
            searchPlaceholder="Search return transactions..."
            exportFileName="returns-history"
            loading={loading}
            emptyMessage="No return transactions recorded."
          />
        </div>
      )}

      {/* ── QUARANTINE TAB ── */}
      {activeTab === 'quarantine' && isAdmin && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center gap-3 text-rose-900 text-xs font-semibold">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
            <span>These items have been permanently removed from sellable inventory due to quality concerns, being opened, or damaged.</span>
          </div>

          <DataTable
            columns={quarantineColumns}
            data={quarantineItems}
            searchKeys={[(item) => item.medicines?.name, 'reason', 'batchNumber']}
            searchPlaceholder="Search quarantined items..."
            exportFileName="quarantined-stock"
            emptyMessage="No items in quarantine."
          />
        </div>
      )}

    </div>
  );
}
