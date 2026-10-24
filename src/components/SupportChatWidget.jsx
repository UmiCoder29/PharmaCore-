import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  X, 
  Send, 
  Sparkles, 
  HelpCircle, 
  CheckCircle2, 
  RefreshCw, 
  Headphones,
  Zap,
  ArrowUpRight,
  ShieldCheck,
  Building
} from 'lucide-react';

export default function SupportChatWidget({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [inquiryType, setInquiryType] = useState('general');
  const [requestedPlan, setRequestedPlan] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState('');
  const messagesEndRef = useRef(null);

  const isSuperAdmin = user?.role === 'superadmin';

  const fetchMessages = async () => {
    if (!user?.pharmacyId || isSuperAdmin) return;
    try {
      const history = await window.pharmacoreAPI.getPharmacyInquiries();
      const list = history || [];
      setMessages(list);

      // Unread count for pharmacy
      const unread = list.filter(m => !m.isReadByPharmacy && m.senderRole === 'superadmin').length;
      setUnreadCount(unread);
    } catch (_) {}
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 6000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      if (unreadCount > 0) {
        window.pharmacoreAPI.markPharmacyInquiriesRead().catch(() => {});
        setUnreadCount(0);
      }
    }
  }, [isOpen, messages]);

  if (isSuperAdmin) return null; // SuperAdmin uses SaasChatScreen full dashboard

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;

    setSending(true);
    setSentSuccess('');
    try {
      await window.pharmacoreAPI.sendPharmacyInquiry(
        inputText.trim(),
        inquiryType,
        requestedPlan || null
      );
      setInputText('');
      setSentSuccess('Sent to Support!');
      setTimeout(() => setSentSuccess(''), 3000);
      await fetchMessages();
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      console.error('Error sending support message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleQuickTopic = (type, prompt, plan = '') => {
    setInquiryType(type);
    setInputText(prompt);
    if (plan) setRequestedPlan(plan);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {/* Floating Toggle Button (Compact & Non-intrusive) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="w-12 h-12 bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white rounded-full shadow-2xl flex items-center justify-center transition-all duration-200 hover:scale-110 group border-2 border-emerald-400/40 relative"
          title="Customer Support & Upgrades"
          aria-label="Open Support Chat"
        >
          <Headphones className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-mono text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-black animate-bounce shadow-md">
              {unreadCount}
            </span>
          )}
          {/* Hover Tooltip */}
          <span className="absolute right-14 bg-slate-900 text-white text-xs font-bold py-1.5 px-3 rounded-xl shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 border border-slate-700">
            Live Support & Upgrades
          </span>
        </button>
      )}

      {/* Floating Chat Modal */}
      {isOpen && (
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-[380px] sm:w-[420px] flex flex-col h-[560px] overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          {/* Header */}
          <div className="bg-slate-950 text-white p-4 flex items-center justify-between border-b border-slate-800 relative overflow-hidden">
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
                <Headphones className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-black text-sm text-white tracking-tight flex items-center gap-1.5">
                  <span>PharmaCore Live Support</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </h3>
                <p className="text-[10px] text-emerald-300 font-mono">
                  {user?.pharmacyName || 'Your Pharmacy'} • Free 24/7 Chat
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 relative z-10">
              <button
                onClick={fetchMessages}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
                title="Refresh messages"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Action Chips */}
          <div className="p-2.5 bg-slate-50 border-b border-slate-200/70 flex gap-1.5 overflow-x-auto custom-scrollbar">
            <button
              onClick={() => handleQuickTopic('upgrade', 'Hi, we would like to upgrade our subscription plan.', 'professional')}
              className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 hover:text-emerald-800 border border-emerald-200 rounded-full text-[10px] font-bold shrink-0 transition-all shadow-2xs"
            >
              🚀 Upgrade Plan
            </button>
            <button
              onClick={() => handleQuickTopic('branch_limit', 'Hi, we need to add 2 additional branch locations to our account.')}
              className="px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-700 hover:text-blue-800 border border-blue-200 rounded-full text-[10px] font-bold shrink-0 transition-all shadow-2xs"
            >
              🏢 Add Branches
            </button>
            <button
              onClick={() => handleQuickTopic('billing', 'Could you please send us our renewal invoice and payment instructions?')}
              className="px-2.5 py-1 bg-white hover:bg-purple-50 text-purple-700 hover:text-purple-800 border border-purple-200 rounded-full text-[10px] font-bold shrink-0 transition-all shadow-2xs"
            >
              💳 Billing Help
            </button>
            <button
              onClick={() => handleQuickTopic('general', 'I have a question regarding POS and inventory management.')}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-full text-[10px] font-bold shrink-0 transition-all shadow-2xs"
            >
              ❓ General Query
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 custom-scrollbar bg-slate-100/50">
            {messages.length === 0 ? (
              <div className="text-center py-10 space-y-2 text-slate-400">
                <Sparkles className="w-8 h-8 mx-auto text-emerald-500/70" />
                <p className="text-xs font-bold text-slate-700">Need help or want to upgrade?</p>
                <p className="text-[11px] max-w-[240px] mx-auto text-slate-500">
                  Send a message below. Our platform support team replies directly in this chat!
                </p>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isSuperAdminSender = m.senderRole === 'superadmin';
                return (
                  <div
                    key={m.id || idx}
                    className={`flex flex-col ${isSuperAdminSender ? 'items-start' : 'items-end'}`}
                  >
                    <div className="flex items-center gap-1.5 text-[9px] text-slate-400 mb-0.5 px-1">
                      <span className="font-bold text-slate-600">
                        {isSuperAdminSender ? '🛡️ PharmaCore Platform Support' : m.senderName}
                      </span>
                      <span>•</span>
                      <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div className={`max-w-[85%] rounded-2xl p-3 text-xs font-medium leading-relaxed shadow-sm ${
                      isSuperAdminSender
                        ? 'bg-emerald-600 text-white rounded-tl-none'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-tr-none'
                    }`}>
                      {m.requestedPlan && !isSuperAdminSender && (
                        <div className="mb-1">
                          <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-mono font-bold uppercase rounded">
                            Target: {m.requestedPlan} Plan
                          </span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{m.message}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer Input */}
          <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-200 space-y-2">
            {sentSuccess && (
              <div className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{sentSuccess}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Ask support or request plan upgrade..."
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                className="flex-1 bg-slate-100 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-medium outline-none focus:border-emerald-500 focus:bg-white transition-all"
              />

              <button
                type="submit"
                disabled={sending || !inputText.trim()}
                className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl transition-all shadow-md disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
