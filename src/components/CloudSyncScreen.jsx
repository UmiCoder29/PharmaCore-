import React, { useState, useEffect, useRef } from 'react';

/**
 * Cloud Sync Settings Screen (Admin Only)
 *
 * Allows the admin to configure Supabase cloud sync credentials,
 * toggle sync on/off, and monitor real-time sync status.
 */
export default function CloudSyncScreen({ user }) {
  const [config, setConfig] = useState({ url: '', anonKey: '', serviceRoleKey: '', enabled: false });
  const [status, setStatus] = useState({ running: false, online: false, lastPush: null, lastPull: null, pendingCount: 0, error: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' }); // type: 'success' | 'error'
  const [showServiceKey, setShowServiceKey] = useState(false);
  const statusIntervalRef = useRef(null);

  // ── Load config + start status polling ──────────────────────────────────────
  useEffect(() => {
    loadConfig();
    pollStatus();
    statusIntervalRef.current = setInterval(pollStatus, 3000);
    return () => clearInterval(statusIntervalRef.current);
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await window.pharmacoreAPI.getSupabaseConfig();
      setConfig(cfg || { url: '', anonKey: '', serviceRoleKey: '', enabled: false });
    } catch (err) {
      console.error('Failed to load Supabase config:', err);
    } finally {
      setLoading(false);
    }
  };

  const pollStatus = async () => {
    try {
      const s = await window.pharmacoreAPI.getSyncStatus();
      setStatus(s);
    } catch { /* silently ignore if not ready */ }
  };

  // ── Save config ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!config.url || !config.anonKey) {
      setMessage({ text: 'Project URL and Anon Key are required.', type: 'error' });
      return;
    }

    // Basic URL validation
    if (!config.url.startsWith('https://')) {
      setMessage({ text: 'Project URL must start with https://', type: 'error' });
      return;
    }

    setSaving(true);
    setMessage({ text: '', type: '' });

    // Clean up the URL in case the user accidentally copied the REST URL endpoint
    let cleanUrl = config.url.trim();
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
    if (cleanUrl.endsWith('/rest/v1')) cleanUrl = cleanUrl.replace(/\/rest\/v1$/, '');
    if (cleanUrl.endsWith('/graphql/v1')) cleanUrl = cleanUrl.replace(/\/graphql\/v1$/, '');
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);

    const configToSave = { ...config, url: cleanUrl };

    try {
      const result = await window.pharmacoreAPI.setSupabaseConfig(configToSave);
      if (result.success) {
        setConfig(configToSave); // update local state with cleaned URL
        setMessage({ text: configToSave.enabled ? 'Cloud sync enabled and saved!' : 'Configuration saved (sync is off).', type: 'success' });
      } else {
        setMessage({ text: result.error || 'Failed to save.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: err.message || 'Failed to save configuration.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle sync ─────────────────────────────────────────────────────────────
  const handleToggle = () => {
    setConfig(prev => ({ ...prev, enabled: !prev.enabled }));
  };

  // ── Time formatting ─────────────────────────────────────────────────────────
  const formatTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-ink tracking-wide flex items-center gap-3">
            <svg className="w-7 h-7 text-emerald" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
            </svg>
            Cloud Sync
          </h2>
          <p className="text-sm text-ink/60 mt-1">Connect to Supabase for real-time multi-branch sync and cloud backup.</p>
        </div>
      </div>

      {/* ── Live Status Card ────────────────────────────────────────────────── */}
      <div className="bg-white border border-ink/10 rounded-none p-5 ">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-ink/70">Sync Status</h3>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${status.running && status.online ? 'bg-emerald animate-pulse' : status.running ? 'bg-amber animate-pulse' : 'bg-ink/20'}`} />
            <span className="text-xs font-semibold text-ink/70">
              {status.running && status.online ? 'Connected' : status.running ? 'Syncing (offline)' : 'Disconnected'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatusTile
            label="Engine"
            value={status.running ? 'Running' : 'Stopped'}
            color={status.running ? 'text-emerald' : 'text-ink/40'}
          />
          <StatusTile
            label="Last Push"
            value={formatTime(status.lastPush)}
            color="text-ink/80"
          />
          <StatusTile
            label="Last Pull"
            value={formatTime(status.lastPull)}
            color="text-ink/80"
          />
          <StatusTile
            label="Pending"
            value={status.pendingCount}
            color={status.pendingCount > 0 ? 'text-emerald' : 'text-ink/80'}
          />
          <StatusTile
            label="Failed"
            value={status.failedCount || 0}
            color={status.failedCount > 0 ? 'text-terracotta/90 font-bold' : 'text-ink/80'}
          />
        </div>

        {(status.failedCount || 0) > 0 && (
          <div className="mt-4 p-3 bg-terracotta/5 border border-red-200 rounded-lg flex items-center justify-between animate-in slide-in-from-bottom-2">
            <div>
              <p className="text-sm font-bold text-terracotta">Failed Sync Items</p>
              <p className="text-xs text-terracotta/90 mt-0.5">{status.failedCount} item(s) failed to sync after 5 attempts.</p>
            </div>
            <button 
              onClick={async () => {
                await window.pharmacoreAPI.invoke('api:retry-failed-syncs');
                // Status will auto-update on next poll
              }}
              className="bg-terracotta/90 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors"
            >
              Retry Failed Items
            </button>
          </div>
        )}

        {status.error && (
          <div className="mt-3 bg-terracotta/5 border border-red-200 rounded-lg px-4 py-2 text-xs text-terracotta font-mono">
            ⚠ {status.error}
          </div>
        )}
      </div>

      {/* ── Configuration Card ──────────────────────────────────────────────── */}
      <div className="bg-white border border-ink/10 rounded-none p-6 ">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-ink/70">Supabase Configuration</h3>

          {/* Toggle Switch */}
          <button
            onClick={handleToggle}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none ${config.enabled ? 'bg-emerald' : 'bg-ink/20'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white  transition-transform duration-300 ${config.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Project URL */}
          <div>
            <label className="block text-xs font-semibold text-ink/70 uppercase tracking-wider mb-1.5">
              Project URL
            </label>
            <input
              type="url"
              value={config.url}
              onChange={e => setConfig(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://abcdefghij.supabase.co"
              className="w-full px-4 py-2.5 bg-clinical border border-ink/20 rounded-lg text-sm text-ink/90 font-mono placeholder-ink/40 focus:outline-none focus:ring-2 focus:ring-pharmacy-300 focus:border-emerald/40 transition-all"
            />
          </div>

          {/* Anon Key */}
          <div>
            <label className="block text-xs font-semibold text-ink/70 uppercase tracking-wider mb-1.5">
              Anon (Public) Key
            </label>
            <input
              type="text"
              value={config.anonKey}
              onChange={e => setConfig(prev => ({ ...prev, anonKey: e.target.value }))}
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              className="w-full px-4 py-2.5 bg-clinical border border-ink/20 rounded-lg text-sm text-ink/90 font-mono placeholder-ink/40 focus:outline-none focus:ring-2 focus:ring-pharmacy-300 focus:border-emerald/40 transition-all"
            />
          </div>

          {/* Service Role Key (masked) */}
          <div>
            <label className="block text-xs font-semibold text-ink/70 uppercase tracking-wider mb-1.5 flex items-center gap-2">
              Service Role Key
              <span className="text-[10px] bg-terracotta/10 text-terracotta px-1.5 py-0.5 rounded font-bold normal-case tracking-normal">SECRET</span>
            </label>
            <div className="relative">
              <input
                type={showServiceKey ? 'text' : 'password'}
                value={config.serviceRoleKey}
                onChange={e => setConfig(prev => ({ ...prev, serviceRoleKey: e.target.value }))}
                placeholder="eyJhbGciOiJIUzI1NiIs..."
                className="w-full px-4 py-2.5 pr-12 bg-clinical border border-ink/20 rounded-lg text-sm text-ink/90 font-mono placeholder-ink/40 focus:outline-none focus:ring-2 focus:ring-pharmacy-300 focus:border-emerald/40 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowServiceKey(!showServiceKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 transition-colors"
              >
                {showServiceKey ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-ink/40 mt-1">This key bypasses Row-Level Security. Never share it publicly.</p>
          </div>
        </div>

        {/* Message */}
        {message.text && (
          <div className={`mt-4 px-4 py-2.5 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-emerald/5 border border-emerald/20 text-emerald/90' : 'bg-terracotta/5 border border-red-200 text-terracotta'}`}>
            {message.text}
          </div>
        )}

        {/* Save Button */}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-ink/40">
            {config.enabled ? '🟢 Sync will start immediately after saving.' : '⏸ Sync is paused. Toggle on to enable.'}
          </p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-emerald hover:bg-emerald/90 disabled:bg-ink/20 text-white font-semibold text-sm rounded-lg transition-all duration-200  hover: flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Save Configuration
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Info Card ───────────────────────────────────────────────────────── */}
      <div className="bg-emerald/5 border border-emerald/20 rounded-none p-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald mb-2">How It Works</h4>
        <ul className="text-xs text-ink/70 space-y-1.5 leading-relaxed">
          <li className="flex items-start gap-2">
            <span className="text-emerald mt-0.5">●</span>
            Every sale, medicine, and batch change is queued locally and pushed to Supabase every 5 seconds.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald mt-0.5">●</span>
            If the internet goes down, changes accumulate in the local queue and sync automatically when connectivity returns.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald mt-0.5">●</span>
            Changes from other branches are received in real-time via Supabase Realtime channels.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald mt-0.5">●</span>
            Your Supabase project should be owned by the pharmacy for full data control.
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatusTile({ label, value, color }) {
  return (
    <div className="bg-clinical rounded-lg px-3 py-2.5 border border-ink/10">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40 mb-0.5">{label}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}
