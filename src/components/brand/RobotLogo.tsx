'use client';

export function RobotLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/images/aceharness-crystal-deer.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`inline-block object-contain ${className}`.trim()}
      decoding="async"
      draggable={false}
    />
  );
}

export default RobotLogo;
