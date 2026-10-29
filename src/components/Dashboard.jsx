import React, { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import POSScreen from './POSScreen.jsx';
import MedicinesScreen from './MedicinesScreen.jsx';
import PatientsScreen from './PatientsScreen.jsx';
import SuppliersScreen from './SuppliersScreen.jsx';
import CategoriesScreen from './CategoriesScreen.jsx';
import UsersScreen from './UsersScreen.jsx';
import SalesHistoryScreen from './SalesHistoryScreen.jsx';
import ReturnsScreen from './ReturnsScreen.jsx';
import TaxDashboard from './TaxDashboard.jsx';
import ActivityLogScreen from './ActivityLogScreen.jsx';
import ExpiryAlertsScreen from './ExpiryAlertsScreen.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import BranchesScreen from './BranchesScreen.jsx';
import SaasAdminScreen from './SaasAdminScreen.jsx';
import SaasChatScreen from './SaasChatScreen.jsx';
import SaasPlansScreen from './SaasPlansScreen.jsx';
import SaasSettingsScreen from './SaasSettingsScreen.jsx';
import SubscriptionScreen from './SubscriptionScreen.jsx';
import SubscriptionLockModal from './SubscriptionLockModal.jsx';
import SupportChatWidget from './SupportChatWidget.jsx';
import { 
  Activity, 
  ShoppingCart, 
  Package, 
  Truck, 
  Tag, 
  Receipt, 
  RotateCcw, 
  AlertTriangle, 
  Building, 
  Calculator, 
  Users, 
  ScrollText, 
  LogOut, 
  Store,
  UserCheck,
  ShieldCheck,
  CreditCard,
  MessageSquare,
  Sparkles,
  Settings,
  Megaphone,
  Image as ImageIcon
} from 'lucide-react';
import { LOW_STOCK_THRESHOLD } from '../utils/constants.js';

/**
 * Main application layout with distinct SuperAdmin vs Pharmacy Tenant interfaces.
 */
export default function Dashboard({ user, onLogout }) {
  const isSuperAdmin = user?.role === 'superadmin';
  const [time, setTime] = useState(new Date());
  const [activeTab, setActiveTab] = useState(isSuperAdmin ? 'saas-admin' : 'pos');
  const [expiryAlertCount, setExpiryAlertCount] = useState(0);
  const [lowStockAlertCount, setLowStockAlertCount] = useState(0);
  const [unreadInquiryCount, setUnreadInquiryCount] = useState(0);
  const [broadcast, setBroadcast] = useState(null);
  const [broadcastDismissed, setBroadcastDismissed] = useState(false);
  const [publicConfig, setPublicConfig] = useState(null);
  const [connection, setConnection] = useState({ online: true, offlineQueueCount: 0 });
  const [initialReturnSaleId, setInitialReturnSaleId] = useState(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState(user?.subscription || null);
  const [pharmacyProfile, setPharmacyProfile] = useState({
    name: user?.pharmacyName || '',
    logoUrl: user?.pharmacyLogo || null
  });
  
  const contentRef = useRef(null);
  const prevTabRef = useRef(activeTab);

  // Check if pharmacy subscription is locked
  const isSubscriptionLocked = !isSuperAdmin && (
    subscriptionInfo?.status === 'suspended' || 
    subscriptionInfo?.status === 'cancelled'
  );

  // Animate content on tab change
  useEffect(() => {
    if (prevTabRef.current !== activeTab && contentRef.current) {
      gsap.fromTo(contentRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.35, ease: 'power3.inOut' }
      );
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const lastStatusErrorRef = useRef('');
  // Poll connection & public broadcast config
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const [conn, config] = await Promise.all([
          window.pharmacoreAPI.getConnectionStatus(),
          window.pharmacoreAPI.getPublicConfig().catch(() => null)
        ]);
        lastStatusErrorRef.current = '';
        setConnection(conn);
        setPublicConfig(config);
        if (config?.broadcast && config.broadcast.enabled) {
          setBroadcast(config.broadcast);
        } else {
          setBroadcast(null);
        }
      } catch (e) {
        if (lastStatusErrorRef.current !== e.message) {
          lastStatusErrorRef.current = e.message;
          console.error('[Dashboard] Failed to get status:', e.message);
        }
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  const lastInquiryErrorRef = useRef('');
  // SuperAdmin: Poll unread upgrade chat messages
  useEffect(() => {
    if (!isSuperAdmin) return;
    const fetchUnread = async () => {
      try {
        const inquiries = await window.pharmacoreAPI.getSaasInquiries();
        if (inquiries && inquiries.success === false) {
          if (lastInquiryErrorRef.current !== inquiries.error) {
            lastInquiryErrorRef.current = inquiries.error;
            console.error('[Dashboard] Failed to fetch unread inquiries:', inquiries.error);
          }
          return;
        }
        lastInquiryErrorRef.current = '';
        const list = Array.isArray(inquiries) ? inquiries : (inquiries?.data || []);
        const unread = list.filter(i => !i.isReadBySuperadmin && i.senderRole !== 'superadmin').length;
        setUnreadInquiryCount(unread);
      } catch (err) {
        if (lastInquiryErrorRef.current !== err.message) {
          lastInquiryErrorRef.current = err.message;
          console.error('[Dashboard] Error polling unread inquiries:', err.message);
        }
      }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 5000);
    return () => clearInterval(interval);
  }, [isSuperAdmin]);

  // Pharmacy: Fetch live subscription data, branding, & expiry alerts
  useEffect(() => {
    if (isSuperAdmin) return;

    window.pharmacoreAPI.getCurrentSubscription()
      .then(sub => {
        if (sub) {
          setSubscriptionInfo(sub);
          setPharmacyProfile({
            name: sub.name || user?.pharmacyName,
            logoUrl: sub.logoUrl || user?.pharmacyLogo
          });
        }
      })
      .catch(console.error);

    const calculateExpiryAlerts = async () => {
      try {
        const [medicines, expiredBatches, threshold] = await Promise.all([
          window.pharmacoreAPI.getMedicines(),
          window.pharmacoreAPI.getExpiredBatches(),
          window.pharmacoreAPI.getExpiryThreshold(),
        ]);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const nearExpiryCount = (medicines || []).flatMap(m => m.batches || []).filter(b => {
          const exp = new Date(b.expiryDate);
          exp.setHours(0, 0, 0, 0);
          const days = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
          return days >= 0 && days <= threshold;
        }).length;

        setExpiryAlertCount((expiredBatches?.length || 0) + nearExpiryCount);

        const lowStockCount = (medicines || []).map(m => {
          return (m.batches || []).filter(b => !b.isExpired).reduce((s, b) => s + b.quantityInStock, 0);
        }).filter(totalStock => totalStock <= LOW_STOCK_THRESHOLD).length;
        
        setLowStockAlertCount(lowStockCount);
      } catch (err) {
        console.error('Failed to calculate expiry alerts:', err);
      }
    };

    calculateExpiryAlerts();
    const interval = setInterval(calculateExpiryAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isSuperAdmin]);

  const handleLogout = async () => {
    await window.pharmacoreAPI.logout();
    onLogout();
  };

  const handleNavigateToReturns = (saleId) => {
    setInitialReturnSaleId(saleId);
    setActiveTab('returns');
  };

  const formatTime = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formatDate = d => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  // Custom Logos with default fallback to uploaded brand logo
  const portalLogo = publicConfig?.identity?.logoUrl || './logo-emblem.png';
  const activeLogo = isSuperAdmin ? portalLogo : (pharmacyProfile.logoUrl || portalLogo);

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 font-sans overflow-hidden selection:bg-emerald-500/20 selection:text-emerald-700">
      {/* Lockout modal for suspended pharmacies */}
      {isSubscriptionLocked && (
        <SubscriptionLockModal user={user} onLogout={handleLogout} />
      )}

      {/* ─── SIDEBAR NAVIGATION ────────────────────────────────────────────── */}
      <aside className="w-64 bg-slate-950 text-slate-200 border-r border-slate-800/80 flex flex-col shrink-0 z-20 shadow-2xl">
        {/* Brand Header */}
        <div className="p-5 border-b border-slate-800/80 relative overflow-hidden bg-slate-900/50">
          <div className="absolute -top-8 -right-8 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex items-center gap-3 relative z-10">
            {activeLogo ? (
              <div className="w-10 h-10 flex items-center justify-center shrink-0">
                <img src={activeLogo} alt="Logo" className="w-full h-full object-contain drop-shadow-[0_4px_12px_rgba(52,211,153,0.4)]" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 shadow-lg shadow-emerald-950/50 flex items-center justify-center shrink-0">
                {isSuperAdmin ? <ShieldCheck className="w-5 h-5 text-white stroke-[2.5]" /> : <Activity className="w-5 h-5 text-white stroke-[2.5]" />}
              </div>
            )}
            
            <div className="flex flex-col justify-center min-w-0">
              <h1 className="text-lg font-black text-white tracking-tight leading-none truncate">
                {isSuperAdmin ? (publicConfig?.identity?.platformName || 'PharmaCore') : (pharmacyProfile.name || 'PharmaCore')}
              </h1>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                <p className="text-[9px] font-mono font-extrabold text-emerald-300 tracking-[0.16em] uppercase truncate">
                  {isSuperAdmin ? 'SaaS Master Control' : 'Pharmacy Portal'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1.5 custom-scrollbar">
          {/* ==================================================================== */}
          {/* SUPERADMIN NAVIGATION (Pure SaaS Platform & Global Control)          */}
          {/* ==================================================================== */}
          {isSuperAdmin ? (
            <div className="space-y-1.5">
              <span className="px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 block mb-1">
                SaaS Control Center
              </span>
              <SidebarButton 
                active={activeTab === 'saas-admin'} 
                onClick={() => setActiveTab('saas-admin')}
                icon={<Building className="w-4 h-4 stroke-[2.5]" />}
                label="Pharmacies & Clients" 
              />
              <SidebarButton 
                active={activeTab === 'saas-chat'} 
                onClick={() => setActiveTab('saas-chat')}
                icon={<MessageSquare className="w-4 h-4 stroke-[2.5]" />}
                label="Upgrade Chat & Inquiries" 
                badge={unreadInquiryCount > 0 ? unreadInquiryCount : null}
              />
              <SidebarButton 
                active={activeTab === 'saas-plans'} 
                onClick={() => setActiveTab('saas-plans')}
                icon={<CreditCard className="w-4 h-4 stroke-[2.5]" />}
                label="Subscription Plans" 
              />
              <SidebarButton 
                active={activeTab === 'saas-settings'} 
                onClick={() => setActiveTab('saas-settings')}
                icon={<Settings className="w-4 h-4 stroke-[2.5]" />}
                label="Core Platform Settings" 
              />
            </div>
          ) : (
            /* ================================================================== */
            /* PHARMACY TENANT / PHARMACIST / OWNER NAVIGATION                     */
            /* ================================================================== */
            <div className="space-y-1">
              <SidebarButton 
                active={activeTab === 'pos'} 
                onClick={() => setActiveTab('pos')}
                icon={<ShoppingCart className="w-4 h-4 stroke-[2.5]" />}
                label="POS Register" 
              />
              <SidebarButton 
                active={activeTab === 'inventory'} 
                onClick={() => setActiveTab('inventory')}
                icon={<Package className="w-4 h-4 stroke-[2.5]" />}
                label="Medicines & Stock" 
              />
              <SidebarButton 
                active={activeTab === 'patients'} 
                onClick={() => setActiveTab('patients')}
                icon={<UserCheck className="w-4 h-4 stroke-[2.5]" />}
                label="Patients & Rx" 
              />
              <SidebarButton 
                active={activeTab === 'suppliers'} 
                onClick={() => setActiveTab('suppliers')}
                icon={<Truck className="w-4 h-4 stroke-[2.5]" />}
                label="Suppliers" 
              />
              <SidebarButton 
                active={activeTab === 'categories'} 
                onClick={() => setActiveTab('categories')}
                icon={<Tag className="w-4 h-4 stroke-[2.5]" />}
                label="Categories" 
              />
              <SidebarButton 
                active={activeTab === 'sales'} 
                onClick={() => setActiveTab('sales')}
                icon={<Receipt className="w-4 h-4 stroke-[2.5]" />}
                label="Sales History" 
              />
              <SidebarButton 
                active={activeTab === 'returns'} 
                onClick={() => setActiveTab('returns')}
                icon={<RotateCcw className="w-4 h-4 stroke-[2.5]" />}
                label="Returns & Refunds" 
              />
              <SidebarButton 
                active={activeTab === 'expiry-alerts'} 
                onClick={() => setActiveTab('expiry-alerts')}
                icon={<AlertTriangle className="w-4 h-4 stroke-[2.5]" />}
                label="Expiry Alerts"
                badges={[
                  ...(lowStockAlertCount > 0 ? [{ count: lowStockAlertCount, className: 'bg-amber-500 text-slate-950 font-black' }] : []),
                  ...(expiryAlertCount > 0 ? [{ count: expiryAlertCount, className: 'bg-rose-500 text-white font-black' }] : [])
                ]}
              />

              {user.canViewAllBranches && (
                <SidebarButton 
                  active={activeTab === 'branches'} 
                  onClick={() => setActiveTab('branches')}
                  icon={<Building className="w-4 h-4 stroke-[2.5]" />}
                  label="Branches" 
                />
              )}

              {user.role === 'admin' && (
                <div className="pt-2 mt-2 border-t border-slate-800/80 space-y-1">
                  <span className="px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Store Administration
                  </span>
                  <SidebarButton 
                    active={activeTab === 'subscription'} 
                    onClick={() => setActiveTab('subscription')}
                    icon={<CreditCard className="w-4 h-4 stroke-[2.5] text-emerald-400" />}
                    label="Subscription & Branding" 
                  />
                  <SidebarButton 
                    active={activeTab === 'tax-dashboard'} 
                    onClick={() => setActiveTab('tax-dashboard')}
                    icon={<Calculator className="w-4 h-4 stroke-[2.5]" />}
                    label="Tax & FBR Dashboard" 
                  />
                  <SidebarButton 
                    active={activeTab === 'users'} 
                    onClick={() => setActiveTab('users')}
                    icon={<Users className="w-4 h-4 stroke-[2.5]" />}
                    label="Staff & Users" 
                  />
                  <SidebarButton 
                    active={activeTab === 'activity-log'} 
                    onClick={() => setActiveTab('activity-log')}
                    icon={<ScrollText className="w-4 h-4 stroke-[2.5]" />}
                    label="Activity Log" 
                  />
                </div>
              )}
            </div>
          )}
        </nav>

        {/* User Footer */}
        <div className="p-3.5 border-t border-slate-800/90 bg-slate-900/70 space-y-2.5">
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/60 rounded-xl px-2.5 py-1.5">
            <Store className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                {isSuperAdmin ? 'Platform Scope' : 'Active Pharmacy'}
              </p>
              <p className="text-xs font-bold text-slate-100 truncate">
                {isSuperAdmin ? 'Global SaaS Platform' : (pharmacyProfile.name || 'Your Pharmacy')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white flex items-center justify-center text-xs font-black shadow-sm shrink-0">
              {(user.name || user.username)[0].toUpperCase()}
            </div>
            <div className="flex flex-col text-left min-w-0 flex-1">
              <p className="text-xs font-extrabold text-white truncate leading-tight">{user.name || user.username}</p>
              <span className="text-[10px] font-mono font-bold text-emerald-400 capitalize leading-tight">
                {isSuperAdmin ? 'Platform Owner' : user.role}
              </span>
            </div>
          </div>

          <button 
            onClick={handleLogout}
            className="w-full bg-slate-800 hover:bg-rose-600 hover:text-white text-slate-300 border border-slate-700/80 font-bold py-2 px-3 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ─── MAIN CANVAS ───────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative bg-slate-100">
        {/* Global Broadcast Banner */}
        {broadcast && broadcast.enabled && !broadcastDismissed && (
          <div className={`px-6 py-2.5 flex items-center justify-between text-xs font-bold shadow-sm ${
            broadcast.type === 'alert' ? 'bg-rose-600 text-white' :
            broadcast.type === 'warning' ? 'bg-amber-500 text-slate-950' :
            broadcast.type === 'success' ? 'bg-emerald-600 text-white' :
            'bg-blue-600 text-white'
          }`}>
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4" />
              <span>{broadcast.message}</span>
            </div>
            {broadcast.dismissible && (
              <button 
                onClick={() => setBroadcastDismissed(true)} 
                className="opacity-80 hover:opacity-100 text-sm font-black ml-4"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 z-10 shadow-sm">
          <div className="flex items-center space-x-5">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight capitalize">
              {activeTab.replace('saas-', '').replace('-', ' ')}
            </h2>

            {/* Tenant / SuperAdmin pill */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                {pharmacyProfile.logoUrl && !isSuperAdmin ? (
                  <img src={pharmacyProfile.logoUrl} alt="Logo" className="w-4 h-4 object-contain rounded-sm" />
                ) : isSuperAdmin ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Store className="w-3.5 h-3.5 text-emerald-600" />
                )}
                <span>{isSuperAdmin ? 'SuperAdmin Control' : (pharmacyProfile.name || 'PharmaCore')}</span>
              </div>

              {!isSuperAdmin && subscriptionInfo && (
                <div className={`text-xs font-bold px-2.5 py-0.5 rounded-full capitalize ${
                  subscriptionInfo.planTier === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                  subscriptionInfo.planTier === 'professional' ? 'bg-emerald-100 text-emerald-800' :
                  subscriptionInfo.planTier === 'starter' ? 'bg-blue-100 text-blue-700' :
                  'bg-amber-100 text-amber-800'
                }`}>
                  {subscriptionInfo.planTier} Plan
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-5 text-xs font-bold text-slate-600 font-mono">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
              <span className={`w-2 h-2 rounded-full ${connection.online ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="font-sans font-bold">{connection.online ? 'Online' : `Offline (${connection.offlineQueueCount})`}</span>
            </div>
            <span>{formatDate(time)}</span>
            <span className="font-extrabold text-slate-900">{formatTime(time)}</span>
          </div>
        </header>
        
        {/* Main Content Router */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar relative">
          <div ref={contentRef} className="max-w-[1440px] mx-auto w-full h-full">
            {/* SuperAdmin Views */}
            {isSuperAdmin && (
              <>
                {activeTab === 'saas-admin' && <ErrorBoundary><SaasAdminScreen user={user} /></ErrorBoundary>}
                {activeTab === 'saas-chat' && <ErrorBoundary><SaasChatScreen user={user} /></ErrorBoundary>}
                {activeTab === 'saas-plans' && <ErrorBoundary><SaasPlansScreen user={user} /></ErrorBoundary>}
                {activeTab === 'saas-settings' && <ErrorBoundary><SaasSettingsScreen user={user} /></ErrorBoundary>}
              </>
            )}

            {/* Pharmacy Tenant Views */}
            {!isSuperAdmin && (
              <>
                {activeTab === 'subscription' && (
                  <SubscriptionScreen 
                    user={user} 
                    onBrandingUpdated={(updated) => {
                      setPharmacyProfile({
                        name: updated.name,
                        logoUrl: updated.logoUrl
                      });
                    }}
                  />
                )}
                {activeTab === 'pos' && <POSScreen user={user} />}
                {activeTab === 'inventory' && <MedicinesScreen user={user} />}
                {activeTab === 'patients' && <ErrorBoundary><PatientsScreen user={user} /></ErrorBoundary>}
                {activeTab === 'suppliers' && <ErrorBoundary><SuppliersScreen user={user} /></ErrorBoundary>}
                {activeTab === 'categories' && <CategoriesScreen user={user} />}
                {activeTab === 'users' && <UsersScreen user={user} />}
                {activeTab === 'sales' && <SalesHistoryScreen user={user} onNavigateToReturns={handleNavigateToReturns} />}
                {activeTab === 'returns' && (
                  <ReturnsScreen 
                    user={user} 
                    initialSaleId={initialReturnSaleId} 
                    clearInitialSaleId={() => setInitialReturnSaleId(null)} 
                  />
                )}
                {activeTab === 'tax-dashboard' && <ErrorBoundary><TaxDashboard user={user} /></ErrorBoundary>}
                {activeTab === 'activity-log' && <ActivityLogScreen user={user} />}
                {activeTab === 'expiry-alerts' && <ExpiryAlertsScreen user={user} />}
                {activeTab === 'branches' && <ErrorBoundary><BranchesScreen user={user} /></ErrorBoundary>}
              </>
            )}
          </div>
        </div>

        {/* Global Free 24/7 Support & Upgrade Chat Widget */}
        <SupportChatWidget user={user} />
      </main>
    </div>
  );
}

function SidebarButton({ active, onClick, icon, label, badge, badges }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-150 relative ${
        active 
          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-extrabold shadow-md shadow-emerald-950/40' 
          : 'text-slate-300 hover:text-white hover:bg-slate-800/80 font-bold'
      }`}
    >
      <div className="flex items-center justify-center shrink-0">
        {icon}
      </div>
      <span className="text-xs tracking-wide truncate">{label}</span>
      
      {badge !== null && badge !== undefined && !badges && (
        <span className="ml-auto bg-rose-500 text-white font-mono text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse">
          {badge}
        </span>
      )}

      {badges && badges.length > 0 && (
        <div className="ml-auto flex gap-1 shrink-0">
          {badges.map((b, i) => (
            <span key={i} className={`${b.className} font-mono text-[10px] px-2 py-0.5 rounded-full shadow-sm`}>
              {b.count}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
