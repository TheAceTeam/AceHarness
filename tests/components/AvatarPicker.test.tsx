// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AvatarPicker from '@/components/AvatarPicker';

vi.mock('@/components/SpriteAvatar', () => ({
  default: ({ alt, className }: { alt?: string; className?: string }) => (
    <span role="img" aria-label={alt || 'avatar'} className={className} />
  ),
}));

describe('AvatarPicker', () => {
  test('uses non-scaling hover styles inside the scroll container', () => {
    const { container } = render(
      <AvatarPicker value="" onChange={() => {}} seed="tester" />,
    );

    const grid = container.querySelector('.grid');
    const avatarButton = screen.getByRole('button', { name: '动物 · 狗' });

    expect(grid?.className).toContain('overflow-x-hidden');
    expect(avatarButton.className).not.toContain('scale-');
    expect(avatarButton.className).toContain('hover:ring-2');
  });
});
