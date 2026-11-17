import { Position } from 'reactflow';
import type { Edge } from 'reactflow';
import { describe, expect, test } from 'vitest';
import { getParallelTransitionGeometry, spaceParallelTransitions, spaceTransitionEndpoints } from '@/components/StateMachineDiagram';

const coverage = '覆盖校验与澄清';
const review = '语义复核';
const history: Edge[] = [
  { id: '3', source: coverage, target: review, type: 'stateTransition', label: '3. 进入语义复核' },
  { id: '4', source: review, target: coverage, type: 'stateTransition', label: '4. 回退复核覆盖与澄清' },
  { id: '5', source: coverage, target: review, type: 'stateTransition', label: '5. 重新进入语义复核' },
];

describe('StateMachineDiagram parallel transitions', () => {
  test.each([
    { targetX: 620, targetY: 290, sourcePosition: Position.Right, targetPosition: Position.Left },
    { targetX: 0, targetY: 400, sourcePosition: Position.Bottom, targetPosition: Position.Top },
  ])('separates repeated and reverse transitions at $targetX, $targetY', (layout) => {
    const edges = spaceParallelTransitions(history);
    const geometries = edges.map((edge) => {
      const coordinates = edge.source === coverage
        ? { sourceX: 0, sourceY: 0, ...layout }
        : {
            sourceX: layout.targetX,
            sourceY: layout.targetY,
            sourcePosition: layout.targetPosition,
            targetX: 0,
            targetY: 0,
            targetPosition: layout.sourcePosition,
          };
      const geometry = getParallelTransitionGeometry(coordinates, edge.data.parallelTransition);
      expect(geometry.edgePath).toMatch(new RegExp(`^M ${coordinates.sourceX},${coordinates.sourceY} `));
      expect(geometry.edgePath.endsWith(` ${coordinates.targetX},${coordinates.targetY}`)).toBe(true);
      return geometry;
    });

    expect(edges.map((edge) => edge.label)).toEqual(history.map((edge) => edge.label));
    const routeMidpoints = geometries.map(({ edgePath }) => edgePath.split(' C ')[1].split(' ').at(-1));
    expect(new Set(routeMidpoints).size).toBe(3);
    const labelRows = geometries.map((geometry) => geometry.labelY).sort((a, b) => a - b);
    expect(labelRows[1] - labelRows[0]).toBeGreaterThanOrEqual(32);
    expect(labelRows[2] - labelRows[1]).toBeGreaterThanOrEqual(32);
  });

  test('keeps single edges and self-loops on their existing routes', () => {
    const single = history[0];
    const loop = { ...single, id: 'loop', target: single.source };
    const edges = spaceParallelTransitions([single, loop]);

    expect(edges[0]).toBe(single);
    expect(edges[1]).toBe(loop);
  });

  test('separates arrows for forward and reverse curves in the original layout', () => {
    const bounds = (id: string) => {
      const x = id === coverage ? 1080 : 0;
      const y = id === coverage ? 40 : 600;
      return { id, left: x, right: x + 300, top: y, bottom: y + 120, centerX: x + 150, centerY: y + 60 };
    };
    const routes = history.map((edge) => {
      const isRollback = edge.id === '4';
      return {
        ...edge,
        sourceHandle: isRollback ? Position.Right : Position.Left,
        targetHandle: isRollback ? Position.Left : Position.Right,
        data: { transitionIndex: Number(edge.id) - 1, isRollback },
      };
    });
    const [firstReview, rollback, secondReview] = spaceTransitionEndpoints(spaceParallelTransitions(routes), bounds);
    expect(firstReview.data.handleOffsets).toEqual({ source: -24, target: -24 });
    expect(rollback.data.handleOffsets).toEqual({ source: 0, target: 0 });
    expect(secondReview.data.handleOffsets).toEqual({ source: 24, target: 24 });
    const coordinates = {
      sourceX: 1080, sourceY: 100, sourcePosition: Position.Left,
      targetX: 300, targetY: 660, targetPosition: Position.Right,
    };
    const first = getParallelTransitionGeometry(coordinates, firstReview.data.parallelTransition, firstReview.data.handleOffsets);
    const second = getParallelTransitionGeometry(coordinates, secondReview.data.parallelTransition, secondReview.data.handleOffsets);
    expect(first.edgePath).toMatch(/^M 1080,76 C .* 300,636$/);
    expect(second.edgePath).toMatch(/^M 1080,124 C .* 300,684$/);
    const reverse = getParallelTransitionGeometry({
      sourceX: 300, sourceY: 660, sourcePosition: Position.Right,
      targetX: 1080, targetY: 100, targetPosition: Position.Left,
    }, rollback.data.parallelTransition, rollback.data.handleOffsets);
    expect(reverse.edgePath).toMatch(/^M 300,660 C .* 1080,100$/);
    expect(first.labelY).toBeLessThan(reverse.labelY);
    expect(reverse.labelY).toBeLessThan(second.labelY);
  });
});
