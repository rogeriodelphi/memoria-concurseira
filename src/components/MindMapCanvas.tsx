import { useState, type ReactNode } from 'react';

import type { MindMapNode } from '../types';

const X_STEP_BY_DEPTH = [0, 210, 430, 630];
const ROW_HEIGHT = 44;
const BRANCH_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d'];

interface PositionedNode {
  key: string;
  x: number;
  y: number;
  title: string;
  depth: number;
  color: string;
  childCount: number;
  collapsed: boolean;
}

interface PositionedEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface YCursor {
  value: number;
}

function layoutMindMap(
  root: MindMapNode,
  collapsedKeys: Set<string>,
): { nodes: PositionedNode[]; edges: PositionedEdge[] } {
  const nodes: PositionedNode[] = [];

  function layoutNode(node: MindMapNode, key: string, depth: number, direction: 1 | -1, color: string, yCursor: YCursor): PositionedNode {
    const collapsed = collapsedKeys.has(key);
    const rawChildren = node.children ?? [];
    const visibleChildren = collapsed ? [] : rawChildren;
    const x = direction * X_STEP_BY_DEPTH[Math.min(depth, X_STEP_BY_DEPTH.length - 1)];

    let y: number;
    if (visibleChildren.length === 0) {
      y = yCursor.value;
      yCursor.value += ROW_HEIGHT;
    } else {
      const childYs = visibleChildren.map((child, i) => layoutNode(child, `${key}.${i}`, depth + 1, direction, color, yCursor).y);
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }

    const positioned: PositionedNode = {
      key,
      x,
      y,
      title: node.title,
      depth,
      color,
      childCount: rawChildren.length,
      collapsed,
    };
    nodes.push(positioned);
    return positioned;
  }

  const branches = root.children ?? [];

  // Cada lado é montado do zero (linhas empilhadas a partir de y=0) e só
  // depois recentralizado em torno da raiz — assim os dois lados ficam
  // equilibrados verticalmente mesmo tendo tamanhos bem diferentes.
  function layoutSide(direction: 1 | -1): void {
    const yCursor: YCursor = { value: 0 };
    const keys: string[] = [];
    branches.forEach((branch, i) => {
      if ((i % 2 === 0) !== (direction === 1)) return;
      const color = BRANCH_COLORS[i % BRANCH_COLORS.length];
      keys.push(layoutNode(branch, `${i}`, 1, direction, color, yCursor).key);
    });
    if (keys.length === 0) return;
    const mid = (yCursor.value - ROW_HEIGHT) / 2;
    nodes.forEach((n) => {
      if (keys.some((k) => n.key === k || n.key.startsWith(`${k}.`))) n.y -= mid;
    });
  }

  layoutSide(1);
  layoutSide(-1);

  nodes.push({ key: 'root', x: 0, y: 0, title: root.title, depth: 0, color: '#111827', childCount: branches.length, collapsed: false });

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges: PositionedEdge[] = [];
  nodes.forEach((n) => {
    if (n.key === 'root') return;
    const parentKey = n.key.includes('.') ? n.key.slice(0, n.key.lastIndexOf('.')) : 'root';
    const parent = byKey.get(parentKey);
    if (parent) edges.push({ x1: parent.x, y1: parent.y, x2: n.x, y2: n.y, color: n.color });
  });

  return { nodes, edges };
}

function curvedPath(edge: PositionedEdge): string {
  const midX = (edge.x1 + edge.x2) / 2;
  return `M ${edge.x1},${edge.y1} C ${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`;
}

function nodeSize(node: PositionedNode): { width: number; height: number } {
  const base = node.depth === 0 ? 15 : node.depth === 1 ? 13 : 12;
  const width = Math.max(70, node.title.length * (base * 0.62) + 28);
  const height = node.depth === 0 ? 44 : node.depth === 1 ? 36 : node.depth === 2 ? 30 : 26;
  return { width, height };
}

export function MindMapCanvas({ root }: { root: MindMapNode }) {
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  function toggleCollapse(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const { nodes, edges } = layoutMindMap(root, collapsedKeys);

  const padding = 100;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;
  const width = maxX - minX;
  const height = maxY - minY;

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      className="h-full w-full"
      style={{ minHeight: 480 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {edges.map((edge, i) => (
        <path key={i} d={curvedPath(edge)} fill="none" stroke={edge.color} strokeWidth={2} opacity={0.55} />
      ))}
      {nodes.map((node) => {
        const { width: w, height: h } = nodeSize(node);
        const hasChildren = node.childCount > 0;
        const toggleX = node.x + (node.x >= 0 ? w / 2 + 12 : -(w / 2 + 12));

        let box: ReactNode;
        if (node.depth === 0) {
          box = (
            <>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} className="fill-neutral-900 dark:fill-neutral-100" />
              <text textAnchor="middle" dominantBaseline="central" className="fill-white text-[15px] font-bold dark:fill-neutral-900">
                {node.title}
              </text>
            </>
          );
        } else if (node.depth === 1) {
          box = (
            <>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={node.color} />
              <text textAnchor="middle" dominantBaseline="central" className="fill-white text-[13px] font-semibold">
                {node.title}
              </text>
            </>
          );
        } else if (node.depth === 2) {
          box = (
            <>
              <rect
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                rx={8}
                fill="white"
                stroke={node.color}
                strokeWidth={1.5}
                className="dark:fill-neutral-800"
              />
              <text textAnchor="middle" dominantBaseline="central" className="text-xs font-medium" fill={node.color}>
                {node.title}
              </text>
            </>
          );
        } else {
          box = (
            <>
              <rect
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                rx={6}
                className="fill-neutral-50 stroke-neutral-200 dark:fill-neutral-800 dark:stroke-neutral-700"
                strokeWidth={1}
              />
              <text textAnchor="middle" dominantBaseline="central" className="fill-neutral-600 text-[11px] dark:fill-neutral-300">
                {node.title}
              </text>
            </>
          );
        }

        return (
          <g key={node.key} transform={`translate(${node.x}, ${node.y})`}>
            {box}
            {hasChildren && node.depth > 0 && (
              <g
                transform={`translate(${toggleX - node.x}, 0)`}
                onClick={() => toggleCollapse(node.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCollapse(node.key);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={node.collapsed ? `Expandir ${node.title}` : `Recolher ${node.title}`}
                className="cursor-pointer"
              >
                <circle r={9} className="fill-white stroke-neutral-300 dark:fill-neutral-800 dark:stroke-neutral-600" strokeWidth={1.5} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="select-none fill-neutral-600 text-xs font-bold dark:fill-neutral-300"
                >
                  {node.collapsed ? '+' : '−'}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
