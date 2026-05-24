'use client';

import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/core/utils';
import {
  resolveAvatarSource,
  type AvatarCategoryId,
  type ResolvedAvatarSource,
} from '@/lib/avatar/sprite';

type SpriteAvatarProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> & {
  avatar?: string | null;
  src?: string | null;
  seed?: string;
  category?: AvatarCategoryId | string;
  alt?: string;
  fallback?: React.ReactNode;
  fallbackClassName?: string;
  imageClassName?: string;
  spriteImageClassName?: string;
  size?: number | string;
};

function toCssSize(size?: number | string) {
  if (typeof size === 'number') return `${size}px`;
  return size;
}

function SpriteLayer({
  source,
  className,
  spriteImageClassName,
}: {
  source: Extract<ResolvedAvatarSource, { kind: 'sprite' }>;
  className?: string;
  spriteImageClassName?: string;
}) {
  const scaleX = source.sheet.width / source.frame.width;
  const scaleY = source.sheet.height / source.frame.height;

  return (
    <span className={cn('absolute inset-0 block overflow-hidden rounded-full bg-muted', className)} aria-hidden="true">
      <span
        className={cn('absolute block bg-no-repeat', spriteImageClassName)}
        style={{
          width: `${scaleX * 100}%`,
          height: `${scaleY * 100}%`,
          left: `${(-source.frame.x / source.frame.width) * 100}%`,
          top: `${(-source.frame.y / source.frame.height) * 100}%`,
          backgroundImage: `url("${source.sheet.src}")`,
          backgroundSize: '100% 100%',
        }}
      />
    </span>
  );
}

const SpriteAvatar = React.memo(function SpriteAvatar({
  avatar,
  src,
  seed,
  category,
  alt = '',
  fallback,
  fallbackClassName,
  imageClassName,
  spriteImageClassName,
  className,
  size,
  style,
  ...props
}: SpriteAvatarProps) {
  const resolved = resolveAvatarSource(avatar ?? src, { seed, category });
  const cssSize = toCssSize(size);
  const sizedStyle = cssSize ? { width: cssSize, height: cssSize, ...style } : style;
  const label = alt || (typeof fallback === 'string' ? fallback : undefined);

  return (
    <Avatar
      className={className}
      style={sizedStyle}
      role={label ? 'img' : props.role}
      aria-label={label}
      {...props}
    >
      {resolved.kind === 'sprite' ? (
        <SpriteLayer source={resolved} className={imageClassName} spriteImageClassName={spriteImageClassName} />
      ) : resolved.kind === 'image' ? (
        <AvatarImage src={resolved.src} alt={alt} className={cn('object-cover', imageClassName)} />
      ) : null}
      {resolved.kind !== 'sprite' ? (
        <AvatarFallback className={fallbackClassName}>{fallback}</AvatarFallback>
      ) : null}
    </Avatar>
  );
});

export default SpriteAvatar;
