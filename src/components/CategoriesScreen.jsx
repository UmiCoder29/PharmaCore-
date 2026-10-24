import React, { useState, useEffect } from 'react';
import { Tag, Percent, Edit2, Trash2, Plus, Shield, RefreshCw } from 'lucide-react';
import DataTable from './DataTable.jsx';

export default function CategoriesScreen({ user }) {
  const [categories, setCategories] = useState([]);
  const [defaultTaxRate, setDefaultTaxRateState] = useState(0);
  const [loading, setLoading] = useState(true);
  
  // Form state
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [taxRate, setTaxRate] = useState(0); // percentage, e.g. 17
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDefaultTax, setIsSavingDefaultTax] = useState(false);

  const isAdmin = user.role === 'admin';

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await window.pharmacoreAPI.getCategories();
      setCategories(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDefaultTaxRate = async () => {
    try {
      const rate = await window.pharmacoreAPI.getDefaultTaxRate();
      setDefaultTaxRateState(rate);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchDefaultTaxRate();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setTaxRate(0);
    setError('');
  };

  const handleEdit = (category) => {
    setEditingId(category.id);
    setName(category.name);
    setDescription(category.description || '');
    setTaxRate(category.taxRate ?? 0);
    setError('');
  };

  const handleSaveDefaultTaxRate = async () => {
    if (!isAdmin) return;
    if (defaultTaxRate < 0 || defaultTaxRate > 100) {
      alert('Default tax rate must be between 0 and 100%.');
      return;
    }
    setIsSavingDefaultTax(true);
    try {
      await window.pharmacoreAPI.setDefaultTaxRate(defaultTaxRate);
    } catch (err) {
      alert(err.message || 'Failed to save default tax rate');
    } finally {
      setIsSavingDefaultTax(false);
    }
  };

  const handleDelete = async (id) => {
    if (!isAdmin || !window.confirm('Are you sure you want to delete this category? (Medicines in this category will become Uncategorized)')) return;
    try {
      await window.pharmacoreAPI.deleteCategory(id);
      fetchCategories();
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanName = name.trim();
    if (!cleanName) {
      setError('Category name is required.');
      return;
    }

    if (cleanName.length < 2) {
      setError('Category name must be at least 2 characters long.');
      return;
    }

    const parsedTaxRate = parseFloat(taxRate);
    if (isNaN(parsedTaxRate) || parsedTaxRate < 0 || parsedTaxRate > 100) {
      setError('Tax rate must be between 0 and 100%.');
      return;
    }

    const isDuplicate = categories.some(c => c.name.toLowerCase() === cleanName.toLowerCase() && c.id !== editingId);
    if (isDuplicate) {
      setError('A category with this name already exists.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = { 
        name: cleanName, 
        description: description.trim(),
        taxRate: taxRate
      };
      
      if (editingId) {
        await window.pharmacoreAPI.updateCategory(editingId, payload);
      } else {
        await window.pharmacoreAPI.addCategory(payload);
      }
      resetForm();
      fetchCategories();
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns = [
    {
      header: 'Category Name',
      accessor: 'name',
      sortable: true,
      cell: (c) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs">
            <Tag className="w-3.5 h-3.5" />
          </div>
          <span className="font-extrabold text-slate-900 text-sm">{c.name}</span>
        </div>
      )
    },
    {
      header: 'GST Tax Rate',
      accessor: 'taxRate',
      sortable: true,
      align: 'center',
      cell: (c) => (
        <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 text-slate-800 font-mono font-bold px-2.5 py-0.5 rounded-full text-xs">
          <Percent className="w-3 h-3 text-slate-400" />
          {c.taxRate ?? 0}%
        </span>
      )
    },
    {
      header: 'Description',
      accessor: 'description',
      cell: (c) => <span className="text-slate-600 text-xs font-medium">{c.description || '—'}</span>
    },
    ...(isAdmin ? [{
      header: 'Actions',
      align: 'right',
      cell: (c) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => handleEdit(c)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            title="Edit Category"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleDelete(c.id)}
            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
            title="Delete Category"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    }] : [])
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">Categories & Taxation</h3>
          <p className="text-xs font-semibold text-slate-500">
            Manage medicine classification groups, custom sales tax (GST), and store defaults.
          </p>
        </div>
      </div>

      {/* Admin Default Tax Rate Setting */}
      {isAdmin && (
        <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-emerald-600" />
            <h4 className="text-sm font-black text-slate-900">Default Store GST Tax Rate (Uncategorized)</h4>
          </div>
          <div className="flex items-center gap-3 max-w-md">
            <div className="relative flex-1">
              <input
                type="number"
                value={defaultTaxRate}
                onChange={e => setDefaultTaxRateState(parseFloat(e.target.value) || 0)}
                disabled={isSavingDefaultTax}
                className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2 text-slate-900 text-xs font-bold outline-none"
                placeholder="e.g. 17"
                step="0.01"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
            </div>
            <button
              onClick={handleSaveDefaultTaxRate}
              disabled={isSavingDefaultTax}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-2 px-5 rounded-xl transition-all text-xs shadow-sm"
            >
              {isSavingDefaultTax ? 'Saving...' : 'Update Default'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Col: Create/Edit Form (Admin only) */}
        {isAdmin ? (
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-sm h-fit space-y-4">
            <div>
              <h4 className="text-base font-black text-slate-900">
                {editingId ? 'Edit Category' : 'Add New Category'}
              </h4>
              <p className="text-[11px] font-semibold text-slate-400">Classify drugs and set individual tax percentages</p>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Category Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 text-xs font-bold outline-none transition-all"
                  placeholder="e.g. Antibiotics / Painkillers"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Tax Rate (%)</label>
                <input
                  type="number"
                  value={taxRate}
                  onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 text-xs font-bold outline-none transition-all"
                  placeholder="e.g. 17"
                  step="0.01"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Description (Optional)</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2 text-slate-900 placeholder:text-slate-400 text-xs font-semibold outline-none transition-all resize-none h-20"
                  placeholder="e.g. Broad-spectrum antibacterial formulations"
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
                  {isSubmitting ? 'Saving...' : (editingId ? 'Update Category' : 'Save Category')}
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
              <Tag className="w-6 h-6" />
            </div>
            <p className="text-slate-800 text-sm font-bold">Read-Only View</p>
            <p className="text-slate-500 text-xs mt-1">Only administrators can add or edit categories.</p>
          </div>
        )}

        {/* Right Col: Categories List with DataTable */}
        <div className="lg:col-span-2">
          <DataTable
            columns={columns}
            data={categories}
            searchKeys={['name', 'description']}
            searchPlaceholder="Search categories by name or description..."
            exportFileName="categories-list"
            loading={loading}
            emptyMessage="No categories registered yet."
          />
        </div>

      </div>
    </div>
  );
}
