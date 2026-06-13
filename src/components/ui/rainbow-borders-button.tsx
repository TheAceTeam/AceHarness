'use client';

import React from 'react';
import { cn } from '@/lib/core/utils';

interface RainbowBordersButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const RainbowBordersButton = React.forwardRef<HTMLButtonElement, RainbowBordersButtonProps>(
  ({ children, className, disabled, ...props }, ref) => (
    <>
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'rainbow-border relative flex h-10 w-[140px] items-center justify-center gap-2.5 rounded-xl border-none bg-black px-4 font-black text-white transition-all duration-200',
          'enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      >
        {children}
      </button>

      <style jsx>{`
        .rainbow-border::before,
        .rainbow-border::after {
          content: '';
          position: absolute;
          left: -2px;
          top: -2px;
          border-radius: 12px;
          background: linear-gradient(45deg, #fb0094, #0000ff, #00ff00, #ffff00, #ff0000, #fb0094, #0000ff, #00ff00, #ffff00, #ff0000);
          background-size: 400%;
          width: calc(100% + 4px);
          height: calc(100% + 4px);
          z-index: -1;
          animation: rainbow 20s linear infinite;
        }
        .rainbow-border::after {
          filter: blur(50px);
        }
        @keyframes rainbow {
          0% { background-position: 0 0; }
          50% { background-position: 400% 0; }
          100% { background-position: 0 0; }
        }
      `}</style>
    </>
  ),
);

RainbowBordersButton.displayName = 'RainbowBordersButton';
