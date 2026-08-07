// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import WorkflowFinalReviewOutputCard, {
  parseWorkflowFinalReviewOutput,
} from '@/components/workflow/WorkflowFinalReviewOutputCard';

const reviewJson = JSON.stringify({
  summary: '工作流执行完成，测试全部通过。',
  nextFocus: ['补充边界测试', '完善使用说明'],
  experience: ['先确认平台差异可以减少返工'],
  scoreCards: [
    {
      agent: 'architect',
      score: 9,
      strengths: ['方案清晰'],
      weaknesses: ['可以更早验证常量名'],
    },
  ],
}, null, 2);

describe('WorkflowFinalReviewOutputCard', () => {
  test('recognizes bare and fenced final-review protocol output', () => {
    expect(parseWorkflowFinalReviewOutput(reviewJson)?.summary).toBe('工作流执行完成，测试全部通过。');
    expect(parseWorkflowFinalReviewOutput(`\`\`\`json\n${reviewJson}\n\`\`\``)?.scoreCards[0]?.agent).toBe('architect');
  });

  test('does not replace unrelated JSON output', () => {
    expect(parseWorkflowFinalReviewOutput('{"summary":"普通结果","items":[]}')).toBeNull();
    expect(parseWorkflowFinalReviewOutput('```json\n{"nextFocus":[]}\n```')).toBeNull();
    expect(parseWorkflowFinalReviewOutput('还在生成中 {')).toBeNull();
  });

  test('renders user-facing sections and keeps raw JSON collapsed by default', () => {
    const review = parseWorkflowFinalReviewOutput(reviewJson);
    expect(review).not.toBeNull();
    render(<WorkflowFinalReviewOutputCard review={review!} rawOutput={reviewJson} />);

    expect(screen.getByText('运行复盘')).toBeInTheDocument();
    expect(screen.getByText('工作流执行完成，测试全部通过。')).toBeInTheDocument();
    expect(screen.getByText('下一步重点')).toBeInTheDocument();
    expect(screen.getByText('经验沉淀')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.queryByText(/"scoreCards"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看原始输出' }));
    expect(screen.getByText(/"scoreCards"/)).toBeInTheDocument();
  });
});
