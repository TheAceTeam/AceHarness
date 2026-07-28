'use client';

import SpriteAvatar from '@/components/SpriteAvatar';

const CSIHARNESS_LOGO_AVATAR_VALUE = 'sprite:group1:24';
const DISABLE_LOGO_GLOW_CLASS_PATTERN = /\banimate-none\b/;

export function RobotLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  const innerGlowClass = DISABLE_LOGO_GLOW_CLASS_PATTERN.test(className) ? '' : 'aceharness-deer-inner-glow';

  return (
    <SpriteAvatar
      avatar={CSIHARNESS_LOGO_AVATAR_VALUE}
      seed="aceharness-logo"
      category="all"
      fallback="CSI"
      aria-hidden="true"
      size={size}
      className={`inline-flex overflow-visible rounded-full ${className}`.trim()}
      spriteImageClassName={innerGlowClass}
      draggable={false}
    />
  );
}

export default RobotLogo;
