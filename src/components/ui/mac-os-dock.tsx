'use client';

import React, { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  motion,
  useAnimationControls,
  useMotionValue,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { cn } from '@/lib/core/utils';

export interface DockApp {
  id: string;
  name: string;
  icon: string | ReactNode;
}

interface MacOSDockProps {
  apps: DockApp[];
  onAppClick: (appId: string) => void;
  openApps?: string[];
  className?: string;
  surfaceClassName?: string;
  tooltipClassName?: string;
}

type DockConfig = {
  baseIconSize: number;
  maxScale: number;
  effectWidth: number;
};

function getResponsiveConfig(): DockConfig {
  if (typeof window === 'undefined') {
    return { baseIconSize: 64, maxScale: 1.72, effectWidth: 300 };
  }

  const smallerDimension = Math.min(window.innerWidth, window.innerHeight);

  if (smallerDimension < 480) {
    return {
      baseIconSize: Math.max(40, smallerDimension * 0.08),
      maxScale: 1.36,
      effectWidth: smallerDimension * 0.38,
    };
  }

  if (smallerDimension < 768) {
    return {
      baseIconSize: Math.max(48, smallerDimension * 0.07),
      maxScale: 1.45,
      effectWidth: smallerDimension * 0.34,
    };
  }

  if (smallerDimension < 1024) {
    return {
      baseIconSize: Math.max(56, smallerDimension * 0.06),
      maxScale: 1.6,
      effectWidth: smallerDimension * 0.3,
    };
  }

  return {
    baseIconSize: Math.max(64, Math.min(78, smallerDimension * 0.05)),
    maxScale: 1.72,
    effectWidth: 320,
  };
}

function calculateSize(distance: number, config: DockConfig) {
  const radius = config.effectWidth / 2;
  const absDistance = Math.abs(distance);

  if (absDistance >= radius) {
    return config.baseIconSize;
  }

  const factor = (1 + Math.cos((absDistance / radius) * Math.PI)) / 2;
  const scale = 1 + factor * (config.maxScale - 1);
  return config.baseIconSize * scale;
}

function DockIcon({
  app,
  mouseX,
  config,
  isOpen,
  onAppClick,
  tooltipClassName,
}: {
  app: DockApp;
  mouseX: MotionValue<number>;
  config: DockConfig;
  isOpen: boolean;
  onAppClick: (appId: string) => void;
  tooltipClassName: string;
}) {
  const iconRef = useRef<HTMLButtonElement>(null);
  const controls = useAnimationControls();

  const targetSize = useTransform(mouseX, (latest) => {
    if (!iconRef.current || !Number.isFinite(latest)) {
      return config.baseIconSize;
    }

    const rect = iconRef.current.getBoundingClientRect();
    const distance = latest - rect.left - (rect.width / 2);
    return calculateSize(distance, config);
  });

  const handleClick = async () => {
    await controls.start({
      y: [0, -Math.max(8, config.baseIconSize * 0.16), 0],
      transition: { duration: 0.26, ease: 'easeOut' },
    });
    onAppClick(app.id);
  };

  return (
    <motion.button
      ref={iconRef}
      type="button"
      className="group relative flex shrink-0 cursor-pointer items-center justify-center overflow-visible rounded-[22%] border-0 bg-transparent p-0 focus-visible:outline-none"
      style={{ width: targetSize, height: targetSize }}
      animate={controls}
      aria-label={app.name}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 translate-y-1 rounded-full px-2.5 py-1 text-xs font-semibold opacity-0 shadow-lg backdrop-blur transition-all duration-100 group-hover:-translate-y-1 group-hover:opacity-100 group-focus-visible:-translate-y-1 group-focus-visible:opacity-100',
          tooltipClassName,
        )}
        style={{ bottom: 'calc(100% + 0.75rem)' }}
      >
        <span className="whitespace-nowrap">{app.name}</span>
      </span>

      {typeof app.icon === 'string' ? (
        <img
          src={app.icon}
          alt={app.name}
          className="h-full w-full object-contain drop-shadow-[0_8px_16px_rgba(15,23,42,0.24)]"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center drop-shadow-[0_8px_16px_rgba(15,23,42,0.24)]">
          {app.icon}
        </span>
      )}

      {isOpen ? (
        <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/90 shadow-[0_0_4px_rgba(0,0,0,0.35)]" />
      ) : null}
    </motion.button>
  );
}

const MacOSDock: React.FC<MacOSDockProps> = ({
  apps,
  onAppClick,
  openApps = [],
  className = '',
  surfaceClassName = '',
  tooltipClassName = '',
}) => {
  const [config, setConfig] = useState<DockConfig>(getResponsiveConfig);
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY);

  useEffect(() => {
    const handleResize = () => {
      setConfig(getResponsiveConfig());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    mouseX.set(event.clientX);
  }, [mouseX]);

  const handleMouseLeave = useCallback(() => {
    mouseX.set(Number.POSITIVE_INFINITY);
  }, [mouseX]);

  const padding = Math.max(8, config.baseIconSize * 0.12);
  const gap = Math.max(4, config.baseIconSize * 0.08);

  return (
    <div
      className={cn('overflow-visible backdrop-blur-md', surfaceClassName, className)}
      style={{
        borderRadius: `${Math.max(12, config.baseIconSize * 0.4)}px`,
        padding: `${padding}px`,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="flex items-end overflow-visible"
        style={{
          gap: `${gap}px`,
          height: `${config.baseIconSize}px`,
        }}
      >
        {apps.map((app) => (
          <DockIcon
            key={app.id}
            app={app}
            mouseX={mouseX}
            config={config}
            isOpen={openApps.includes(app.id)}
            onAppClick={onAppClick}
            tooltipClassName={tooltipClassName}
          />
        ))}
      </div>
    </div>
  );
};

export default MacOSDock;
