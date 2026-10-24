import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, Upload, Plus, Edit2, Trash2, ChevronDown, ChevronRight, X, Package, Layers, Archive, AlertTriangle } from 'lucide-react';
import ExportImportButton from './ExportImportButton.jsx';
import ExportImportModal from './ExportImportModal.jsx';
import BatchStamp from './BatchStamp.jsx';
import DataTable from './DataTable.jsx';
import { isValidBarcode, isPositiveNumber, isStrictlyPositiveNumber } from '../utils/validation.js';

// ─── Validation Helpers ────────────────────────────────────────────────────────

// H2, H3, H5: Updated validation
function validateMedicineForm({ name, barcode, unitsPerPackaging, packagingPerBox, packagingName }, existingMedicines = [], editingId = null) {
  const errs = {};
  if (!name || name.trim() === '') {
    errs.name = 'Medicine name is required.';
  } else {
    // H5: Warn on duplicate name (case-insensitive, excluding current record on edit)
    const isDuplicate = existingMedicines.some(
      m => m.name.toLowerCase() === name.trim().toLowerCase() && m.id !== editingId
    );
    if (isDuplicate) errs.name = 'A medicine with this name already exists. Duplicates can cause confusion at the POS.';
  }
  if (barcode && !isValidBarcode(barcode)) errs.barcode = 'Barcode can only contain letters, numbers, and dashes.';

  // H2: If packagingName is provided, unitsPerPackaging is required and must be >= 1
  if (packagingName && packagingName.trim() !== '') {
    if (unitsPerPackaging === undefined || unitsPerPackaging === '' || unitsPerPackaging === null) {
      errs.unitsPerPackaging = 'Required when a packaging unit is set (must be ≥ 1).';
    } else if (!isStrictlyPositiveNumber(unitsPerPackaging) || !Number.isInteger(Number(unitsPerPackaging))) {
      errs.unitsPerPackaging = 'Must be a positive whole number (at least 1).';
    }
  } else if (unitsPerPackaging !== undefined && unitsPerPackaging !== '' && unitsPerPackaging !== null) {
    if (!isStrictlyPositiveNumber(unitsPerPackaging) || !Number.isInteger(Number(unitsPerPackaging))) {
      errs.unitsPerPackaging = 'Must be a positive whole number.';
    }
  }

  if (packagingPerBox !== undefined && packagingPerBox !== '' && packagingPerBox !== null &&
      (!isStrictlyPositiveNumber(packagingPerBox) || !Number.isInteger(Number(packagingPerBox)))) {
    errs.packagingPerBox = 'Must be a positive whole number.';
  }
  return errs;
}

// H3, H4: Updated batch validation
function validateBatchForm({ batchNumber, expiryDate, datePurchased, costPerUnit, sellingPrice, quantityInStock }, isNewBatch = true) {
  const errs = {};
  if (!datePurchased) {
    errs.datePurchased = 'Date purchased is required.';
  } else if (new Date(datePurchased) > new Date(new Date().setHours(23, 59, 59, 999))) {
    // H4 bonus: datePurchased cannot be in the future
    errs.datePurchased = 'Date purchased cannot be in the future.';
  }
  if (!batchNumber || batchNumber.trim() === '') errs.batchNumber = 'Batch number is required.';
  if (!expiryDate) {
    errs.expiryDate = 'Expiry date is required.';
  } else if (isNewBatch && new Date(expiryDate) < new Date(new Date().setHours(0, 0, 0, 0))) {
    // H4: Only enforce future-date rule on NEW batches, not edits
    errs.expiryDate = 'Expiry date cannot be in the past for a new batch.';
  }
  // H3: Prices must be strictly > 0
  if (!isStrictlyPositiveNumber(costPerUnit)) errs.costPerUnit = 'Must be a valid positive number (greater than 0).';
  if (!isStrictlyPositiveNumber(sellingPrice)) errs.sellingPrice = 'Must be a valid positive number (greater than 0).';
  // Quantity must also be > 0 (adding a batch of 0 units is meaningless)
  if (!isStrictlyPositiveNumber(quantityInStock) || !Number.isInteger(Number(quantityInStock))) {
    errs.quantityInStock = 'Must be a valid positive whole number.';
  }
  return errs;
}

// ─── Controlled number input — blocks non-numeric characters ────────────────

function NumberInput({ value, onChange, placeholder, min, step, className, id, disabled }) {
  const handleKeyDown = (e) => {
    // Allow: backspace, delete, tab, escape, enter, arrows, home, end
    const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
    if (allowed.includes(e.key)) return;
    // Allow Ctrl/Cmd + A/C/V/X/Z
    if ((e.ctrlKey || e.metaKey) && ['a','c','v','x','z'].includes(e.key.toLowerCase())) return;
    // Allow decimal point only if step is not 1
    if (e.key === '.' && step && step !== 1 && step !== '1') return;
    // Allow minus only if min < 0
    if (e.key === '-' && min !== undefined && Number(min) < 0) return;
    // Block anything else that is not a digit
    if (!/^\d$/.test(e.key)) e.preventDefault();
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text');
    const pattern = step && step !== 1 && step !== '1' ? /^-?\d*\.?\d*$/ : /^-?\d+$/;
    if (!pattern.test(pasted.trim())) e.preventDefault();
  };

  return (
    <input
      id={id}
      type="number"
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      min={min ?? 0}
      step={step ?? 1}
      disabled={disabled}
      className={className}
      autoComplete="off"
    />
  );
}

// ─── Text input with trim enforcement ────────────────────────────────────────

function TextInput({ value, onChange, placeholder, className, id, disabled, maxLength, pattern }) {
  const handleChange = (e) => {
    let val = e.target.value;
    // If pattern provided, block chars that don't match pattern per character
    if (pattern) {
      const re = new RegExp(pattern);
      if (!re.test(val) && val !== '') return;
    }
    onChange(val);
  };
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      className={className}
      autoComplete="off"
    />
  );
}

// ─── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ title, subtitle, onClose, children }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const modalNode = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-white rounded-2xl border-2 border-slate-200 shadow-2xl w-full max-w-lg mx-auto my-auto overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-50/90">
          <div>
            <h3 className="text-base font-black text-slate-900 tracking-tight">{title}</h3>
            {subtitle && <p className="text-xs font-semibold text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl p-1.5 transition-colors ml-4"
          >
            <X size={18} />
          </button>
        </div>
        {/* Body */}
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
}

// ─── Field component ──────────────────────────────────────────────────────────

function Field({ label, error, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {error && <p className="text-rose-600 text-xs font-bold mt-1">{error}</p>}
    </div>
  );
}

const inputCls = (hasError) =>
  `w-full bg-slate-50 border ${hasError ? 'border-rose-400 focus:border-rose-600 focus:bg-white' : 'border-slate-300 focus:border-emerald-600 focus:bg-white'} rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all duration-150`;

// ─── Medicine Modal ───────────────────────────────────────────────────────────

function MedicineModal({ mode, initial, categories, medicines, editingId, onSave, onClose, isSubmitting }) {
  const [name, setName] = useState(initial?.name || '');
  const [genericName, setGenericName] = useState(initial?.genericName || '');
  const [barcode, setBarcode] = useState(initial?.barcode || '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId || '');
  const [unitName, setUnitName] = useState(initial?.unitName || 'Tablet');
  const [packagingName, setPackagingName] = useState(initial?.packagingName || '');
  const [unitsPerPackaging, setUnitsPerPackaging] = useState(initial?.unitsPerPackaging || '1');
  const [packagingPerBox, setPackagingPerBox] = useState(initial?.packagingPerBox || '');
  const [prescriptionRequired, setPrescriptionRequired] = useState(Boolean(initial?.prescriptionRequired));
  const [controlledSchedule, setControlledSchedule] = useState(initial?.controlledSchedule || '');
  const [reorderLevel, setReorderLevel] = useState(initial?.reorderLevel ?? 10);
  const [errors, setErrors] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = validateMedicineForm(
      { name, barcode, unitsPerPackaging, packagingPerBox, packagingName },
      medicines,      // H5: pass medicines list for duplicate check
      editingId       // H5: pass the ID being edited (null on add)
    );
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    
    const uPP = packagingName ? parseInt(unitsPerPackaging, 10) : 1;
    const pPB = packagingName && packagingPerBox ? parseInt(packagingPerBox, 10) : null;
    
    onSave({ 
      name: name.trim(), 
      genericName: genericName.trim(), 
      barcode: barcode.trim(), 
      categoryId,
      unitName: unitName.trim() || 'Tablet',
      packagingName: packagingName.trim() || null,
      unitsPerPackaging: uPP,
      packagingPerBox: pPB,
      prescriptionRequired,
      controlledSchedule: controlledSchedule || null,
      reorderLevel: Math.max(0, Number(reorderLevel) || 0)
    });
  };

  return (
    <Modal
      title={mode === 'add' ? '➕ New Medicine' : '✏️ Edit Medicine'}
      subtitle={mode === 'add' ? 'Add a new drug product to your inventory.' : 'Update the product details below.'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Medicine Name *" error={errors.name}>
          <TextInput
            id="med-name"
            value={name}
            onChange={setName}
            placeholder="e.g. Paracetamol 500mg"
            className={inputCls(!!errors.name)}
            disabled={isSubmitting}
            maxLength={120}
          />
        </Field>

        <Field label="Generic Name" error={errors.genericName}>
          <TextInput
            id="med-generic"
            value={genericName}
            onChange={setGenericName}
            placeholder="e.g. Acetaminophen"
            className={inputCls(false)}
            disabled={isSubmitting}
            maxLength={120}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Barcode" error={errors.barcode}>
            <TextInput
              id="med-barcode"
              value={barcode}
              onChange={(v) => {
                // Barcode: only alphanumeric + dash/underscore
                if (/^[a-zA-Z0-9\-_]*$/.test(v) || v === '') setBarcode(v);
              }}
              placeholder="e.g. 012345"
              className={inputCls(false)}
              disabled={isSubmitting}
              maxLength={50}
            />
          </Field>

          <Field label="Category" error={errors.categoryId}>
            <select
              id="med-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={isSubmitting}
              className={`${inputCls(false)} appearance-none`}
            >
              <option value="">— None —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Base Unit *" error={errors.unitName}>
            <TextInput
              id="med-unit"
              value={unitName}
              onChange={setUnitName}
              placeholder="e.g. Tablet, ml, gm"
              className={inputCls(!!errors.unitName)}
              disabled={isSubmitting}
              maxLength={20}
            />
          </Field>

          <Field label="Packaging Unit (Optional)" error={errors.packagingName}>
            <TextInput
              id="med-packaging"
              value={packagingName}
              onChange={setPackagingName}
              placeholder="e.g. Strip, Bottle"
              className={inputCls(!!errors.packagingName)}
              disabled={isSubmitting}
              maxLength={20}
            />
          </Field>
        </div>

        {packagingName && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-clinical border border-ink/10 rounded-lg">
            <Field label={`${unitName}s per ${packagingName} *`} error={errors.unitsPerPackaging}>
              <NumberInput
                id="med-units-per-pkg"
                value={unitsPerPackaging}
                onChange={(e) => setUnitsPerPackaging(e.target.value)}
                min={1}
                step={1}
                className={inputCls(!!errors.unitsPerPackaging)}
                disabled={isSubmitting}
              />
            </Field>

            <Field label={`${packagingName}s per Box (Optional)`} error={errors.packagingPerBox}>
              <NumberInput
                id="med-pkg-per-box"
                value={packagingPerBox}
                onChange={(e) => setPackagingPerBox(e.target.value)}
                min={1}
                step={1}
                className={inputCls(!!errors.packagingPerBox)}
                disabled={isSubmitting}
              />
            </Field>
          </div>
        )}

        <div className="rounded-lg border border-amber/30 bg-amber/5 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Pharmacy controls</p>
              <p className="text-[11px] text-ink/60">Require a verified prescription before dispensing regulated medicine.</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-ink whitespace-nowrap">
              <input type="checkbox" checked={prescriptionRequired} onChange={e => setPrescriptionRequired(e.target.checked)} disabled={isSubmitting} className="accent-emerald" />
              Prescription required
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Controlled schedule (if applicable)">
              <select value={controlledSchedule} onChange={e => setControlledSchedule(e.target.value)} disabled={isSubmitting} className={`${inputCls(false)} appearance-none`}>
                <option value="">Not controlled</option>
                <option value="B">Schedule B</option>
                <option value="D">Schedule D</option>
                <option value="other">Other / review required</option>
              </select>
            </Field>
            <Field label="Reorder level">
              <NumberInput value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} min={0} step={1} className={inputCls(false)} disabled={isSubmitting} />
            </Field>
          </div>
        </div>

        <div className="flex gap-3 pt-3 border-t border-slate-200">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-3 rounded-xl text-xs shadow-md transition-all"
          >
            {isSubmitting ? 'Saving…' : mode === 'add' ? 'Create Medicine' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-3 rounded-xl text-xs transition-all"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Batch Modal ─────────────────────────────────────────────────────────────

function BatchModal({ mode, medicine, initial, suppliers, onSave, onClose, isSubmitting }) {
  const [batchNumber, setBatchNumber] = useState(initial?.batchNumber || '');
  const [expiryDate, setExpiryDate] = useState(
    initial?.expiryDate ? initial.expiryDate.split('T')[0] : ''
  );
  
  // Today's date string for min expiry validation & default purchase date
  const today = new Date().toISOString().split('T')[0];
  
  const [datePurchased, setDatePurchased] = useState(
    initial?.datePurchased ? initial.datePurchased.split('T')[0] : (initial?.dateAdded ? initial.dateAdded.split('T')[0] : today)
  );
  
  const [costPerUnit, setCostPerUnit] = useState(initial?.costPerUnit ?? '');
  const [sellingPrice, setSellingPrice] = useState(initial?.sellingPrice ?? '');
  
  const hasPackaging = !!medicine.packagingName;
  const [entryUnit, setEntryUnit] = useState('base');
  const [entryQuantity, setEntryQuantity] = useState(initial?.quantityInStock ?? '');
  
  const actualQuantity = entryQuantity !== '' && !isNaN(entryQuantity)
    ? entryUnit === 'packaging'
      ? parseInt(entryQuantity, 10) * (medicine.unitsPerPackaging || 1)
      : parseInt(entryQuantity, 10)
    : '';
    
  const [supplierId, setSupplierId] = useState(initial?.supplierId || '');
  const [errors, setErrors] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = validateBatchForm(
      { batchNumber, expiryDate, datePurchased, costPerUnit, sellingPrice, quantityInStock: actualQuantity },
      mode === 'add'  // H4: isNewBatch — only enforce future expiry on new batches
    );
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    onSave({
      batchNumber: batchNumber.trim(),
      expiryDate,
      datePurchased,
      costPerUnit: parseFloat(costPerUnit),
      sellingPrice: parseFloat(sellingPrice),
      quantityInStock: actualQuantity,
      supplierId,
    });
  };

  return (
    <Modal
      title={mode === 'add' ? '📦 Add Batch' : '✏️ Edit Batch'}
      subtitle={`Medicine: ${medicine.name}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Batch Number *" error={errors.batchNumber}>
            <TextInput
              id="batch-number"
              value={batchNumber}
              onChange={(v) => {
                // Allow alphanumeric + dash/slash/dot only
                if (/^[a-zA-Z0-9\-\/\.]*$/.test(v) || v === '') setBatchNumber(v);
              }}
              placeholder="e.g. BT-2024-01"
              className={inputCls(!!errors.batchNumber)}
              disabled={isSubmitting}
              maxLength={40}
            />
          </Field>

          <Field label="Expiry Date *" error={errors.expiryDate}>
            <input
              id="batch-expiry"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              min={today}
              disabled={isSubmitting}
              className={inputCls(!!errors.expiryDate)}
            />
          </Field>
          
          <Field label="Date Purchased *" error={errors.datePurchased}>
            <input
              id="batch-purchased"
              type="date"
              value={datePurchased}
              onChange={(e) => setDatePurchased(e.target.value)}
              max={today}
              disabled={isSubmitting}
              className={inputCls(!!errors.datePurchased)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost Price (Rs) *" error={errors.costPerUnit}>
            <NumberInput
              id="batch-cost"
              value={costPerUnit}
              onChange={(e) => setCostPerUnit(e.target.value)}
              placeholder="0.00"
              min={0}
              step={0.01}
              disabled={isSubmitting}
              className={inputCls(!!errors.costPerUnit)}
            />
          </Field>

          <Field label="Selling Price (Rs) *" error={errors.sellingPrice}>
            <NumberInput
              id="batch-sell"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
              placeholder="0.00"
              min={0.01}
              step={0.01}
              disabled={isSubmitting}
              className={inputCls(!!errors.sellingPrice)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Field label="Quantity *" error={errors.quantityInStock}>
              <div className="flex bg-clinical rounded-lg border border-ink/20 focus-within:border-emerald overflow-hidden">
                <NumberInput
                  id="batch-qty"
                  value={entryQuantity}
                  onChange={(e) => setEntryQuantity(e.target.value)}
                  placeholder="0"
                  min={0}
                  step={1}
                  disabled={isSubmitting}
                  className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
                />
                {hasPackaging && (
                  <select
                    value={entryUnit}
                    onChange={(e) => setEntryUnit(e.target.value)}
                    className="bg-clinical border-l border-ink/20 px-2 text-sm text-ink/80 outline-none hover:bg-ink/5 cursor-pointer"
                  >
                    <option value="base">{medicine.unitName || 'Tablet'}s</option>
                    <option value="packaging">{medicine.packagingName}s</option>
                  </select>
                )}
              </div>
            </Field>
            {hasPackaging && entryUnit === 'packaging' && entryQuantity !== '' && (
              <p className="text-xs text-emerald/90 mt-1 font-medium">
                = {actualQuantity} {medicine.unitName || 'Tablet'}s
              </p>
            )}
          </div>

          <Field label="Supplier" error={errors.supplierId}>
            <select
              id="batch-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={isSubmitting}
              className={`${inputCls(false)} appearance-none`}
            >
              <option value="">— None —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="flex gap-3 pt-3 border-t border-slate-200">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-3 rounded-xl text-xs shadow-md transition-all"
          >
            {isSubmitting ? 'Saving…' : mode === 'add' ? 'Add Batch' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-3 rounded-xl text-xs transition-all"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MedicinesScreen({ user }) {
  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [expandedMeds, setExpandedMeds] = useState(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal state
  const [medModal, setMedModal]   = useState(null); // null | { mode: 'add'|'edit', medicine?: obj }
  const [batchModal, setBatchModal] = useState(null); // null | { mode: 'add'|'edit', medicineId, medicineName, batch?: obj }

  // Export / Import
  const [exportModal, setExportModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [ioLoading, setIoLoading]   = useState(false);
  const [ioError, setIoError]       = useState('');
  const [exportSuccess, setExportSuccess] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  const isAdmin = user.role === 'admin';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [medsData, supsData, catsData] = await Promise.all([
        window.pharmacoreAPI.getMedicines({ includeArchived: showArchived }),
        window.pharmacoreAPI.getSuppliers(),
        window.pharmacoreAPI.getCategories(),
      ]);
      setMedicines(medsData);
      setSuppliers(supsData);
      setCategories(catsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [showArchived]);

  const toggleExpand = (medId) => {
    setExpandedMeds(prev => {
      const next = new Set(prev);
      next.has(medId) ? next.delete(medId) : next.add(medId);
      return next;
    });
  };

  // ── Medicine CRUD ──────────────────────────────────────────────────────────

  const handleSaveMedicine = async (payload) => {
    setIsSubmitting(true);
    try {
      if (medModal.mode === 'edit') {
        await window.pharmacoreAPI.updateMedicine(medModal.medicine.id, payload);
      } else {
        await window.pharmacoreAPI.addMedicine(payload);
      }
      setMedModal(null);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error saving medicine.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteMedicine = async (id) => {
    if (!window.confirm('Archive this medicine? It will be hidden from inventory and POS, but historical sales data will remain intact.')) return;
    try {
      await window.pharmacoreAPI.deleteMedicine(id);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to archive medicine.');
    }
  };

  // ── Batch CRUD ─────────────────────────────────────────────────────────────

  const handleSaveBatch = async (payload) => {
    setIsSubmitting(true);
    try {
      if (batchModal.mode === 'edit') {
        await window.pharmacoreAPI.updateBatch(batchModal.batch.id, payload);
      } else {
        await window.pharmacoreAPI.addBatch({ ...payload, medicineId: batchModal.medicine.id });
        // Auto-expand the medicine so the user sees the new batch
        setExpandedMeds(prev => new Set(prev).add(batchModal.medicine.id));
      }
      setBatchModal(null);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error saving batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBatch = async (id) => {
    if (!window.confirm('Delete this batch? This cannot be undone.')) return;
    try {
      await window.pharmacoreAPI.deleteBatch(id);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to delete batch.');
    }
  };

  // ── Export / Import ────────────────────────────────────────────────────────

  const handleExport = async (password) => {
    setIoLoading(true); setIoError('');
    try {
      const result = await window.pharmacoreAPI.exportInventory(password);
      if (!result.success) { setIoError(result.error || 'Export failed.'); return; }
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
    setIoLoading(true); setIoError('');
    try {
      const result = await window.pharmacoreAPI.importInventory(password);
      if (!result.success) { setIoError(result.error || 'Import failed.'); return; }
      const importedCount = Array.isArray(result.records) ? result.records.length : (result.records.medicines?.length || 0);
      const confirmMsg = medicines.length > 0
        ? `Warning: This will permanently OVERWRITE all existing inventory (${medicines.length} medicines). Continue?`
        : `This will import ${importedCount} medicines. Continue?`;
      if (!window.confirm(confirmMsg)) { setImportModal(false); setIoLoading(false); return; }
      const applyResult = await window.pharmacoreAPI.applyInventoryImport(result.records);
      if (!applyResult.success) { setIoError('Failed to apply import.'); return; }
      setImportModal(false);
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 2500);
      fetchData();
    } catch (err) {
      setIoError(err.message || 'Import failed.');
    } finally {
      setIoLoading(false);
    }
  };

  const [selectedStockFilter, setSelectedStockFilter] = useState('all');

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredMedicines = (medicines || []).filter(m => {
    if (!m) return false;
    // Category filter
    if (selectedCategory && selectedCategory !== 'all' && m.categoryId !== selectedCategory) {
      return false;
    }
    // Stock status filter
    const totalStock = (m.batches || []).filter(b => !b.isExpired).reduce((sum, b) => sum + (b.quantityInStock || 0), 0);
    if (selectedStockFilter === 'in_stock' && totalStock <= 0) return false;
    if (selectedStockFilter === 'low_stock' && (totalStock <= 0 || totalStock > (m.reorderLevel || 10))) return false;
    if (selectedStockFilter === 'out_of_stock' && totalStock > 0) return false;
    if (selectedStockFilter === 'rx_required' && !m.prescriptionRequired) return false;
    return true;
  });

  const columns = [
    {
      header: 'Product Name',
      accessor: 'name',
      sortable: true,
      cell: (m) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-black text-slate-900 text-sm leading-tight">{m.name}</span>
            {!m.isActive && (
              <span className="bg-slate-200 text-slate-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded">
                Archived
              </span>
            )}
            {m.prescriptionRequired && (
              <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded">
                Rx
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-slate-400">Barcode: {m.barcode || '—'}</span>
        </div>
      )
    },
    {
      header: 'Generic Name',
      accessor: 'genericName',
      sortable: true,
      cell: (m) => <span className="text-slate-600 font-semibold text-xs">{m.genericName || '—'}</span>
    },
    {
      header: 'Category',
      accessor: (m) => categories.find(c => c.id === m.categoryId)?.name || 'Uncategorized',
      sortable: true,
      sortKey: 'categoryId',
      cell: (m) => (
        <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 font-bold text-xs">
          {categories.find(c => c.id === m.categoryId)?.name || 'Uncategorized'}
        </span>
      )
    },
    {
      header: 'Total Stock',
      accessor: (m) => (m.batches || []).filter(b => !b.isExpired).reduce((sum, b) => sum + (b.quantityInStock || 0), 0),
      sortable: true,
      align: 'right',
      cell: (m) => {
        const totalStock = (m.batches || []).filter(b => !b.isExpired).reduce((sum, b) => sum + (b.quantityInStock || 0), 0);
        return (
          <span className={`font-mono font-black text-sm ${totalStock > 10 ? 'text-emerald-700' : totalStock > 0 ? 'text-amber-600' : 'text-rose-600'}`}>
            {totalStock} {m.unitName || 'Units'}
          </span>
        );
      }
    },
    {
      header: 'Status',
      align: 'center',
      cell: (m) => {
        const totalStock = (m.batches || []).filter(b => !b.isExpired).reduce((sum, b) => sum + (b.quantityInStock || 0), 0);
        if (totalStock <= 0) return <BatchStamp variant="critical" text="OUT OF STOCK" />;
        if (totalStock <= (m.reorderLevel || 10)) return <BatchStamp variant="warning" text="LOW STOCK" />;
        return <BatchStamp variant="positive" text="IN STOCK" />;
      }
    },
    {
      header: 'Batches',
      accessor: (m) => (m.batches || []).length,
      sortable: true,
      align: 'center',
      cell: (m) => (
        <span className="inline-flex items-center gap-1 text-slate-700 text-xs font-mono font-black px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
          <Layers className="w-3 h-3 text-slate-400" />
          {(m.batches || []).length}
        </span>
      )
    },
    ...(isAdmin ? [{
      header: 'Actions',
      align: 'right',
      cell: (m) => (
        <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setBatchModal({ mode: 'add', medicine: m })}
            title="Add Batch"
            className="inline-flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold px-2.5 py-1 rounded-lg text-xs transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Batch
          </button>
          <button
            onClick={() => setMedModal({ mode: 'edit', medicine: m })}
            title="Edit Medicine"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleDeleteMedicine(m.id)}
            title={m.isActive ? "Archive Medicine" : "Medicine is archived"}
            disabled={!m.isActive}
            className={`p-1.5 rounded-lg transition-colors ${m.isActive ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-50' : 'text-slate-300 cursor-not-allowed'}`}
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    }] : [])
  ];

  const renderBatchSubTable = (m) => (
    <div className="p-3 space-y-2.5 bg-slate-50 rounded-xl border border-slate-200">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <Package className="w-4 h-4 text-emerald-600" />
          Active Batches & FEFO Expiry Tracking: <strong className="text-emerald-800">{m.name}</strong>
        </h5>
        {isAdmin && (
          <button
            onClick={() => setBatchModal({ mode: 'add', medicine: m })}
            className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add New Batch
          </button>
        )}
      </div>

      {m.batches && m.batches.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold uppercase text-[10px]">
              <tr>
                <th className="px-3 py-2">Batch #</th>
                <th className="px-3 py-2">Expiry Date</th>
                <th className="px-3 py-2">Supplier</th>
                {isAdmin && <th className="px-3 py-2 text-right">Cost (PKR)</th>}
                <th className="px-3 py-2 text-right">Sell Price (PKR)</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-center">Status</th>
                {isAdmin && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {m.batches.map(batch => (
                <tr key={batch.id} className={batch.isExpired ? 'bg-rose-50/50' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2 font-mono font-bold text-slate-900">{batch.batchNumber}</td>
                  <td className="px-3 py-2 font-mono text-slate-700">{batch.expiryDate ? batch.expiryDate.split('T')[0] : '—'}</td>
                  <td className="px-3 py-2 text-slate-600 truncate max-w-[140px]">
                    {batch.supplierId ? (suppliers.find(s => s.id === batch.supplierId)?.name || '—') : '—'}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2 text-right font-mono text-slate-600">
                      Rs {Number(batch.costPerUnit || 0).toFixed(2)}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-mono font-black text-emerald-700">
                    Rs {Number(batch.sellingPrice || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{batch.quantityInStock}</td>
                  <td className="px-3 py-2 text-center">
                    {batch.isExpired ? (
                      <BatchStamp variant="critical" text="EXPIRED" />
                    ) : batch.quantityInStock <= 0 ? (
                      <BatchStamp variant="critical" text="OUT OF STOCK" />
                    ) : batch.quantityInStock <= 10 ? (
                      <BatchStamp variant="warning" text="LOW STOCK" />
                    ) : (
                      <BatchStamp variant="positive" text="IN STOCK" />
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setBatchModal({ mode: 'edit', medicine: m, batch })}
                          className="p-1 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                          title="Edit Batch"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteBatch(batch.id)}
                          className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                          title="Delete Batch"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-4 text-center text-slate-400 text-xs font-semibold">
          No batches registered for this medicine yet.
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Medicines & Inventory</h3>
          <p className="text-xs font-semibold text-slate-500">
            Search, sort, filter categories, manage stock batches, and update dispensing prices.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                  showArchived 
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm' 
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Archive size={14} />
                {showArchived ? 'Hide Archived' : 'Show Archived'}
              </button>
              <button
                onClick={() => setMedModal({ mode: 'add' })}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-black text-xs shadow-md transition-all"
              >
                <Plus size={16} />
                <span>Add Medicine</span>
              </button>
            </div>
          )}
          {isAdmin && (
            <>
              <ExportImportButton variant="export" label="Export" icon={<Download size={15} />}
                onClick={() => { setIoError(''); setExportModal(true); }} success={exportSuccess} />
              <ExportImportButton variant="import" label="Import" icon={<Upload size={15} />}
                onClick={() => { setIoError(''); setImportModal(true); }} success={importSuccess} />
            </>
          )}
        </div>
      </div>

      {/* ── Functional DataTable with Category & Stock Filter Controls ── */}
      <DataTable
        columns={columns}
        data={filteredMedicines}
        searchKeys={['name', 'genericName', 'barcode']}
        searchPlaceholder="Search by medicine name, generic name, barcode..."
        exportFileName="medicines-inventory"
        loading={loading}
        emptyMessage="No medicines match your search criteria."
        expandableRow={renderBatchSubTable}
        filters={(
          <div className="flex items-center gap-2 flex-wrap">
            {/* Category Dropdown */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
            >
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {/* Stock Status Dropdown */}
            <select
              value={selectedStockFilter}
              onChange={(e) => setSelectedStockFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-800 outline-none focus:border-emerald-600 shadow-sm"
            >
              <option value="all">All Stock Status</option>
              <option value="in_stock">In Stock (&gt; 0)</option>
              <option value="low_stock">Low Stock (≤ 10)</option>
              <option value="out_of_stock">Out of Stock (0)</option>
              <option value="rx_required">Prescription Required (Rx)</option>
            </select>
          </div>
        )}
      />

      {/* ── Modals ── */}
      {medModal && (
              <MedicineModal
          mode={medModal.mode}
          initial={medModal.medicine}
          categories={categories}
          medicines={medicines}
          editingId={medModal.medicine?.id ?? null}
          onSave={handleSaveMedicine}
          onClose={() => !isSubmitting && setMedModal(null)}
          isSubmitting={isSubmitting}
        />
      )}

      {batchModal && (
        <BatchModal
          mode={batchModal.mode}
          medicine={batchModal.medicine}
          initial={batchModal.batch}
          suppliers={suppliers}
          onSave={handleSaveBatch}
          onClose={() => !isSubmitting && setBatchModal(null)}
          isSubmitting={isSubmitting}
        />
      )}

      {exportModal && (
        <ExportImportModal mode="export" onConfirm={handleExport}
          onCancel={() => setExportModal(false)} isLoading={ioLoading} error={ioError} />
      )}
      {importModal && (
        <ExportImportModal mode="import" onConfirm={handleImport}
          onCancel={() => setImportModal(false)} isLoading={ioLoading} error={ioError} />
      )}
    </div>
  );
}
