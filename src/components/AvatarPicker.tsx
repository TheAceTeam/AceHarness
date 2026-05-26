'use client';

import { useMemo, useState } from 'react';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AVATAR_PICKER_CATEGORIES,
  buildSpriteAvatarValue,
  getAvatarCategoryForEntry,
  getSpriteAvatarName,
  resolveSpriteAvatarEntry,
  type AvatarCategoryId,
} from '@/lib/avatar/sprite';
import { cn } from '@/lib/core/utils';

interface AvatarPickerProps {
  value?: string;
  onChange: (avatar: string) => void;
  className?: string;
  seed?: string;
}

export default function AvatarPicker({ value, onChange, className, seed }: AvatarPickerProps) {
  const initialCategory = useMemo(() => {
    const entry = resolveSpriteAvatarEntry(value);
    return getAvatarCategoryForEntry(entry)?.id || AVATAR_PICKER_CATEGORIES[0]?.id || 'animals';
  }, [value]);
  const [activeCategory, setActiveCategory] = useState<AvatarCategoryId | string>(initialCategory);
  const currentCategory = AVATAR_PICKER_CATEGORIES.find((category) => category.id === activeCategory)
    || AVATAR_PICKER_CATEGORIES[0];
  const selectedEntry = resolveSpriteAvatarEntry(value);

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {AVATAR_PICKER_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => setActiveCategory(category.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              activeCategory === category.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted'
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      <TooltipProvider delayDuration={120}>
        <div className="grid min-h-0 grid-cols-6 gap-2 overflow-x-hidden overflow-y-auto pr-1">
          {currentCategory.entries.map((entry) => {
            const avatar = buildSpriteAvatarValue(entry.sheetId, entry.index);
            const name = getSpriteAvatarName(entry);
            const selected = selectedEntry?.sheetId === entry.sheetId && selectedEntry.index === entry.index;

            return (
              <Tooltip key={avatar}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onChange(avatar)}
                    aria-label={`${currentCategory.label} · ${name}`}
                    className={cn(
                      'h-12 w-12 overflow-hidden rounded-full border-2 transition-[border-color,box-shadow] duration-150 focus-visible:outline-none',
                      selected
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'border-transparent hover:border-muted-foreground/30 hover:ring-2 hover:ring-primary/10'
                    )}
                  >
                    <SpriteAvatar
                      avatar={avatar}
                      seed={seed}
                      alt={name}
                      className="h-full w-full"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {currentCategory.label} · {name}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}

const AVATARS = AVATAR_PICKER_CATEGORIES.flatMap((category) => (
  category.entries.map((entry) => buildSpriteAvatarValue(entry.sheetId, entry.index))
));

export { AVATARS };
