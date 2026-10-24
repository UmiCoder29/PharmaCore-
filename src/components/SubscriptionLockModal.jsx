import React from 'react';
import { AlertTriangle, LogOut, PhoneCall, Mail, ShieldAlert } from 'lucide-react';

export default function SubscriptionLockModal({ user, onLogout }) {
  return (
    <div className="fixed inset-0 bg-[#071d1a]/95 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl text-center space-y-6 border border-terracotta/20 animate-fade-in">
        <div className="w-16 h-16 bg-terracotta/10 text-terracotta rounded-3xl flex items-center justify-center mx-auto shadow-inner">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div>
          <span className="px-3 py-1 bg-terracotta/10 text-terracotta text-xs font-mono font-bold uppercase rounded-full tracking-wider">
            Access Restricted
          </span>
          <h2 className="text-2xl font-black text-ink mt-3">Pharmacy Subscription Inactive</h2>
          <p className="text-sm text-ink/60 mt-2 leading-relaxed">
            The subscription for <strong className="text-ink">{user?.pharmacyName || 'this pharmacy'}</strong> is currently suspended or expired. Transactions and workspace access are paused until renewal.
          </p>
        </div>

        <div className="p-4 bg-clinical rounded-2xl border border-ink/5 text-left space-y-2 text-xs">
          <p className="font-bold text-ink">To reactivate your pharmacy workspace:</p>
          <div className="flex items-center gap-2 text-ink/70">
            <PhoneCall className="w-4 h-4 text-emerald" />
            <span>Call Platform Support: <strong>+92 300 1234567</strong></span>
          </div>
          <div className="flex items-center gap-2 text-ink/70">
            <Mail className="w-4 h-4 text-emerald" />
            <span>Email: <strong>billing@pharmacore.pk</strong></span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={onLogout}
            className="px-6 py-3 bg-ink hover:bg-ink/80 text-white font-bold text-xs rounded-2xl transition-all flex items-center gap-2 shadow-md"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out of Account</span>
          </button>
        </div>
      </div>
    </div>
  );
}
