import React from 'react';

export default function EmptyState({ type, message }) {
  const getIllustration = () => {
    switch (type) {
      case 'inventory':
        return (
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-32 h-24 mx-auto mb-4">
            {/* Shelf */}
            <rect x="20" y="100" width="160" height="8" rx="2" fill="#C9C9B3" />
            <rect x="20" y="60" width="160" height="8" rx="2" fill="#C9C9B3" />
            {/* Medicine bottles */}
            <rect x="35" y="70" width="16" height="30" rx="2" fill="#1B7A43" opacity="0.6" />
            <rect x="35" y="65" width="16" height="5" rx="1" fill="#1B7A43" />
            <rect x="60" y="70" width="16" height="30" rx="2" fill="#1B7A43" opacity="0.4" />
            <rect x="60" y="65" width="16" height="5" rx="1" fill="#1B7A43" />
            <rect x="85" y="70" width="16" height="30" rx="2" fill="#1B7A43" opacity="0.5" />
            <rect x="85" y="65" width="16" height="5" rx="1" fill="#1B7A43" />
            {/* Empty space indicator */}
            <path d="M120 75 L140 75 L140 95 L120 95 Z" fill="none" stroke="#C9C9B3" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M125 80 L135 80 M125 85 L135 85 M125 90 L135 90" stroke="#C9C9B3" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
      case 'categories':
        return (
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-32 h-24 mx-auto mb-4">
            {/* Folder structure */}
            <rect x="30" y="40" width="60" height="45" rx="4" fill="#EAEAE0" stroke="#C9C9B3" strokeWidth="2" />
            <rect x="35" y="45" width="50" height="8" rx="2" fill="#1B7A43" opacity="0.3" />
            <rect x="35" y="58" width="35" height="6" rx="2" fill="#C9C9B3" />
            <rect x="35" y="68" width="40" height="6" rx="2" fill="#C9C9B3" />
            {/* Empty folder */}
            <rect x="110" y="40" width="60" height="45" rx="4" fill="none" stroke="#C9C9B3" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M125 60 L135 60 M125 68 L135 68 M125 76 L135 76" stroke="#C9C9B3" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
      case 'suppliers':
        return (
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-32 h-24 mx-auto mb-4">
            {/* Truck */}
            <rect x="40" y="60" width="80" height="40" rx="4" fill="#1B7A43" opacity="0.5" />
            <rect x="45" y="65" width="30" height="30" rx="2" fill="#1B7A43" opacity="0.3" />
            <circle cx="60" cy="105" r="8" fill="#C9C9B3" />
            <circle cx="100" cy="105" r="8" fill="#C9C9B3" />
            {/* Empty indicator */}
            <path d="M140 70 L160 70 L160 90 L140 90 Z" fill="none" stroke="#C9C9B3" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M145 75 L155 75 M145 80 L155 80 M145 85 L155 85" stroke="#C9C9B3" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
      case 'sales':
        return (
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-32 h-24 mx-auto mb-4">
            {/* Receipt */}
            <rect x="50" y="30" width="50" height="70" rx="2" fill="#EAEAE0" stroke="#C9C9B3" strokeWidth="2" />
            <path d="M50 35 L100 35 M55 45 L95 45 M55 52 L95 52 M55 59 L80 59" stroke="#C9C9B3" strokeWidth="1.5" strokeLinecap="round" />
            {/* Empty receipt */}
            <rect x="110" y="30" width="50" height="70" rx="2" fill="none" stroke="#C9C9B3" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M115 45 L155 45 M115 52 L155 52 M115 59 L155 59 M115 66 L155 66" stroke="#C9C9B3" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
      case 'users':
        return (
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-32 h-24 mx-auto mb-4">
            {/* User silhouette */}
            <circle cx="70" cy="55" r="18" fill="#1B7A43" opacity="0.5" />
            <path d="M40 100 Q70 70 100 100" stroke="#1B7A43" strokeWidth="3" fill="none" opacity="0.5" />
            {/* Empty user */}
            <circle cx="130" cy="55" r="18" fill="none" stroke="#C9C9B3" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M100 100 Q130 70 160 100" stroke="#C9C9B3" strokeWidth="2" strokeDasharray="4 4" fill="none" />
            <path d="M125 50 L135 50 M125 55 L135 55 M125 60 L135 60" stroke="#C9C9B3" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-32 h-24 mx-auto mb-4">
            <circle cx="100" cy="60" r="25" fill="none" stroke="#C9C9B3" strokeWidth="2" />
            <path d="M85 95 Q100 75 115 95" stroke="#C9C9B3" strokeWidth="2" fill="none" />
            <path d="M95 55 L105 55 M100 50 L100 60" stroke="#C9C9B3" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      {getIllustration()}
      <p className="text-ink/60 text-sm">{message}</p>
    </div>
  );
}
