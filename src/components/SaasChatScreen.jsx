import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Send, 
  Store, 
  Sparkles, 
  Clock, 
  CheckCheck, 
  ArrowUpRight, 
  ShieldCheck, 
  RefreshCw,
  Search,
  Filter,
  CreditCard,
  Building,
  CheckCircle2,
  Calendar
} from 'lucide-react';

export default function SaasChatScreen({ user }) {
  const [inquiries, setInquiries] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all'); // all, upgrade, billing
  const messagesEndRef = useRef(null);

  const fetchInquiries = async () => {
    try {
      const data = await window.pharmacoreAPI.getSaasInquiries();
      setInquiries(data || []);
    } catch (err) {
      console.error('Failed to load inquiries:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInquiries();
    const interval = setInterval(fetchInquiries, 4000); // Live poll every 4s
    return () => clearInterval(interval);
  }, []);

  // Group inquiries by pharmacy
  const pharmacyMap = {};
  inquiries.forEach(inq => {
    if (!inq.pharmacyId) return;
    if (!pharmacyMap[inq.pharmacyId]) {
      pharmacyMap[inq.pharmacyId] = {
        id: inq.pharmacyId,
        pharmacy: inq.pharmacy || { name: 'Unknown Pharmacy', planTier: 'trial' },
        messages: [],
        lastMessage: inq,
        unreadCount: 0
      };
    }
    pharmacyMap[inq.pharmacyId].messages.push(inq);
    if (!inq.isReadBySuperadmin && inq.senderRole !== 'superadmin') {
      pharmacyMap[inq.pharmacyId].unreadCount++;
    }
    pharmacyMap[inq.pharmacyId].lastMessage = inq;
  });

  const pharmacyThreads = Object.values(pharmacyMap).sort((a, b) => 
    new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt)
  );

  // Auto-select first thread if none selected
  useEffect(() => {
    if (!selectedPharmacyId && pharmacyThreads.length > 0) {
      setSelectedPharmacyId(pharmacyThreads[0].id);
    }
  }, [pharmacyThreads.length]);

  // Mark as read when selected
  useEffect(() => {
    if (selectedPharmacyId) {
      window.pharmacoreAPI.markSaasInquiriesRead(selectedPharmacyId).catch(console.error);
    }
  }, [selectedPharmacyId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedPharmacyId, inquiries]);

  const activeThread = selectedPharmacyId ? pharmacyMap[selectedPharmacyId] : null;

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedPharmacyId || sending) return;

    setSending(true);
    try {
      await window.pharmacoreAPI.sendSaasReply(selectedPharmacyId, replyText.trim(), 'upgrade');
      setReplyText('');
      await fetchInquiries();
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setSending(false);
    }
  };

  const handleQuickUpgrade = async (planTier) => {
    if (!selectedPharmacyId) return;
    try {
      await window.pharmacoreAPI.updatePharmacySubscription(selectedPharmacyId, {
        planTier,
        subscriptionStatus: 'active',
        maxBranches: planTier === 'enterprise' ? 50 : (planTier === 'professional' ? 5 : 1),
        maxUsers: planTier === 'enterprise' ? 100 : (planTier === 'professional' ? 15 : 3)
      });
      // Send auto confirmation reply in chat
      await window.pharmacoreAPI.sendSaasReply(
        selectedPharmacyId,
        `🎉 Your subscription has been successfully upgraded to the ${planTier.toUpperCase()} Plan! All feature and quota limits have been refreshed.`,
        'upgrade'
      );
      fetchInquiries();
    } catch (err) {
      console.error('Failed to upgrade pharmacy plan:', err);
    }
  };

  const handleExtendDays = async (days) => {
    if (!selectedPharmacyId) return;
    try {
      const endsAt = new Date();
      endsAt.setDate(endsAt.getDate() + days);
      await window.pharmacoreAPI.updatePharmacySubscription(selectedPharmacyId, {
        subscriptionStatus: 'active',
        subscriptionEndsAt: endsAt.toISOString()
      });
      await window.pharmacoreAPI.sendSaasReply(
        selectedPharmacyId,
        `✅ Your subscription has been extended by +${days} days (valid until ${endsAt.toLocaleDateString()}).`,
        'upgrade'
      );
      fetchInquiries();
    } catch (err) {
      console.error('Failed to extend days:', err);
    }
  };

  const filteredThreads = pharmacyThreads.filter(t => {
    const matchesSearch = (t.pharmacy?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (t.lastMessage?.message || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-ink tracking-tight">Pharmacy Upgrade & Inquiries Hub</h1>
            <span className="px-2.5 py-0.5 bg-emerald/10 text-emerald rounded-full text-xs font-mono font-bold">
              Live SaaS Chat
            </span>
          </div>
          <p className="text-xs font-semibold text-ink/60 mt-0.5">
            Direct communication channel with pharmacy owners for plan upgrades, licensing renewals, and quotes.
          </p>
        </div>

        <button
          onClick={fetchInquiries}
          className="px-3 py-2 bg-white hover:bg-slate-50 border border-ink/10 rounded-xl text-xs font-bold text-ink flex items-center gap-2 shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5 text-emerald" />
          <span>Refresh Messages</span>
        </button>
      </div>

      {/* Main Split Chat Layout */}
      <div className="flex-1 bg-white rounded-3xl border border-ink/10 shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-12">
        {/* Left: Pharmacy Conversation List */}
        <div className="md:col-span-4 border-r border-ink/10 flex flex-col bg-slate-50/50">
          {/* Search Header */}
          <div className="p-3.5 border-b border-ink/10 bg-white">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
              <input
                type="text"
                placeholder="Search pharmacy or messages..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-100/70 border border-ink/10 rounded-xl pl-8 pr-3 py-2 text-xs font-medium outline-none focus:border-emerald"
              />
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
            {filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-ink/40 text-xs">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No pharmacy upgrade inquiries yet.
              </div>
            ) : (
              filteredThreads.map(thread => {
                const isSelected = thread.id === selectedPharmacyId;
                return (
                  <button
                    key={thread.id}
                    onClick={() => setSelectedPharmacyId(thread.id)}
                    className={`w-full text-left p-3.5 rounded-2xl transition-all border ${
                      isSelected
                        ? 'bg-emerald text-white border-emerald shadow-md'
                        : 'bg-white hover:bg-slate-100/80 border-ink/5 text-ink'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <Store className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-emerald'}`} />
                        <span className={`text-xs font-black truncate ${isSelected ? 'text-white' : 'text-ink'}`}>
                          {thread.pharmacy?.name || 'Pharmacy Client'}
                        </span>
                      </div>
                      <span className={`text-[10px] font-mono capitalize px-2 py-0.5 rounded-full ${
                        isSelected 
                          ? 'bg-white/20 text-white' 
                          : thread.pharmacy?.planTier === 'enterprise' 
                            ? 'bg-purple-100 text-purple-800 font-bold'
                            : thread.pharmacy?.planTier === 'professional'
                            ? 'bg-emerald/10 text-emerald font-bold'
                            : 'bg-blue-100 text-blue-800 font-bold'
                      }`}>
                        {thread.pharmacy?.planTier || 'trial'}
                      </span>
                    </div>

                    <p className={`text-[11px] line-clamp-2 mt-1 ${isSelected ? 'text-emerald-50/90' : 'text-ink/60'}`}>
                      {thread.lastMessage?.senderRole === 'superadmin' ? 'You: ' : ''}
                      {thread.lastMessage?.message}
                    </p>

                    <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/10 text-[10px]">
                      <span className={isSelected ? 'text-white/70' : 'text-ink/40'}>
                        {new Date(thread.lastMessage?.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {thread.unreadCount > 0 && !isSelected && (
                        <span className="px-2 py-0.5 bg-rose-500 text-white font-mono font-black rounded-full">
                          {thread.unreadCount} new
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Active Chat Thread & Action Controls */}
        <div className="md:col-span-8 flex flex-col bg-white">
          {activeThread ? (
            <>
              {/* Chat Thread Header with 1-Click Upgrade Actions */}
              <div className="p-4 border-b border-ink/10 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald/10 text-emerald flex items-center justify-center font-bold">
                    <Store className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-ink text-sm">{activeThread.pharmacy?.name}</h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 text-slate-800 capitalize">
                        {activeThread.pharmacy?.planTier} Plan
                      </span>
                    </div>
                    <p className="text-[11px] text-ink/50">
                      {activeThread.pharmacy?.contactPhone || activeThread.pharmacy?.contactEmail || 'Pharmacy Owner'}
                    </p>
                  </div>
                </div>

                {/* 1-Click Fast Actions for SuperAdmin */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => handleQuickUpgrade('professional')}
                    className="px-3 py-1.5 bg-emerald hover:bg-emerald/90 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                    title="Upgrade this client to Professional Plan"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Set Professional</span>
                  </button>

                  <button
                    onClick={() => handleQuickUpgrade('enterprise')}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                    title="Upgrade this client to Enterprise Plan"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Set Enterprise</span>
                  </button>

                  <button
                    onClick={() => handleExtendDays(30)}
                    className="px-3 py-1.5 bg-white border border-ink/20 hover:bg-ink hover:text-white text-ink rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                    title="Extend validity by 30 days"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>+30 Days</span>
                  </button>
                </div>
              </div>

              {/* Message History */}
              <div className="flex-1 p-6 overflow-y-auto space-y-4 custom-scrollbar bg-slate-50/20">
                {activeThread.messages.map((msg, index) => {
                  const isMe = msg.senderRole === 'superadmin';
                  return (
                    <div
                      key={msg.id || index}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-ink/40 mb-1 px-1">
                        <span className="font-bold text-ink/70">{msg.senderName}</span>
                        <span>•</span>
                        <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      <div className={`max-w-lg rounded-2xl p-4 text-xs font-medium leading-relaxed shadow-sm ${
                        isMe
                          ? 'bg-ink text-white rounded-tr-none'
                          : 'bg-white border border-ink/10 text-ink rounded-tl-none ring-1 ring-black/5'
                      }`}>
                        {msg.requestedPlan && (
                          <div className="mb-2 pb-2 border-b border-white/20 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald/20 text-emerald font-bold rounded-lg uppercase text-[10px]">
                            <Sparkles className="w-3 h-3" />
                            <span>Requested Plan Upgrade: {msg.requestedPlan}</span>
                          </div>
                        )}
                        <p>{msg.message}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendReply} className="p-4 border-t border-ink/10 bg-white flex items-center gap-3">
                <input
                  type="text"
                  placeholder={`Reply to ${activeThread.pharmacy?.name}... (e.g. quote, upgrade confirmation, bank details)`}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  disabled={sending}
                  className="flex-1 bg-slate-100/70 border border-ink/10 rounded-2xl px-4 py-3 text-xs font-medium outline-none focus:border-emerald focus:bg-white transition-all"
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="px-5 py-3 bg-emerald hover:bg-emerald/90 text-white rounded-2xl text-xs font-bold transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Reply</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-ink/40 p-8 text-center">
              <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
              <h3 className="font-bold text-ink text-sm">Select a Pharmacy Conversation</h3>
              <p className="text-xs text-ink/50 max-w-sm mt-1">
                Choose a pharmacy client from the left pane to view their upgrade requests and discuss plan pricing.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
