import { useId } from 'react';

/** The PixGen Pilot mark: a navigation arrow (the pilot) heading to a pixel sending signal rings. */
export function LogoMark({ className = 'h-9 w-9' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="8" y1="40" x2="40" y2="8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00A3FF" />
          <stop offset="1" stopColor="#872AFF" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="7" y1="41" x2="25" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7CCBFF" />
          <stop offset="1" stopColor="#FFFFFF" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="#0B0F19" />
      <path d="M27.06 11.76 A7.5 7.5 0 0 1 36.24 20.94" stroke={`url(#${id}g)`} strokeWidth="2.6" strokeLinecap="round" opacity=".75" />
      <path d="M25.89 7.41 A12 12 0 0 1 40.59 22.11" stroke={`url(#${id}g)`} strokeWidth="2.6" strokeLinecap="round" opacity=".4" />
      <rect x="25.6" y="15.6" width="6.8" height="6.8" rx="1.7" transform="rotate(45 29 19)" fill={`url(#${id}g)`} />
      <path d="M24.6 23.4 L7.2 30.6 L14.9 33.1 L17.4 40.8 Z" fill={`url(#${id}w)`} />
    </svg>
  );
}

/** Mark + "PixGen Pilot" wordmark. `light` is for dark backgrounds. */
export function Logo({ light = false, size = 'md' }) {
  const mark = size === 'lg' ? 'h-12 w-12' : 'h-9 w-9';
  const text = size === 'lg' ? 'text-[26px]' : 'text-[21px]';
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={`${mark} shrink-0 ${light ? 'ring-1 ring-white/10 rounded-xl' : ''}`} />
      <span className={`font-display font-bold leading-none tracking-tight ${text}`}>
        <span className={light ? 'text-white' : 'text-ink'}>PixGen</span>{' '}
        <span className={`bg-gradient-to-r bg-clip-text text-transparent ${light ? 'from-[#38B6FF] to-[#A673FF]' : 'from-pilot to-violet'}`}>Pilot</span>
      </span>
    </div>
  );
}
