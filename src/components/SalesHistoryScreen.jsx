import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Download, 
  Upload, 
  Receipt as ReceiptIcon, 
  RotateCcw, 
  Trash2, 
  Printer, 
  DollarSign, 
  ShoppingBag, 
  TrendingUp, 
  CreditCard, 
  Wallet, 
  Zap, 
  Calendar, 
  FileText, 
  X 
} from 'lucide-react';
import Receipt from './Receipt.jsx';
import ExportImportButton from './ExportImportButton.jsx';
import ExportImportModal from './ExportImportModal.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import DataTable from './DataTable.jsx';

export default function SalesHistoryScreen({ user, onNavigateToReturns }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Export / Import state
  const [exportModal, setExportModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [ioLoading, setIoLoading] = useState(false);
  const [ioError, setIoError] = useState('');
  const [exportSuccess, setExportSuccess] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  const isAdmin = user.role === 'admin';
  
  // Date & Filter presets
  const [datePreset, setDatePreset] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCashier, setSelectedCashier] = useState('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');
  
  // Selected sale for receipt modal
  const [selectedSale, setSelectedSale] = useState(null);

  useEffect(() => {
    fetchSales();
  }, []);

  const fetchSales = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await window.pharmacoreAPI.getSales();
      const sorted = (data || []).sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
      setSales(sorted);
    } catch (err) {
      console.error('Failed to fetch sales history', err);
      setError('Failed to fetch sales history.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (password) => {
    setIoLoading(true);
    setIoError('');
    try {
      const result = await window.pharmacoreAPI.exportSales(password);
      if (!result.success) {
        setIoError(result.error || 'Export failed.');
        return;
      }
      setExportModal(false);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 2500);
    } catch (err) {
      setIoError(err.message || 'Export failed.');
    } finally {
      setIoLoading(false);
    }
  };

  const handleImport = async (password) => {
    setIoLoading(true);
    setIoError('');
    try {
      const result = await window.pharmacoreAPI.importSales(password);
      if (!result.success) {
        setIoError(result.error || 'Import failed.');
        return;
      }

      const existingCount = sales.length;
      const confirmMsg = existingCount > 0
        ? `Warning: This will permanently OVERWRITE all ${existingCount} existing sales records with ${result.records.length} records from the import file. This cannot be undone.\n\nAre you sure?`
        : `This will import ${result.records.length} sales records. Continue?`;

      if (!window.confirm(confirmMsg)) {
        setImportModal(false);
        setIoLoading(false);
        return;
      }

      const applyResult = await window.pharmacoreAPI.applySalesImport(result.records);
      if (!applyResult.success) {
        setIoError('Failed to apply import.');
        return;
      }

      setImportModal(false);
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 2500);
      fetchSales();
    } catch (err) {
      setIoError(err.message || 'Import failed.');
    } finally {
      setIoLoading(false);
    }
  };

  const handleDeleteSale = async (id) => {
    if (!window.confirm('Are you sure you want to delete this sale? This will restore the stock of all items in this sale.')) return;
    try {
      await window.pharmacoreAPI.deleteSale(id);
      fetchSales();
    } catch (err) {
      alert(err.message || 'Failed to delete sale');
    }
  };

  // Cashiers list
  const cashiers = ['all', ...new Set(sales.map(s => s.cashierUserId).filter(Boolean))];

  // Apply filters
  const filteredSales = sales.filter(sale => {
    const saleDate = new Date(sale.dateTime);
    const today = new Date();

    // Date Presets
    if (datePreset === 'today') {
      if (saleDate.toDateString() !== today.toDateString()) return false;
    } else if (datePreset === 'week') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(today.getDate() - 7);
      if (saleDate < sevenDaysAgo) return false;
    } else if (datePreset === 'month') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);
      if (saleDate < thirtyDaysAgo) return false;
    } else if (datePreset === 'custom') {
      if (startDate) {
        const start = new Date(`${startDate}T00:00:00`);
        if (saleDate < start) return false;
      }
      if (endDate) {
        const end = new Date(`${endDate}T23:59:59.999`);
        if (saleDate > end) return false;
      }
    }

    if (selectedCashier !== 'all' && sale.cashierUserId !== selectedCashier) return false;
    if (selectedPaymentMethod !== 'all' && (sale.paymentMethod || 'cash').toLowerCase() !== selectedPaymentMethod.toLowerCase()) return false;

    return true;
  });

  // Metrics
  const totalRevenue = filteredSales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
  const totalTransactions = filteredSales.length;
  const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // Format Helpers
  const formatDateTime = (isoString) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const getItemSummary = (items) => {
    if (!items || items.length === 0) return 'No items';
    const summary = items.map(item => `${item.name} (x${item.quantity})`).join(', ');
    return summary.length > 45 ? `${summary.substring(0, 42)}...` : summary;
  };

  // DataTable Columns
  const columns = [
    {
      header: 'Invoice #',
      accessor: (s) => s.invoiceNumber || `PC-${s.id.slice(0, 8).toUpperCase()}`,
      sortable: true,
      sortKey: 'invoiceNumber',
      cell: (s) => (
        <span className="font-mono font-bold text-slate-900 text-xs bg-slate-100 px-2 py-1 rounded border border-slate-200">
          {s.invoiceNumber || `PC-${s.id.slice(0, 8).toUpperCase()}`}
        </span>
      )
    },
    {
      header: 'Date & Time',
      accessor: 'dateTime',
      sortable: true,
      cell: (s) => (
        <div>
          <p className="font-bold text-slate-800 text-xs">{formatDateTime(s.dateTime)}</p>
        </div>
      )
    },
    {
      header: 'Items Sold',
      accessor: (s) => (s.items || s.saleItems || []).length,
      sortable: true,
      cell: (s) => {
        const items = s.items || s.saleItems || [];
        const totalItemsCount = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
        return (
          <div className="max-w-xs">
            <p className="truncate text-xs font-semibold text-slate-700" title={getItemSummary(items)}>
              {getItemSummary(items)}
            </p>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
              {totalItemsCount} item{totalItemsCount !== 1 ? 's' : ''} total
            </span>
          </div>
        );
      }
    },
    {
      header: 'Customer',
      accessor: (s) => s.customerName || (s.customerId ? 'Registered Patient' : 'Walk-in'),
      sortable: true,
      sortKey: 'customerName',
      cell: (s) => (
        <div>
          <p className="text-xs font-bold text-slate-900 leading-snug">
            {s.customerName || (s.customerId ? 'Registered Patient' : 'Walk-in Customer')}
          </p>
          {s.customerPhone && (
            <p className="text-[10px] font-mono text-slate-500 font-medium">{s.customerPhone}</p>
          )}
        </div>
      )
    },
    {
      header: 'Payment',
      accessor: 'paymentMethod',
      sortable: true,
      cell: (s) => {
        const method = (s.paymentMethod || 'cash').toLowerCase();
        const badgeColors = {
          cash: 'bg-emerald-100 text-emerald-800 border-emerald-200',
          card: 'bg-blue-100 text-blue-800 border-blue-200',
          jazzcash: 'bg-amber-100 text-amber-900 border-amber-200',
          easypaisa: 'bg-teal-100 text-teal-900 border-teal-200',
          bank_transfer: 'bg-purple-100 text-purple-800 border-purple-200'
        };
        return (
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${badgeColors[method] || 'bg-slate-100 text-slate-700'}`}>
            {method.replace('_', ' ')}
          </span>
        );
      }
    },
    {
      header: 'Total Amount',
      accessor: 'totalAmount',
      sortable: true,
      align: 'right',
      cell: (s) => (
        <span className="font-mono font-black text-sm text-emerald-700">
          Rs {Number(s.totalAmount || 0).toFixed(2)}
        </span>
      )
    },
    {
      header: 'Cashier',
      accessor: (s) => s.cashierName || s.cashierUserId || '—',
      sortable: true,
      cell: (s) => (
        <span className="text-xs font-bold text-slate-600">
          {s.cashierName || s.cashierUserId || '—'}
        </span>
      )
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (s) => (
        <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setSelectedSale(s)}
            className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold px-2.5 py-1 rounded-lg text-xs transition-colors shadow-sm"
          >
            <Printer className="w-3.5 h-3.5" /> Receipt
          </button>
          <button
            onClick={() => onNavigateToReturns && onNavigateToReturns(s.id)}
            className="flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold px-2 py-1 rounded-lg text-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Return
          </button>
          {isAdmin && (
            <button
              onClick={() => handleDeleteSale(s.id)}
              className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
              title="Delete Sale"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )
    }
  ];

  // Expandable row renderer
  const renderSaleItemsBreakdown = (s) => {
    const items = s.items || s.saleItems || [];
    return (
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
        <h5 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-emerald-600" />
          Itemized Breakdown for Invoice #{s.invoiceNumber || s.id}
        </h5>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold uppercase text-[10px]">
              <tr>
                <th className="px-3 py-2">Item Name</th>
                <th className="px-3 py-2 text-center">Qty</th>
                <th className="px-3 py-2 text-right">Unit Price (PKR)</th>
                <th className="px-3 py-2 text-right">Tax Rate</th>
                <th className="px-3 py-2 text-right">Line Total (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-bold text-slate-900">{item.name}</td>
                  <td className="px-3 py-2 text-center font-mono font-bold">{item.quantity}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">Rs {Number(item.priceAtSale || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500">{item.taxRateAtSale ? `${item.taxRateAtSale}%` : '0%'}</td>
                  <td className="px-3 py-2 text-right font-mono font-black text-emerald-700">
                    Rs {Number((item.priceAtSale || 0) * (item.quantity || 1)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Sales History & Transactions</h3>
          <p className="text-xs font-semibold text-slate-500">
            Real-time transaction logs, cashier settlements, receipt reprints, and returns.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <ExportImportButton
              variant="export"
              label="Export Sales"
              icon={<Download size={15} />}
              onClick={() => { setIoError(''); setExportModal(true); }}
              success={exportSuccess}
            />
            <ExportImportButton
              variant="import"
              label="Import Sales"
              icon={<Upload size={15} />}
              onClick={() => { setIoError(''); setImportModal(true); }}
              success={importSuccess}
            />
          </div>
        )}
      </div>

      {/* ── Summary Stats Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Total Revenue</p>
            <h4 className="text-2xl font-black text-emerald-700 font-mono mt-1">Rs {totalRevenue.toFixed(2)}</h4>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <DollarSign className="w-6 h-6 stroke-[2.5]" />
          </div>
        </div>

        <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Total Orders</p>
            <h4 className="text-2xl font-black text-slate-900 font-mono mt-1">{totalTransactions}</h4>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <ShoppingBag className="w-6 h-6 stroke-[2.5]" />
          </div>
        </div>

        <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Average Order Value</p>
            <h4 className="text-2xl font-black text-slate-900 font-mono mt-1">Rs {avgOrderValue.toFixed(2)}</h4>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 stroke-[2.5]" />
          </div>
        </div>
      </div>

      {/* ── DataTable with Search, Date & Payment Filters ── */}
      <DataTable
        columns={columns}
        data={filteredSales}
        searchKeys={['invoiceNumber', 'cashierName', 'cashierUserId', 'paymentMethod']}
        searchPlaceholder="Search by invoice #, cashier, payment..."
        exportFileName="sales-transactions"
        loading={loading}
        emptyMessage="No sales transactions found for the selected filters."
        expandableRow={renderSaleItemsBreakdown}
        filters={(
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date Preset Selector */}
            <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl">
              {[
                { id: 'all', label: 'All Time' },
                { id: 'today', label: 'Today' },
                { id: 'week', label: '7 Days' },
                { id: 'month', label: '30 Days' },
                { id: 'custom', label: 'Custom' }
              ].map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setDatePreset(preset.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-extrabold transition-all ${
                    datePreset === preset.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Date Range Inputs (if custom chosen) */}
            {datePreset === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
                />
                <span className="text-slate-400 text-xs">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
                />
              </div>
            )}

            {/* Payment Method Filter */}
            <select
              value={selectedPaymentMethod}
              onChange={e => setSelectedPaymentMethod(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
            >
              <option value="all">All Payments</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="jazzcash">JazzCash</option>
              <option value="easypaisa">Easypaisa</option>
              <option value="bank_transfer">Bank</option>
            </select>

            {/* Cashier Filter */}
            <select
              value={selectedCashier}
              onChange={e => setSelectedCashier(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
            >
              {cashiers.map(c => {
                const displayName = c === 'all' 
                  ? 'All Cashiers' 
                  : (sales.find(s => s.cashierUserId === c)?.cashierName || c);
                return (
                  <option key={c} value={c}>
                    {displayName}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      />

      {/* Receipt Modal Overlay */}
      {selectedSale && createPortal(
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[100] overflow-y-auto no-print animate-fade-in">
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative animate-in zoom-in-95 duration-200 my-auto">
            {/* Modal Actions */}
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-200">
              <div>
                <h4 className="text-base font-black text-slate-900">Receipt Review & Print</h4>
                <p className="text-xs font-semibold text-slate-500">Invoice: #{selectedSale.invoiceNumber || selectedSale.id?.slice(0, 8)}</p>
              </div>
              <button
                onClick={() => setSelectedSale(null)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-xl transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Embedded Receipt */}
            <div className="bg-white rounded-xl overflow-hidden p-2 border border-slate-100 shadow-inner">
              <ErrorBoundary>
                <Receipt sale={selectedSale} />
              </ErrorBoundary>
            </div>

            {/* Print and Close Buttons */}
            <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => window.print()}
                className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold py-2.5 px-5 rounded-xl transition-all flex items-center gap-2 text-xs shadow-md"
              >
                <Printer className="w-4 h-4" />
                Print Receipt
              </button>
              <button
                onClick={() => setSelectedSale(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-2.5 px-5 rounded-xl transition-all text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Export Modal */}
      {exportModal && (
        <ExportImportModal
          mode="export"
          title="Export Sales History"
          description="The file will be encrypted with your chosen password. Keep it safe — it is the only way to decrypt this file."
          onConfirm={handleExport}
          onCancel={() => { setExportModal(false); setIoError(''); }}
          isLoading={ioLoading}
          error={ioError}
        />
      )}

      {/* Import Modal */}
      {importModal && (
        <ExportImportModal
          mode="import"
          title="Import Sales History"
          description="Select a .pce sales file and enter its password. You will be asked to confirm before any existing data is overwritten."
          onConfirm={handleImport}
          onCancel={() => { setImportModal(false); setIoError(''); }}
          isLoading={ioLoading}
          error={ioError}
        />
      )}
    </div>
  );
}
