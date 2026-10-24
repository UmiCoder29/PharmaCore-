import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  UserCheck, 
  Plus, 
  Phone, 
  MapPin, 
  IdCard, 
  Edit2, 
  Trash2, 
  FileText, 
  Users, 
  Calendar, 
  X, 
  RefreshCw,
  Stethoscope
} from 'lucide-react';
import DataTable from './DataTable.jsx';

export default function PatientsScreen({ user }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add / Edit Patient Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    cnic: '',
    address: ''
  });
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Prescription Drawer / Modal State
  const [selectedPatientForRx, setSelectedPatientForRx] = useState(null);
  const [prescriptions, setPrescriptions] = useState([]);
  const [rxLoading, setRxLoading] = useState(false);
  const [showAddRxModal, setShowAddRxModal] = useState(false);
  const [newRx, setNewRx] = useState({
    prescriberName: '',
    prescriptionDate: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [rxSubmitting, setRxSubmitting] = useState(false);
  const [rxError, setRxError] = useState('');

  const isAdmin = user?.role === 'admin';

  const fetchCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await window.pharmacoreAPI.getCustomers();
      setCustomers(data || []);
    } catch (err) {
      console.error('Failed to load customers:', err);
      setError(err.message || 'Failed to load patients list.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPatientPrescriptions = async (patient) => {
    setSelectedPatientForRx(patient);
    setRxLoading(true);
    try {
      const rxData = await window.pharmacoreAPI.getPrescriptions(patient.id);
      setPrescriptions(rxData || []);
    } catch (err) {
      console.error('Failed to load prescriptions:', err);
    } finally {
      setRxLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const openAddModal = () => {
    setEditingPatient(null);
    setFormData({ fullName: '', phone: '', cnic: '', address: '' });
    setModalError('');
    setShowModal(true);
  };

  const openEditModal = (patient) => {
    setEditingPatient(patient);
    setFormData({
      fullName: patient.fullName || '',
      phone: patient.phone || '',
      cnic: patient.cnic || '',
      address: patient.address || ''
    });
    setModalError('');
    setShowModal(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName?.trim()) {
      setModalError('Patient full name is required.');
      return;
    }
    setModalSubmitting(true);
    setModalError('');

    try {
      if (editingPatient) {
        await window.pharmacoreAPI.updateCustomer(editingPatient.id, {
          fullName: formData.fullName.trim(),
          phone: formData.phone.trim() || null,
          cnic: formData.cnic.trim() || null,
          address: formData.address.trim() || null
        });
      } else {
        await window.pharmacoreAPI.addCustomer({
          fullName: formData.fullName.trim(),
          phone: formData.phone.trim() || null,
          cnic: formData.cnic.trim() || null,
          address: formData.address.trim() || null
        });
      }
      setShowModal(false);
      fetchCustomers();
    } catch (err) {
      setModalError(err.message || 'Operation failed.');
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleDeletePatient = async (patient) => {
    if (!window.confirm(`Are you sure you want to delete patient "${patient.fullName}"?`)) {
      return;
    }
    try {
      await window.pharmacoreAPI.deleteCustomer(patient.id);
      fetchCustomers();
      if (selectedPatientForRx?.id === patient.id) {
        setSelectedPatientForRx(null);
      }
    } catch (err) {
      alert(err.message || 'Failed to delete patient.');
    }
  };

  const handleAddPrescriptionSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatientForRx) return;
    if (!newRx.prescriberName?.trim()) {
      setRxError('Prescribing doctor name is required.');
      return;
    }
    setRxSubmitting(true);
    setRxError('');
    try {
      await window.pharmacoreAPI.addPrescription({
        customerId: selectedPatientForRx.id,
        prescriberName: newRx.prescriberName.trim(),
        prescriptionDate: newRx.prescriptionDate,
        notes: newRx.notes.trim() || null
      });
      setShowAddRxModal(false);
      setNewRx({
        prescriberName: '',
        prescriptionDate: new Date().toISOString().split('T')[0],
        notes: ''
      });
      fetchPatientPrescriptions(selectedPatientForRx);
    } catch (err) {
      setRxError(err.message || 'Failed to record prescription.');
    } finally {
      setRxSubmitting(false);
    }
  };

  // Calculations for stats
  const totalPatients = customers.length;
  const withPhoneCount = customers.filter(c => !!c.phone?.trim()).length;
  const withCnicCount = customers.filter(c => !!c.cnic?.trim()).length;
  const recentCount = customers.filter(c => {
    if (!c.createdAt) return false;
    const diff = (new Date() - new Date(c.createdAt)) / (1000 * 60 * 60 * 24);
    return diff <= 30;
  }).length;

  const tableColumns = [
    {
      header: 'Patient Profile',
      accessor: 'fullName',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-800 font-black text-xs flex items-center justify-center shrink-0">
            {row.fullName?.[0]?.toUpperCase() || 'P'}
          </div>
          <div>
            <h4 className="text-xs font-black text-slate-900 leading-snug">{row.fullName}</h4>
            <span className="text-[10px] font-mono text-slate-400 font-bold">
              ID: {row.id?.slice(0, 8)}
            </span>
          </div>
        </div>
      )
    },
    {
      header: 'Mobile / Phone',
      accessor: 'phone',
      sortable: true,
      render: (row) => row.phone ? (
        <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-800">
          <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>{row.phone}</span>
        </div>
      ) : (
        <span className="text-xs text-slate-400 font-medium italic">Not provided</span>
      )
    },
    {
      header: 'CNIC / National ID',
      accessor: 'cnic',
      sortable: true,
      render: (row) => row.cnic ? (
        <span className="font-mono text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
          {row.cnic}
        </span>
      ) : (
        <span className="text-xs text-slate-400 font-medium italic">—</span>
      )
    },
    {
      header: 'Address / Location',
      accessor: 'address',
      sortable: true,
      render: (row) => row.address ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium max-w-xs truncate" title={row.address}>
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{row.address}</span>
        </div>
      ) : (
        <span className="text-xs text-slate-400 font-medium italic">—</span>
      )
    },
    {
      header: 'Registered On',
      accessor: 'createdAt',
      sortable: true,
      render: (row) => (
        <span className="text-xs font-semibold text-slate-600 font-mono">
          {row.createdAt ? new Date(row.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
        </span>
      )
    },
    {
      header: 'Prescriptions',
      id: 'prescriptions',
      render: (row) => (
        <button
          onClick={() => fetchPatientPrescriptions(row)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-black text-xs border border-emerald-200 transition-colors"
        >
          <FileText className="w-3 h-3 text-emerald-600" />
          <span>View Rx</span>
        </button>
      )
    },
    {
      header: 'Actions',
      id: 'actions',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => openEditModal(row)}
            className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="Edit Patient Details"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleDeletePatient(row)}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
            title="Delete Patient"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      {/* ── Top Header Banner ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border-2 border-slate-200 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-md shadow-emerald-950/20 shrink-0">
            <Users className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Patients & Customers</h1>
            <p className="text-xs font-semibold text-slate-500">
              Manage patient database, contact profiles, CNIC verifications and prescription histories
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchCustomers}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all shadow-sm"
            title="Refresh patient list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all shadow-md transform hover:-translate-y-0.5"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Register New Patient</span>
          </button>
        </div>
      </div>

      {/* ── Metric Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-400">Total Patients</p>
            <h3 className="text-2xl font-black text-slate-900 mt-1">{totalPatients}</h3>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">Registered in database</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <UserCheck className="w-6 h-6 stroke-[2]" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-400">Phone Verified</p>
            <h3 className="text-2xl font-black text-slate-900 mt-1">{withPhoneCount}</h3>
            <p className="text-[10px] font-semibold text-slate-500 mt-0.5">Available for SMS alerts</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
            <Phone className="w-6 h-6 stroke-[2]" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-400">CNIC On File</p>
            <h3 className="text-2xl font-black text-slate-900 mt-1">{withCnicCount}</h3>
            <p className="text-[10px] font-semibold text-slate-500 mt-0.5">Controlled drug compliance</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <IdCard className="w-6 h-6 stroke-[2]" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border-2 border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-400">New (Last 30 Days)</p>
            <h3 className="text-2xl font-black text-slate-900 mt-1">{recentCount}</h3>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">Recent registrations</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 shrink-0">
            <Calendar className="w-6 h-6 stroke-[2]" />
          </div>
        </div>
      </div>

      {/* ── Main Patients DataTable ── */}
      <DataTable
        data={customers}
        columns={tableColumns}
        searchPlaceholder="Search patients by name, phone, CNIC, or address..."
        searchKeys={['fullName', 'phone', 'cnic', 'address']}
        pageSize={15}
        emptyStateMessage="No registered patients found. Click '+ Register New Patient' to add your first customer."
      />

      {/* ── Add / Edit Patient Modal ── */}
      {showModal && createPortal(
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget && !modalSubmitting) setShowModal(false); }}
        >
          <div 
            className="bg-white rounded-2xl border-2 border-slate-200 shadow-2xl w-full max-w-md my-auto overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-50/90">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                  <UserCheck className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">
                    {editingPatient ? 'Edit Patient Profile' : 'Register New Patient'}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500">
                    {editingPatient ? 'Update patient contact and ID details' : 'Add customer to pharmacy database'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !modalSubmitting && setShowModal(false)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl p-1.5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Patient Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="e.g. Muhammad Tariq"
                  disabled={modalSubmitting}
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" /> Phone Number
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="0300-1234567"
                    disabled={modalSubmitting}
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <IdCard className="w-3 h-3 text-slate-400" /> CNIC / ID
                  </label>
                  <input
                    type="text"
                    value={formData.cnic}
                    onChange={(e) => setFormData({ ...formData, cnic: e.target.value })}
                    placeholder="42101-1234567-1"
                    disabled={modalSubmitting}
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" /> Residential Address
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="e.g. Clifton Block 5, Karachi"
                  disabled={modalSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              {modalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold">
                  {modalError}
                </div>
              )}

              <div className="flex gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={modalSubmitting}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-2.5 rounded-xl text-xs transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-xs transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {modalSubmitting ? 'Saving...' : editingPatient ? 'Update Profile' : 'Save Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Patient Prescriptions Modal ── */}
      {selectedPatientForRx && createPortal(
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedPatientForRx(null); }}
        >
          <div 
            className="bg-white rounded-2xl border-2 border-slate-200 shadow-2xl w-full max-w-2xl my-auto overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-50/90">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                  <FileText className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">
                    Prescription History: {selectedPatientForRx.fullName}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500">
                    Phone: {selectedPatientForRx.phone || 'N/A'} • CNIC: {selectedPatientForRx.cnic || 'N/A'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPatientForRx(null)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl p-1.5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Prescriptions List */}
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">
                  Verified Doctor Prescriptions ({prescriptions.length})
                </h4>
                <button
                  type="button"
                  onClick={() => setShowAddRxModal(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-sm transition-all"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  <span>Record New Prescription</span>
                </button>
              </div>

              {rxLoading ? (
                <div className="py-12 flex justify-center items-center gap-2 text-slate-400 text-xs font-bold">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Loading prescriptions...</span>
                </div>
              ) : prescriptions.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <FileText className="w-10 h-10 mx-auto text-slate-300 stroke-[1.5]" />
                  <p className="text-xs font-bold text-slate-600">No prescriptions on file for this patient.</p>
                  <p className="text-[11px] text-slate-400">Click "+ Record New Prescription" to log a doctor prescription.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {prescriptions.map((rx) => (
                    <div 
                      key={rx.id} 
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-emerald-400 transition-colors space-y-2"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <Stethoscope className="w-4 h-4 text-emerald-600" />
                          <h5 className="text-xs font-black text-slate-900">{rx.prescriberName}</h5>
                        </div>
                        <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                          Verified Rx
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 font-semibold pt-1 border-t border-slate-100">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>Date: {rx.prescriptionDate}</span>
                        </div>
                        {rx.notes && (
                          <div className="col-span-2 text-slate-500 font-medium italic">
                            "{rx.notes}"
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedPatientForRx(null)}
                className="px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Add New Prescription Modal (Nested) ── */}
      {showAddRxModal && createPortal(
        <div 
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget && !rxSubmitting) setShowAddRxModal(false); }}
        >
          <div 
            className="bg-white rounded-2xl border-2 border-slate-200 shadow-2xl w-full max-w-md my-auto overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-50/90">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                  <Stethoscope className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">Record Prescription</h3>
                  <p className="text-xs font-semibold text-slate-500">
                    For: {selectedPatientForRx?.fullName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !rxSubmitting && setShowAddRxModal(false)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl p-1.5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddPrescriptionSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Prescribing Doctor / Consultant <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newRx.prescriberName}
                  onChange={(e) => setNewRx({ ...newRx, prescriberName: e.target.value })}
                  placeholder="e.g. Dr. Asim Farooq (FCPS)"
                  disabled={rxSubmitting}
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Prescription Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={newRx.prescriptionDate}
                  onChange={(e) => setNewRx({ ...newRx, prescriptionDate: e.target.value })}
                  disabled={rxSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Hospital / Clinical Notes
                </label>
                <input
                  type="text"
                  value={newRx.notes}
                  onChange={(e) => setNewRx({ ...newRx, notes: e.target.value })}
                  placeholder="e.g. Aga Khan Hospital, Dosage: BID x 5 days"
                  disabled={rxSubmitting}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-600 focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none transition-all"
                />
              </div>

              {rxError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold">
                  {rxError}
                </div>
              )}

              <div className="flex gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddRxModal(false)}
                  disabled={rxSubmitting}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-2.5 rounded-xl text-xs transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rxSubmitting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-xs transition-all shadow-md disabled:opacity-50"
                >
                  {rxSubmitting ? 'Saving...' : 'Save Prescription'}
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