'use client';

import { cn } from '@/lib/core/utils';

const AVATARS = [
  'axolotl.png', 'bear.png', 'bird.png', 'cat.png', 'deer.png', 'dog.png',
  'elephant.png', 'fox.png', 'giraffe.png', 'hedgehog.png', 'hippo.png', 'koala.png',
  'lion.png', 'monkey.png', 'otter.png', 'owl.png', 'panda.png', 'penguin.png',
  'rabbit.png', 'sloth.png', 'squirrel.png', 'suricate_suricatta.png', 'tiger.png', 'zebra.png',
];

interface AvatarPickerProps {
  value?: string;
  onChange: (avatar: string) => void;
  className?: string;
}

export default function AvatarPicker({ value, onChange, className }: AvatarPickerProps) {
  return (
    <div className={cn('grid grid-cols-6 gap-2', className)}>
      {AVATARS.map((avatar) => (
        <button
          key={avatar}
          type="button"
          onClick={() => onChange(avatar)}
          className={cn(
            'w-12 h-12 rounded-full overflow-hidden border-2 transition-all hover:scale-110',
            value === avatar
              ? 'border-primary ring-2 ring-primary/30'
              : 'border-transparent hover:border-muted-foreground/30'
          )}
        >
          <img
            src={`/avatar/${avatar}`}
            alt={avatar.replace('.png', '')}
            className="w-full h-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

export { AVATARS };
