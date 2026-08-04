// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/components/common/DirectoryTreePicker', () => ({
  default: (props: {
    value: string;
    rootLabel: string;
    emptyDisplayValue?: string;
    onChange: (path: string) => void;
  }) => (
    <div>
      <span data-testid="display-value">
        {props.value || props.emptyDisplayValue || props.rootLabel}
      </span>
      <button type="button" onClick={() => props.onChange('')}>
        选择当前根目录
      </button>
    </div>
  ),
}));

vi.mock('@/lib/core/api', () => ({
  workspaceApi: {},
}));

import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';

function PickerHarness() {
  const [value, setValue] = useState('');
  return (
    <WorkspaceDirectoryPicker
      workspaceRoot="/workspace/project"
      value={value}
      onChange={setValue}
      emptyDisplayValue="使用工作流默认"
    />
  );
}

describe('WorkspaceDirectoryPicker', () => {
  test('shows the selected root instead of the empty placeholder', () => {
    render(<PickerHarness />);

    expect(screen.getByTestId('display-value')).toHaveTextContent('使用工作流默认');

    fireEvent.click(screen.getByRole('button', { name: '选择当前根目录' }));

    expect(screen.getByTestId('display-value')).toHaveTextContent('/workspace/project');
  });
});
