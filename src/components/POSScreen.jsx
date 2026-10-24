import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { 
  Barcode, 
  Scan, 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  X, 
  Sparkles, 
  Package, 
  CreditCard, 
  Wallet, 
  User as UserIcon, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Flame, 
  Zap, 
  ArrowRight,
  Printer,
  Phone,
  MapPin,
  IdCard,
  UserCheck
} from 'lucide-react';
import Receipt from './Receipt.jsx';
import LowStockPopup from './LowStockPopup.jsx';
import { LOW_STOCK_THRESHOLD } from '../utils/constants.js';

const alertedMedicines = new Set();

export default function POSScreen({ user }) {
  const [medicines, setMedicines] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [prescriptionId, setPrescriptionId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [defaultTaxRate, setDefaultTaxRate] = useState(0);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]); // Array of { medicineId, name, quantity, priceAtSale, maxQuantity }
  
  // Patient & Prescription Modal States
  const [showAddPatientModal, setShowAddPatientModal] = useState(false);
  const [newPatient, setNewPatient] = useState({ fullName: '', phone: '', cnic: '', address: '' });
  const [patientModalSubmitting, setPatientModalSubmitting] = useState(false);
  const [patientModalError, setPatientModalError] = useState('');

  const [showAddPrescriptionModal, setShowAddPrescriptionModal] = useState(false);
  const [newPrescription, setNewPrescription] = useState({ 
    prescriberName: '', 
    prescriptionDate: new Date().toISOString().split('T')[0], 
    notes: '' 
  });
  const [prescriptionModalSubmitting, setPrescriptionModalSubmitting] = useState(false);
  const [prescriptionModalError, setPrescriptionModalError] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedSale, setCompletedSale] = useState(null); // When set, shows receipt
  const [error, setError] = useState('');
  const [lowStockAlerts, setLowStockAlerts] = useState([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');

  const searchInputRef = useRef(null);
  const processingRef  = useRef(false); // H1: synchronous guard against double-submission
  const screenRef = useRef(null);
  const cartListRef = useRef(null);
  const checkoutRef = useRef(null);
  const totalRef = useRef(null);

  useLayoutEffect(() => {
    const context = gsap.context(() => {
      gsap.fromTo('[data-pos-intro]', { opacity: 0, y: 18 }, {
        opacity: 1, y: 0, duration: 0.55, stagger: 0.09, ease: 'power3.out', clearProps: 'transform'
      });
    }, screenRef);
    return () => context.revert();
  }, []);

  useEffect(() => {
    if (!cartListRef.current || cart.length === 0) return;
    gsap.fromTo(cartListRef.current.querySelectorAll('[data-cart-item]'),
      { opacity: 0, x: 18, scale: 0.98 },
      { opacity: 1, x: 0, scale: 1, duration: 0.3, stagger: 0.045, ease: 'power2.out', overwrite: 'auto' }
    );
    gsap.fromTo(checkoutRef.current, { boxShadow: '0 0 0 rgba(15,92,67,0)' }, { boxShadow: '0 12px 30px rgba(15,92,67,0.14)', duration: 0.38, yoyo: true, repeat: 1 });
  }, [cart.length]);

  useEffect(() => {
    fetchMedicines();
    fetchCategories();
    fetchDefaultTaxRate();
    fetchCustomers();
    // Auto-focus search for barcode scanners
    if (searchInputRef.current) searchInputRef.current.focus();
  }, []);

  useEffect(() => {
    setPrescriptionId('');
    if (!customerId) { setPrescriptions([]); return; }
    window.pharmacoreAPI.getPrescriptions(customerId)
      .then(setPrescriptions)
      .catch(err => console.error('Failed to load prescriptions', err));
  }, [customerId]);

  const triggerInAppLowStockNotification = (name, stock, idStr) => {
    const popupId = Date.now() + Math.random().toString();
    setLowStockAlerts(prev => [...prev, { id: popupId, name, stock, medId: idStr }]);
    alertedMedicines.add(idStr);
  };

  const fetchMedicines = async () => {
    try {
      const data = await window.pharmacoreAPI.getMedicines();
      
      setMedicines(prevMeds => {
        data.forEach(newMed => {
          const newActive = (newMed.batches || []).filter(b => !b.isExpired).reduce((s,b) => s+b.quantityInStock, 0);
          if (newActive <= LOW_STOCK_THRESHOLD && !alertedMedicines.has(newMed.id)) {
            triggerInAppLowStockNotification(newMed.name, newActive, newMed.id);
          }
        });
        return data;
      });
    } catch (err) {
      console.error('Failed to load inventory', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const data = await window.pharmacoreAPI.getCategories();
      setCategories(data);
    } catch (err) {
      console.error('Failed to load categories', err);
    }
  };

  const fetchCustomers = async () => {
    try {
      setCustomers(await window.pharmacoreAPI.getCustomers());
    } catch (err) {
      console.error('Failed to load customers', err);
    }
  };

  const handleSavePatient = async (e) => {
    e?.preventDefault();
    if (!newPatient.fullName?.trim()) {
      setPatientModalError('Patient / customer name is required.');
      return;
    }
    setPatientModalSubmitting(true);
    setPatientModalError('');
    try {
      const customer = await window.pharmacoreAPI.addCustomer({
        fullName: newPatient.fullName.trim(),
        phone: newPatient.phone.trim() || null,
        cnic: newPatient.cnic.trim() || null,
        address: newPatient.address.trim() || null
      });
      await fetchCustomers();
      setCustomerId(customer.id);
      setShowAddPatientModal(false);
      setNewPatient({ fullName: '', phone: '', cnic: '', address: '' });
    } catch (err) {
      setPatientModalError(err.message || 'Failed to register patient.');
    } finally {
      setPatientModalSubmitting(false);
    }
  };

  const handleSavePrescription = async (e) => {
    e?.preventDefault();
    if (!customerId) {
      setPrescriptionModalError('Please select or register a patient first.');
      return;
    }
    if (!newPrescription.prescriberName?.trim()) {
      setPrescriptionModalError('Doctor / prescriber name is required.');
      return;
    }
    if (!newPrescription.prescriptionDate) {
      setPrescriptionModalError('Prescription date is required.');
      return;
    }
    setPrescriptionModalSubmitting(true);
    setPrescriptionModalError('');
    try {
      const prescription = await window.pharmacoreAPI.addPrescription({
        customerId,
        prescriberName: newPrescription.prescriberName.trim(),
        prescriptionDate: newPrescription.prescriptionDate,
        notes: newPrescription.notes.trim() || null
      });
      const updatedPrescriptions = await window.pharmacoreAPI.getPrescriptions(customerId);
      setPrescriptions(updatedPrescriptions || [prescription]);
      setPrescriptionId(prescription.id);
      setShowAddPrescriptionModal(false);
      setNewPrescription({ 
        prescriberName: '', 
        prescriptionDate: new Date().toISOString().split('T')[0], 
        notes: '' 
      });
    } catch (err) {
      setPrescriptionModalError(err.message || 'Failed to record prescription.');
    } finally {
      setPrescriptionModalSubmitting(false);
    }
  };

  const fetchDefaultTaxRate = async () => {
    try {
      const rate = await window.pharmacoreAPI.getDefaultTaxRate();
      setDefaultTaxRate(rate);
    } catch (err) {
      console.error('Failed to load default tax rate', err);
    }
  };

  const handleSearchKeyPress = (e) => {
    if (e.key === 'Enter' && search.trim() !== '') {
      // 1. Try to find exact barcode match first
      let match = medicines.find(m => m.barcode && m.barcode.toLowerCase() === search.trim().toLowerCase());
      
      // 2. Fallback to exact name match
      if (!match) {
        match = medicines.find(m => m.name.toLowerCase() === search.trim().toLowerCase());
      }
      
      if (match) {
        addToCart(match);
        setSearch(''); // Clear search after successful scan/enter
      }
    }
  };

  const addToCart = (med) => {
    setError('');
    
    const activeBatches = (med.batches || []).filter(b => !b.isExpired);
    const sellableQuantity = activeBatches.reduce((sum, b) => sum + b.quantityInStock, 0);

    // Check if we have stock at all
    if (sellableQuantity <= 0) {
      setError(`Cannot add ${med.name} - Out of active stock!`);
      return;
    }

    activeBatches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    const priceAtSale = activeBatches[0].sellingPrice || 0;

    setCart(prev => {
      const existing = prev.find(item => item.medicineId === med.id);
      
      if (existing) {
        if (existing.quantity >= sellableQuantity) {
          setError(`Cannot add more ${med.name} - Only ${sellableQuantity} in stock.`);
          return prev;
        }
        return prev.map(item => 
          item.medicineId === med.id 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      
      return [...prev, {
        medicineId: med.id,
        name: med.name,
        unitName: med.unitName || 'Tablet',
        packagingName: med.packagingName,
        unitsPerPackaging: med.unitsPerPackaging || 1,
        priceAtSale,
        quantity: 1,
        entryMode: 'base',
        maxQuantity: sellableQuantity
      }];
    });
  };

  const updateQuantity = (id, newDisplayedQty) => {
    setError('');
    if (newDisplayedQty === '' || newDisplayedQty === undefined || newDisplayedQty === null) return;
    
    setCart(prev => prev.map(item => {
      if (item.medicineId === id) {
        const displayedQty = parseFloat(newDisplayedQty);
        if (isNaN(displayedQty) || displayedQty <= 0) return item;
        
        const mode = item.entryMode || 'base';
        const newBaseQty = mode === 'packaging' 
          ? Math.round(displayedQty * item.unitsPerPackaging) 
          : Math.round(displayedQty);
          
        if (newBaseQty > item.maxQuantity) {
          setError(`Cannot set quantity. Only ${item.maxQuantity} in stock.`);
          return { ...item, quantity: item.maxQuantity };
        }
        
        return { ...item, quantity: Math.max(1, newBaseQty) };
      }
      return item;
    }));
  };

  const updateEntryMode = (id, newMode) => {
    setCart(prev => prev.map(item => 
      item.medicineId === id ? { ...item, entryMode: newMode } : item
    ));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.medicineId !== id));
  };

  // Helper to get tax rate for a medicine
  const getTaxRateForMedicine = (medicine) => {
    if (!medicine.categoryId) return defaultTaxRate;
    const category = categories.find(c => c.id === medicine.categoryId);
    return category?.taxRate ?? defaultTaxRate;
  };

  // Calculations for cart — M3: True FEFO allocation matching the backend
  const calculateCartTotals = () => {
    let subtotal = 0;
    let totalTax = 0;
    const saleItems = [];

    for (const item of cart) {
      const medicine = medicines.find(m => m.id === item.medicineId);
      if (!medicine) continue;

      const taxRate = getTaxRateForMedicine(medicine);
      const activeBatches = (medicine.batches || []).filter(b => !b.isExpired);
      activeBatches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

      let qtyNeeded = item.quantity;
      for (const batch of activeBatches) {
        if (qtyNeeded <= 0) break;
        const take = Math.min(batch.quantityInStock, qtyNeeded);
        qtyNeeded -= take;

        const subtotalItem = batch.sellingPrice * take;
        const taxAmount = (subtotalItem * taxRate) / 100;

        subtotal += subtotalItem;
        totalTax += taxAmount;
        
        saleItems.push({
          medicineId: medicine.id,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          name: medicine.name,
          quantity: take,
          priceAtSale: batch.sellingPrice,
          taxRateAtSale: taxRate,
          taxAmount: taxAmount,
          subtotalItem: subtotalItem
        });
      }
    }
    return { subtotal, totalTax, finalTotal: subtotal + totalTax, saleItems };
  };

  const { subtotal, totalTax, finalTotal: preDiscountTotal, saleItems } = calculateCartTotals();
  const finalTotal = Math.max(0, preDiscountTotal - Number(discountAmount || 0));
  const cashChange = paymentMethod === 'cash' && cashReceived !== ''
    ? Math.max(0, Number(cashReceived) - finalTotal)
    : 0;
  const needsPrescription = cart.some(item => {
    const medicine = medicines.find(m => m.id === item.medicineId);
    return medicine?.prescriptionRequired || medicine?.controlledSchedule;
  });

  useEffect(() => {
    if (totalRef.current) gsap.fromTo(totalRef.current, { scale: 0.96 }, { scale: 1, duration: 0.32, ease: 'back.out(1.5)' });
  }, [finalTotal]);

  const handleCheckout = async () => {
    // H1: Synchronous guard — blocks re-entry even before React re-renders the disabled state
    if (processingRef.current || cart.length === 0) return;
    processingRef.current = true;
    setIsProcessing(true);
    setError('');

    try {
      if (needsPrescription && (!customerId || !prescriptionId)) {
        throw new Error('Select a customer and verified prescription before dispensing prescription or controlled medicines.');
      }
      if (paymentMethod === 'cash' && (cashReceived === '' || Number(cashReceived) < finalTotal)) {
        throw new Error('Enter cash received equal to or greater than the total.');
      }
      const selectedCustomer = customers.find(c => c.id === customerId);
      const saleData = {
        subtotal,
        totalTax,
        totalAmount: finalTotal,
        discountAmount: Number(discountAmount || 0),
        customerId: customerId || null,
        customerName: selectedCustomer ? selectedCustomer.fullName : 'Walk-in Customer',
        customerPhone: selectedCustomer ? selectedCustomer.phone : null,
        cashierName: user?.name || user?.username || 'Staff',
        prescriptionId: prescriptionId || null,
        paymentMethod,
        cashReceived: paymentMethod === 'cash' ? Number(cashReceived) : null,
        changeAmount: cashChange,
        payments: [{ method: paymentMethod, amount: finalTotal }],
        items: saleItems
      };
      
      const saleRecord = await window.pharmacoreAPI.processSale(saleData);
      setCompletedSale({
        ...saleRecord,
        customerName: saleData.customerName,
        customerPhone: saleData.customerPhone,
        cashierName: saleData.cashierName
      });
      setCart([]); // Clear cart
      setDiscountAmount(0);
      setCashReceived('');
      setCustomerId('');
      setPrescriptionId('');
      fetchMedicines(); // Refresh stock
    } catch (err) {
      setError(err.message || 'Checkout failed.');
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const resetPOS = () => {
    setCompletedSale(null);
    setSearch('');
    if (searchInputRef.current) searchInputRef.current.focus();
  };

  const handlePrintReceipt = async () => {
    try {
      if (window.pharmacoreAPI?.printReceipt) {
        await window.pharmacoreAPI.printReceipt();
      } else {
        window.print();
      }
    } catch (err) {
      console.warn('[Print] Native print fallback:', err);
      window.print();
    }
  };

  // ── Render Receipt View ──────────────────────────────────────────────────
  if (completedSale) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[75vh] animate-in zoom-in duration-300 py-6">
        <Receipt sale={completedSale} />
        
        <div className="mt-8 flex gap-4 no-print">
          <button
            onClick={handlePrintReceipt}
            className="flex items-center gap-2 px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5"
          >
            <Printer className="w-5 h-5 text-emerald-400" />
            Print Receipt
          </button>
          <button
            onClick={resetPOS}
            className="flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5"
          >
            <Plus className="w-5 h-5" />
            New Sale (F2)
          </button>
        </div>
      </div>
    );
  }

  // ── Filtered Search Results ──────────────────────────────────────────────
  const filteredSearch = search.trim() === '' ? [] : medicines.filter(m => 
    m.name.toLowerCase().includes(search.toLowerCase()) || 
    (m.genericName && m.genericName.toLowerCase().includes(search.toLowerCase())) ||
    (m.barcode && m.barcode.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 10);

  // Quick picks filtered by category
  const displayedQuickPicks = medicines.filter(m => {
    const hasStock = (m.batches || []).some(b => !b.isExpired && b.quantityInStock > 0);
    if (!hasStock) return false;
    if (selectedCategoryFilter === 'all') return true;
    return m.categoryId === selectedCategoryFilter;
  }).slice(0, 12);

  return (
    <div ref={screenRef} className="h-full flex flex-col lg:flex-row gap-6 font-sans">
      
      {/* ──────────────── Left Column: Search & Catalog ──────────────── */}
      <div className="flex-1 flex flex-col gap-4 min-h-0 max-h-[calc(100vh-8.5rem)]">
        
        {/* ── Prominent Search Bar Container ── */}
        <div data-pos-intro className="relative rounded-2xl bg-white p-5 border-2 border-emerald-500/20 shadow-xl overflow-visible">
          {/* Top Decorative Gradient Line */}
          <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-amber-500 rounded-t-2xl" />

          {/* Header Row */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 font-extrabold text-sm">
                <Zap className="w-4 h-4 fill-emerald-600 text-emerald-600" />
              </span>
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700 font-mono">Fast POS Checkout</span>
                <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Scan or Find Medicine</h2>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Scanner Active
              </span>
              <kbd className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 text-xs font-mono font-bold shadow-sm">
                F2 · Search
              </kbd>
            </div>
          </div>

          {/* ── High-Contrast Input Field ── */}
          <div className="relative flex items-center">
            {/* Input Element */}
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyPress}
              placeholder="Scan barcode or type medicine / generic name (Press Enter to add)..."
              className="w-full rounded-xl border-2 border-slate-300 bg-slate-50/50 py-4 pl-5 pr-32 text-lg font-bold text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 placeholder:font-medium focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/20 shadow-inner"
            />

            {/* Right-side Action Badges (Clear & Barcode Icon) */}
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {search.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                  title="Clear search"
                >
                  <X className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
              <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-xs font-mono font-bold">
                <Barcode className="w-4 h-4 text-emerald-600" />
                <span className="hidden sm:inline">Auto-Add</span>
              </div>
            </div>
          </div>

          {/* ── Search Suggestions Dropdown ── */}
          {search.trim() !== '' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-emerald-500/30 rounded-2xl shadow-2xl z-50 overflow-hidden max-h-80 overflow-y-auto divide-y divide-slate-100">
              {filteredSearch.length === 0 ? (
                <div className="p-6 text-center text-slate-500 font-medium text-sm flex flex-col items-center gap-2">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                  <span>No medicines matching <strong className="text-slate-800">"{search}"</strong> found.</span>
                </div>
              ) : (
                filteredSearch.map(m => {
                  const activeBatches = (m.batches || []).filter(b => !b.isExpired);
                  const totalStock = activeBatches.reduce((s, b) => s + b.quantityInStock, 0);
                  const lowestPrice = activeBatches.length > 0 
                    ? activeBatches.sort((a,b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0].sellingPrice 
                    : 0;

                  return (
                    <div 
                      key={m.id} 
                      onClick={() => { addToCart(m); setSearch(''); searchInputRef.current?.focus(); }}
                      className="px-5 py-3.5 hover:bg-emerald-50/80 cursor-pointer flex items-center justify-between transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-sm group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                          <Package className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-base font-extrabold text-slate-900 group-hover:text-emerald-800">{m.name}</p>
                            {m.genericName && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                                {m.genericName}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold text-slate-500 mt-0.5 flex items-center gap-2">
                            <span>Stock: <strong className={totalStock > 10 ? 'text-emerald-600' : 'text-rose-600'}>{totalStock}</strong> {m.unitName || 'Tablet'}s</span>
                            {m.barcode && <span>• Barcode: <span className="font-mono text-slate-700">{m.barcode}</span></span>}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-lg font-black text-emerald-700">
                          Rs {Number(lowestPrice || 0).toFixed(2)}
                        </div>
                        <span className="text-[11px] font-bold text-emerald-600 group-hover:underline">Click to Add +</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* ── Quick Picks Catalog (Frequently Sold Medicines) ── */}
        <div data-pos-intro className="flex-1 rounded-2xl bg-white p-5 border border-slate-200 shadow-md flex flex-col min-h-0 overflow-hidden">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100 text-amber-700">
                <Flame className="w-4 h-4 fill-amber-500 text-amber-500" />
              </span>
              <div>
                <h3 className="font-extrabold text-base text-slate-900 leading-tight">Frequently Sold Items</h3>
                <p className="text-[11px] font-semibold text-slate-500">Fast one-click inventory dispensing (FEFO sorted)</p>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 max-w-full">
              <button
                type="button"
                onClick={() => setSelectedCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-extrabold transition-all ${
                  selectedCategoryFilter === 'all'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              {categories.slice(0, 5).map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryFilter(cat.id)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                    selectedCategoryFilter === cat.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Product Cards Grid */}
          {displayedQuickPicks.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 overflow-y-auto flex-1 custom-scrollbar p-1 min-h-0">
              {displayedQuickPicks.map((med, index) => {
                const activeBatches = (med.batches || []).filter(b => !b.isExpired);
                const stock = activeBatches.reduce((sum, b) => sum + b.quantityInStock, 0);
                activeBatches.sort((a,b) => new Date(a.expiryDate) - new Date(b.expiryDate));
                const price = activeBatches[0]?.sellingPrice || 0;

                return (
                  <button
                    key={med.id}
                    onClick={() => addToCart(med)}
                    className="group relative rounded-xl border-2 border-slate-200 bg-white p-3.5 text-left transition-all duration-200 hover:-translate-y-1 hover:border-emerald-500 hover:shadow-lg flex flex-col justify-between overflow-hidden min-w-0 w-full"
                  >
                    <div className="w-full min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 font-mono text-[10px] font-black text-emerald-800">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          stock > 20 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {stock} in stock
                        </span>
                      </div>

                      <h4 className="font-extrabold text-sm text-slate-900 group-hover:text-emerald-700 truncate block leading-snug w-full" title={med.name}>
                        {med.name}
                      </h4>
                      {med.genericName && (
                        <p className="text-[11px] font-medium text-slate-500 truncate block mt-0.5 w-full" title={med.genericName}>
                          {med.genericName}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-1 w-full min-w-0">
                      <div className="text-sm font-black text-emerald-700 truncate min-w-0 shrink">
                        Rs {Number(price).toFixed(2)}
                      </div>
                      <span className="shrink-0 flex items-center gap-1 text-[11px] font-extrabold text-white bg-emerald-600 group-hover:bg-emerald-700 px-2.5 py-1 rounded-lg shadow-sm">
                        <Plus className="w-3 h-3 stroke-[3]" /> Add
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center flex-col text-slate-400 space-y-3">
              <Package className="w-12 h-12 text-slate-300" />
              <p className="text-sm font-semibold">No active inventory in this category.</p>
            </div>
          )}
        </div>
      </div>

      {/* ──────────────── Right Column: Cart & Checkout Panel ──────────────── */}
      <div 
        ref={checkoutRef} 
        data-pos-intro 
        className="w-full lg:w-[26rem] flex flex-col rounded-2xl bg-white border-2 border-slate-200 shadow-2xl overflow-hidden shrink-0 max-h-[calc(100vh-8.5rem)]"
      >
        {/* ── Cart Header (Pinned Top) ── */}
        <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-3 text-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-md">
              <ShoppingCart className="w-3.5 h-3.5 stroke-[2.5]" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold tracking-tight">Current Sale Cart</h3>
              <p className="text-[10px] font-medium text-slate-300">FEFO Auto-Allocation</p>
            </div>
          </div>
          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-400/30 text-xs px-2.5 py-0.5 rounded-full font-black font-mono">
            {cart.reduce((s, i) => s + i.quantity, 0)} Items
          </span>
        </div>

        {/* ── Scrollable Middle Body (Cart Items + Patient & Payment) ── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 divide-y divide-slate-100">
          {/* Cart Items List */}
          <div ref={cartListRef} className="p-3 space-y-2 bg-slate-50/50">
            {cart.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 space-y-1.5">
                <ShoppingCart className="w-10 h-10 text-slate-300 stroke-[1.5]" />
                <p className="text-xs font-bold text-slate-500">Cart is empty</p>
                <p className="text-[11px] font-medium text-slate-400">Scan barcode or click items to add</p>
              </div>
            ) : (
              cart.map(item => (
                <div 
                  data-cart-item 
                  key={item.medicineId} 
                  className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm hover:border-emerald-400 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 pr-2">
                      <h5 className="text-xs font-extrabold text-slate-900 leading-tight truncate">{item.name}</h5>
                      <p className="text-[10px] font-semibold text-slate-500">Rs {item.priceAtSale.toFixed(2)} / {item.unitName}</p>
                    </div>
                    <p className="text-sm font-black text-emerald-700 shrink-0">
                      Rs {(item.priceAtSale * item.quantity).toFixed(2)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                    {/* Quantity Stepper */}
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-inner overflow-hidden">
                        <button 
                          type="button"
                          onClick={() => {
                            const current = item.entryMode === 'packaging' ? item.quantity / item.unitsPerPackaging : item.quantity;
                            updateQuantity(item.medicineId, Math.max(1, current - 1));
                          }} 
                          className="w-7 h-7 flex items-center justify-center text-slate-800 hover:bg-slate-100 active:bg-slate-200 font-black text-sm transition-colors shrink-0 select-none"
                        >−</button>
                        <input 
                          type="text" 
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={item.entryMode === 'packaging' ? Number((item.quantity / item.unitsPerPackaging).toFixed(2)) : (item.quantity ?? 1)} 
                          onChange={e => {
                            const val = e.target.value;
                            if (val === '' || !isNaN(Number(val))) {
                              updateQuantity(item.medicineId, val);
                            }
                          }}
                          className="w-12 bg-white text-center text-slate-950 text-xs font-black outline-none py-1 border-x border-slate-200 select-all"
                        />
                        <button 
                          type="button"
                          onClick={() => {
                            const current = item.entryMode === 'packaging' ? item.quantity / item.unitsPerPackaging : item.quantity;
                            updateQuantity(item.medicineId, current + 1);
                          }} 
                          className="w-7 h-7 flex items-center justify-center text-slate-800 hover:bg-slate-100 active:bg-slate-200 font-black text-sm transition-colors shrink-0 select-none"
                        >+</button>
                      </div>
                      
                      {item.packagingName ? (
                        <select
                          value={item.entryMode || 'base'}
                          onChange={(e) => updateEntryMode(item.medicineId, e.target.value)}
                          className="bg-white border border-slate-300 rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-slate-700 outline-none hover:border-emerald-500 cursor-pointer shadow-sm"
                        >
                          <option value="base">{item.unitName}s</option>
                          <option value="packaging">{item.packagingName}s</option>
                        </select>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-600">{item.unitName}s</span>
                      )}
                    </div>

                    <button 
                      onClick={() => removeFromCart(item.medicineId)} 
                      className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Error Banner ── */}
          {error && (
            <div className="mx-3 my-2 bg-rose-50 border border-rose-200 rounded-xl p-2 text-rose-700 text-xs font-bold flex items-center gap-1.5 animate-in slide-in-from-bottom-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Pakistan Pharmacy Patient & Payment Controls ── */}
          <div className="p-3 bg-white space-y-2.5">
            {/* Customer / Patient Selection */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-700 flex items-center gap-1">
                  <UserIcon className="w-3 h-3 text-emerald-600" /> Patient / Customer
                </label>
                <button 
                  type="button" 
                  onClick={() => {
                    setPatientModalError('');
                    setNewPatient({ fullName: '', phone: '', cnic: '', address: '' });
                    setShowAddPatientModal(true);
                  }} 
                  className="text-[10px] font-black text-emerald-700 hover:text-emerald-800 flex items-center gap-0.5"
                >
                  <Plus className="w-2.5 h-2.5 stroke-[3]" /> Add Patient
                </button>
              </div>
              
              <div className="flex gap-1">
                <select 
                  value={customerId} 
                  onChange={e => setCustomerId(e.target.value)} 
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:bg-white"
                >
                  <option value="">Walk-in Customer</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}{c.phone ? ` · ${c.phone}` : ''}
                    </option>
                  ))}
                </select>

                {customerId && (
                  <button
                    type="button"
                    onClick={() => setCustomerId('')}
                    title="Reset to Walk-in Customer"
                    className="px-2 rounded-lg border border-slate-200 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 text-xs font-bold transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>

              {customerId && (
                <div className="mt-1 flex items-center justify-between px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-800">
                  <span className="truncate">
                    {customers.find(c => c.id === customerId)?.fullName}
                  </span>
                  <span className="font-mono text-[9px] text-emerald-700">
                    {customers.find(c => c.id === customerId)?.phone || 'No phone'}
                  </span>
                </div>
              )}
            </div>

            {/* Prescription Requirement if Controlled */}
            {needsPrescription && (
              <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 space-y-1">
                <label className="block text-[10px] font-black uppercase tracking-wider text-rose-700 flex items-center gap-1">
                  <FileText className="w-3 h-3 text-rose-600" /> Prescription Required
                </label>
                <select 
                  value={prescriptionId} 
                  onChange={e => setPrescriptionId(e.target.value)} 
                  disabled={!customerId} 
                  className="w-full rounded-md border border-rose-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-800 outline-none disabled:opacity-50"
                >
                  <option value="">{customerId ? 'Select verified prescription' : 'Select patient first'}</option>
                  {prescriptions.filter(p => p.status === 'verified').map(p => (
                    <option key={p.id} value={p.id}>{p.prescriberName} · {p.prescriptionDate}</option>
                  ))}
                </select>
                <button 
                  type="button" 
                  onClick={() => {
                    if (!customerId) {
                      setError('Please select or add a patient before recording a doctor prescription.');
                      return;
                    }
                    setPrescriptionModalError('');
                    setNewPrescription({ 
                      prescriberName: '', 
                      prescriptionDate: new Date().toISOString().split('T')[0], 
                      notes: '' 
                    });
                    setShowAddPrescriptionModal(true);
                  }} 
                  disabled={!customerId} 
                  className="text-[10px] font-extrabold text-rose-700 hover:underline block disabled:opacity-50"
                >
                  + Record & Verify Doctor Prescription
                </button>
              </div>
            )}

            {/* Payment Method Selector */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-700 block mb-1">
                Payment Method
              </label>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { id: 'cash', label: 'Cash', icon: Wallet },
                  { id: 'card', label: 'Card', icon: CreditCard },
                  { id: 'jazzcash', label: 'Jazz', icon: Zap },
                  { id: 'easypaisa', label: 'Easy', icon: Zap },
                  { id: 'bank_transfer', label: 'Bank', icon: FileText }
                ].map(m => {
                  const IconComponent = m.icon;
                  const isSelected = paymentMethod === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id)}
                      className={`flex flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-md text-[10px] font-extrabold transition-all border ${
                        isSelected 
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' 
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      <IconComponent className="w-3 h-3" />
                      <span className="truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Discount & Cash Received */}
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <div>
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-600 block mb-0.5">
                  Discount (Rs)
                </label>
                <input 
                  type="number" 
                  min="0" 
                  max={preDiscountTotal} 
                  value={discountAmount} 
                  onChange={e => setDiscountAmount(e.target.value)} 
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-900 outline-none focus:border-emerald-600" 
                  placeholder="0.00"
                />
              </div>
              {paymentMethod === 'cash' ? (
                <div>
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-600 block mb-0.5">
                    Cash Received (Rs)
                  </label>
                  <input 
                    type="number" 
                    min={finalTotal} 
                    value={cashReceived} 
                    onChange={e => setCashReceived(e.target.value)} 
                    className="w-full rounded-md border-2 border-emerald-500 bg-emerald-50/50 px-2 py-1 text-xs font-black text-emerald-900 outline-none focus:border-emerald-600" 
                    placeholder={finalTotal > 0 ? String(finalTotal) : '0.00'}
                  />
                </div>
              ) : (
                <div className="flex items-end">
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded-md border border-emerald-200 w-full text-center">
                    Digital Settlement
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Summary & Grand Total (Pinned Bottom) ── */}
        <div className="p-3.5 bg-slate-900 text-white border-t border-slate-800 shrink-0 shadow-2xl">
          <div className="space-y-1 mb-2.5 text-xs font-semibold">
            <div className="flex justify-between text-slate-300 text-[11px]">
              <span>Subtotal:</span>
              <span className="font-mono font-bold text-white">Rs {subtotal.toFixed(2)}</span>
            </div>
            {totalTax > 0 && (
              <div className="flex justify-between text-slate-300 text-[11px]">
                <span>GST Tax:</span>
                <span className="font-mono font-bold text-white">Rs {totalTax.toFixed(2)}</span>
              </div>
            )}
            {Number(discountAmount) > 0 && (
              <div className="flex justify-between text-amber-400 text-[11px]">
                <span>Discount:</span>
                <span className="font-mono font-bold">− Rs {Number(discountAmount).toFixed(2)}</span>
              </div>
            )}
            {paymentMethod === 'cash' && cashReceived !== '' && (
              <div className="flex justify-between text-emerald-400 font-bold text-[11px]">
                <span>Change:</span>
                <span className="font-mono">Rs {cashChange.toFixed(2)}</span>
              </div>
            )}
            
            <div className="pt-1.5 border-t border-slate-700 flex justify-between items-baseline">
              <span className="text-xs font-extrabold text-slate-200 uppercase tracking-wider">TOTAL PAYABLE:</span>
              <span ref={totalRef} className="text-xl font-black text-emerald-400 font-mono tracking-tight">
                Rs {finalTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Complete Sale Button */}
          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || isProcessing}
            className="w-full rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 hover:from-emerald-600 hover:to-teal-700 py-3 text-sm font-black text-white shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Processing Checkout...
              </span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                Complete Sale (F9)
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </>
            )}
          </button>
        </div>

      </div>

      {/* ── Low Stock Alert Toasts ── */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
        {lowStockAlerts.map(alert => (
          <div key={alert.id} className="pointer-events-auto">
            <LowStockPopup 
              medicineName={alert.name} 
              quantity={alert.stock} 
              onDismiss={() => setLowStockAlerts(prev => prev.filter(a => a.id !== alert.id))} 
            />
          </div>
        ))}
      </div>

      {/* ── Add Patient / Customer Modal ── */}
      {showAddPatientModal && createPortal(
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget && !patientModalSubmitting) setShowAddPatientModal(false); }}
        >
          <div 
            className="bg-white rounded-2xl border-2 border-slate-200 shadow-2xl w-full max-w-md my-auto overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-50/90">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                  <UserCheck className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">Register New Patient</h3>
                  <p className="text-xs font-semibold text-slate-500">Create profile for medical dispensing & records</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !patientModalSubmitting && setShowAddPatientModal(false)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl p-1.5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSavePatient} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Patient Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newPatient.fullName}
                  onChange={(e) => setNewPatient({ ...newPatient, fullName: e.target.value })}
                  placeholder="e.g. Muhammad Ali / Fatima Zahra"
                  disabled={patientModalSubmitting}
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" /> Mobile / Phone
                  </label>
                  <input
                    type="text"
                    value={newPatient.phone}
                    onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                    placeholder="0300-1234567"
                    disabled={patientModalSubmitting}
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <IdCard className="w-3 h-3 text-slate-400" /> CNIC / ID
                  </label>
                  <input
                    type="text"
                    value={newPatient.cnic}
                    onChange={(e) => setNewPatient({ ...newPatient, cnic: e.target.value })}
                    placeholder="42101-1234567-1"
                    disabled={patientModalSubmitting}
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" /> Address / Area
                </label>
                <input
                  type="text"
                  value={newPatient.address}
                  onChange={(e) => setNewPatient({ ...newPatient, address: e.target.value })}
                  placeholder="e.g. Block 4, Clifton, Karachi"
                  disabled={patientModalSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              {patientModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold">
                  {patientModalError}
                </div>
              )}

              <div className="flex gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddPatientModal(false)}
                  disabled={patientModalSubmitting}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-2.5 rounded-xl text-xs transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={patientModalSubmitting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-xs transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {patientModalSubmitting ? 'Saving...' : 'Save & Select Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Add Prescription Modal ── */}
      {showAddPrescriptionModal && createPortal(
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget && !prescriptionModalSubmitting) setShowAddPrescriptionModal(false); }}
        >
          <div 
            className="bg-white rounded-2xl border-2 border-slate-200 shadow-2xl w-full max-w-md my-auto overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-200 bg-rose-50/90">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
                  <FileText className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">Record Doctor Prescription</h3>
                  <p className="text-xs font-semibold text-rose-800">
                    Patient: {customers.find(c => c.id === customerId)?.fullName || 'Selected Patient'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !prescriptionModalSubmitting && setShowAddPrescriptionModal(false)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl p-1.5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSavePrescription} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Prescribing Doctor / Consultant <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newPrescription.prescriberName}
                  onChange={(e) => setNewPrescription({ ...newPrescription, prescriberName: e.target.value })}
                  placeholder="e.g. Dr. Asim Farooq (FCPS)"
                  disabled={prescriptionModalSubmitting}
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-300 focus:border-rose-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Prescription Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={newPrescription.prescriptionDate}
                  onChange={(e) => setNewPrescription({ ...newPrescription, prescriptionDate: e.target.value })}
                  disabled={prescriptionModalSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-rose-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Clinical Notes / Hospital
                </label>
                <input
                  type="text"
                  value={newPrescription.notes}
                  onChange={(e) => setNewPrescription({ ...newPrescription, notes: e.target.value })}
                  placeholder="e.g. Aga Khan University Hospital"
                  disabled={prescriptionModalSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-rose-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              {prescriptionModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold">
                  {prescriptionModalError}
                </div>
              )}

              <div className="flex gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddPrescriptionModal(false)}
                  disabled={prescriptionModalSubmitting}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-2.5 rounded-xl text-xs transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={prescriptionModalSubmitting}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-black py-2.5 rounded-xl text-xs transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {prescriptionModalSubmitting ? 'Saving...' : 'Save & Verify Prescription'}
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
