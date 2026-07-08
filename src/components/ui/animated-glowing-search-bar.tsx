'use client';

import React, { type KeyboardEvent } from 'react';
import { cn } from '@/lib/core/utils';

interface AnimatedGlowingSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  onFilterClick?: () => void;
  filterActive?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const AnimatedGlowingSearchBar = ({
  value,
  onChange,
  onEnter,
  onFilterClick,
  filterActive = false,
  placeholder = 'Search...',
  disabled = false,
  className,
}: AnimatedGlowingSearchBarProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter?.();
    }
  };

  return (
    <div className={cn('relative flex min-w-0 items-center justify-center', className)}>
      <div id="poda" className="office-search-shell group relative flex w-full min-w-0 items-center justify-center">
        <div className="office-search-glow-layer office-search-glow-primary absolute z-[-1] h-full max-h-[70px] w-full overflow-hidden rounded-xl blur-[3px] before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[999px] before:w-[999px] before:-translate-x-1/2 before:-translate-y-1/2 before:bg-[conic-gradient(#000,#402fb5_5%,#000_38%,#000_50%,#cf30aa_60%,#000_87%)] before:bg-no-repeat before:content-['']" />
        <div className="office-search-glow-layer office-search-glow-secondary absolute z-[-1] h-full max-h-[65px] w-full overflow-hidden rounded-xl blur-[3px] before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:bg-[conic-gradient(rgba(0,0,0,0),#18116a,rgba(0,0,0,0)_10%,rgba(0,0,0,0)_50%,#6e1b60,rgba(0,0,0,0)_60%)] before:bg-no-repeat before:content-['']" />
        <div className="office-search-glow-layer office-search-glow-secondary office-search-glow-slow absolute z-[-1] h-full max-h-[65px] w-full overflow-hidden rounded-xl blur-[3px] before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:bg-[conic-gradient(rgba(0,0,0,0),#18116a,rgba(0,0,0,0)_10%,rgba(0,0,0,0)_50%,#6e1b60,rgba(0,0,0,0)_60%)] before:bg-no-repeat before:content-['']" />
        <div className="office-search-glow-layer office-search-glow-secondary office-search-glow-reverse absolute z-[-1] h-full max-h-[65px] w-full overflow-hidden rounded-xl blur-[3px] before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:bg-[conic-gradient(rgba(0,0,0,0),#18116a,rgba(0,0,0,0)_10%,rgba(0,0,0,0)_50%,#6e1b60,rgba(0,0,0,0)_60%)] before:bg-no-repeat before:content-['']" />
        <div className="office-search-glow-layer office-search-glow-soft absolute z-[-1] h-full max-h-[63px] w-full overflow-hidden rounded-lg blur-[2px] before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:bg-[conic-gradient(rgba(0,0,0,0)_0%,#a099d8,rgba(0,0,0,0)_8%,rgba(0,0,0,0)_50%,#dfa2da,rgba(0,0,0,0)_58%)] before:bg-no-repeat before:brightness-[1.4] before:content-['']" />
        <div className="office-search-glow-layer office-search-glow-inner absolute z-[-1] h-full max-h-[59px] w-full overflow-hidden rounded-xl blur-[0.5px] before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:bg-[conic-gradient(#1c191c,#402fb5_5%,#1c191c_14%,#1c191c_50%,#cf30aa_60%,#1c191c_64%)] before:bg-no-repeat before:brightness-[1.3] before:content-['']" />

        <div id="main" className="group relative w-full min-w-0">
          <input
            placeholder={placeholder}
            type="text"
            name="office-team-goal"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-14 w-full rounded-lg border-none bg-[#010201] px-[59px] text-base font-medium text-white outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-70 sm:text-lg"
          />
          <div id="pink-mask" className="pointer-events-none absolute left-[5px] top-2.5 h-5 w-[30px] bg-[#cf30aa] opacity-80 blur-2xl transition-all duration-2000 group-hover:opacity-0" />
          <button
            id="filter-icon"
            type="button"
            className={`absolute right-[7px] top-[7px] z-[2] h-[42px] w-10 cursor-pointer overflow-hidden rounded-lg border ${filterActive ? 'border-cyan-300/70 shadow-[0_0_18px_rgba(34,211,238,0.42)]' : 'border-transparent'} before:absolute before:left-1/2 before:top-1/2 before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:animate-spin before:rotate-90 before:bg-[conic-gradient(rgba(0,0,0,0),#3d3a4f,rgba(0,0,0,0)_50%,rgba(0,0,0,0)_50%,#3d3a4f,rgba(0,0,0,0)_100%)] before:bg-no-repeat before:brightness-[1.35] before:content-[''] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60`}
            aria-label="选择候选 Agent"
            aria-pressed={filterActive}
            disabled={disabled || !onFilterClick}
            onClick={onFilterClick}
          >
            <span className="absolute inset-px flex items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-[#161329] via-black to-[#1d1b4b] [isolation:isolate]">
              <svg preserveAspectRatio="none" height="27" width="27" viewBox="4.8 4.56 14.832 15.408" fill="none">
                <path d="M8.16 6.65002H15.83C16.47 6.65002 16.99 7.17002 16.99 7.81002V9.09002C16.99 9.56002 16.7 10.14 16.41 10.43L13.91 12.64C13.56 12.93 13.33 13.51 13.33 13.98V16.48C13.33 16.83 13.1 17.29 12.81 17.47L12 17.98C11.24 18.45 10.2 17.92 10.2 16.99V13.91C10.2 13.5 9.97 12.98 9.73 12.69L7.52 10.36C7.23 10.08 7 9.55002 7 9.20002V7.87002C7 7.17002 7.52 6.65002 8.16 6.65002Z" stroke="#d6d6e6" strokeWidth="1" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          <div id="search-icon" className="absolute left-5 top-[15px]">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" viewBox="0 0 24 24" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" height="24" fill="none" className="feather feather-search">
              <circle stroke="url(#search)" r="8" cy="11" cx="11" />
              <line stroke="url(#searchl)" y2="16.65" y1="22" x2="16.65" x1="22" />
              <defs>
                <linearGradient gradientTransform="rotate(50)" id="search">
                  <stop stopColor="#f8e7f8" offset="0%" />
                  <stop stopColor="#b6a9b7" offset="50%" />
                </linearGradient>
                <linearGradient id="searchl">
                  <stop stopColor="#b6a9b7" offset="0%" />
                  <stop stopColor="#837484" offset="50%" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
      <style>{`
        .office-search-shell {
          transition: filter 220ms ease, transform 220ms ease;
        }
        .office-search-shell:hover,
        .office-search-shell:focus-within {
          filter: brightness(1.08) saturate(1.08);
        }
        .office-search-glow-layer {
          opacity: 0.78;
          transition: opacity 220ms ease;
        }
        .office-search-shell:hover .office-search-glow-layer,
        .office-search-shell:focus-within .office-search-glow-layer {
          opacity: 0.92;
        }
        .office-search-glow-layer::before {
          --search-glow-start: 82deg;
          animation: officeSearchFlow 22s linear infinite;
          transform: translate(-50%, -50%) rotate(var(--search-glow-start));
          transform-origin: center;
        }
        .office-search-glow-primary::before {
          --search-glow-start: 60deg;
          animation-duration: 28s;
        }
        .office-search-glow-slow::before {
          animation-duration: 34s;
        }
        .office-search-glow-reverse::before {
          animation-direction: reverse;
          animation-duration: 31s;
        }
        .office-search-glow-soft::before {
          --search-glow-start: 83deg;
          animation-duration: 26s;
        }
        .office-search-glow-inner::before {
          --search-glow-start: 70deg;
          animation-duration: 30s;
        }
        @keyframes officeSearchFlow {
          from {
            transform: translate(-50%, -50%) rotate(var(--search-glow-start));
          }
          to {
            transform: translate(-50%, -50%) rotate(calc(var(--search-glow-start) + 360deg));
          }
        }
      `}</style>
    </div>
  );
};

export default AnimatedGlowingSearchBar;
