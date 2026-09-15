'use client';

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
// d3-transition augments d3-selection's Selection with .transition().
// TypeScript 7 no longer auto-includes @types packages hoisted to the
// workspace root, so the augmentation must be imported explicitly or every
// .transition() call fails to typecheck. Already loaded at runtime via d3-zoom.
import 'd3-transition';
import { select } from 'd3-selection';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type Simulation,
} from 'd3-force';
import { zoom as d3Zoom, zoomIdentity, type ZoomTransform, type ZoomBehavior } from 'd3-zoom';
import { drag as d3Drag } from 'd3-drag';
import { scaleSqrt } from 'd3-scale';
import { max } from 'd3-array';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Sparkles,
  FileText,
  ExternalLink,
  Link,
  Search,
  X,
  Filter,
  ChevronDown,
  LayoutGrid,
  Route,
} from 'lucide-react';
import { useContextMenu } from '@/hooks/use-context-menu';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu';

import { buildDepartmentColorMap } from './department-colors';

const DEFAULT_COLOR = '#A1A09A';

const MINIMAP_W = 150;
const MINIMAP_H = 110;
const MINIMAP_PAD = 12;

type LayoutPreset = 'force' | 'radial' | 'hierarchical';

function getDepartment(path: string): string {
  return path.split('/')[0];
}

function getDisplayName(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/, '');
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  path: string;
  name: string;
  color: string;
  dept: string;
  linkCount: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
}

type GraphContextTarget =
  | { type: 'node'; node: SimNode }
  | { type: 'canvas' };

interface GraphViewProps {
  files: Array<{ id: string; path: string }>;
  links: Array<{ source_file_id: string; target_path: string }>;
  onSelectFile: (fileId: string, filePath: string) => void;
  onOpenInNewTab?: (fileId: string, filePath: string) => void;
}

function ToolbarBtn({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 hover:bg-black/[0.06] active:bg-black/[0.1]"
      style={active ? { backgroundColor: 'rgba(91,154,101,0.12)' } : undefined}
    >
      {children}
      {/* Tooltip */}
      <span
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{
          backgroundColor: '#2B2A25',
          color: '#FAFAF5',
        }}
      >
        {label}
      </span>
    </button>
  );
}

/* BFS shortest path between two nodes */
function bfsPath(
  adjacency: Map<string, Set<string>>,
  startId: string,
  endId: string
): string[] | null {
  if (startId === endId) return [startId];
  const visited = new Set<string>([startId]);
  const queue: string[][] = [[startId]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    for (const nb of neighbors) {
      if (visited.has(nb)) continue;
      const newPath = [...path, nb];
      if (nb === endId) return newPath;
      visited.add(nb);
      queue.push(newPath);
    }
  }
  return null;
}

export default function GraphView({ files, links, onSelectFile, onOpenInNewTab }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const nodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const mainSizeRef = useRef({ w: 0, h: 0 });
  const radiusScaleRef = useRef<ReturnType<typeof scaleSqrt<number, number>> | null>(null);
  const [isTidy, setIsTidy] = useState(false);
  const isInitialBuildRef = useRef(true);
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSelectFileRef = useRef(onSelectFile);
  onSelectFileRef.current = onSelectFile;
  const onOpenInNewTabRef = useRef(onOpenInNewTab);
  onOpenInNewTabRef.current = onOpenInNewTab;
  const handlePathNodeClickRef = useRef<(nodeId: string) => void>(() => {});

  const ctxMenu = useContextMenu<GraphContextTarget>();

  // ── Advanced feature state ──────────────────────────────────
  const [hiddenDepts, setHiddenDepts] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('force');
  const [layoutDropdownOpen, setLayoutDropdownOpen] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const pathModeRef = useRef(false);
  pathModeRef.current = pathMode;
  const [pathNodeA, setPathNodeA] = useState<string | null>(null);
  const [pathNodeB, setPathNodeB] = useState<string | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<Set<string>>(new Set());
  const highlightedPathRef = useRef<Set<string>>(new Set());
  highlightedPathRef.current = highlightedPath;
  const [highlightedPathLinks, setHighlightedPathLinks] = useState<Set<string>>(new Set());
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);

  // Build department color map for filter panel
  const deptColorMap = useMemo(() => buildDepartmentColorMap(files), [files]);
  const departments = useMemo(() => {
    const depts = new Set<string>();
    for (const f of files) {
      const parts = f.path.split('/');
      if (parts.length > 1) depts.add(parts[0]);
    }
    return Array.from(depts).sort((a, b) => a.localeCompare(b));
  }, [files]);

  // Build adjacency list for BFS
  const adjacency = useMemo(() => {
    const pathToId = new Map<string, string>();
    for (const f of files) {
      pathToId.set(f.path, f.id);
      pathToId.set(f.path.replace(/\.md$/, ''), f.id);
      const name = getDisplayName(f.path);
      if (!pathToId.has(name)) pathToId.set(name, f.id);
    }
    const adj = new Map<string, Set<string>>();
    for (const link of links) {
      const targetId =
        pathToId.get(link.target_path) ??
        pathToId.get(link.target_path.replace(/\.md$/, '')) ??
        pathToId.get(getDisplayName(link.target_path));
      if (!targetId) continue;
      if (!adj.has(link.source_file_id)) adj.set(link.source_file_id, new Set());
      if (!adj.has(targetId)) adj.set(targetId, new Set());
      adj.get(link.source_file_id)!.add(targetId);
      adj.get(targetId)!.add(link.source_file_id);
    }
    return adj;
  }, [files, links]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return files
      .filter((f) => {
        const name = getDisplayName(f.path).toLowerCase();
        const path = f.path.toLowerCase();
        return name.includes(q) || path.includes(q);
      })
      .slice(0, 8);
  }, [files, searchQuery]);

  // Path highlighting logic
  useEffect(() => {
    if (!pathNodeA || !pathNodeB) {
      setHighlightedPath(new Set());
      setHighlightedPathLinks(new Set());
      return;
    }
    const path = bfsPath(adjacency, pathNodeA, pathNodeB);
    if (!path) {
      setHighlightedPath(new Set());
      setHighlightedPathLinks(new Set());
      return;
    }
    setHighlightedPath(new Set(path));
    const linkKeys = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      linkKeys.add(`${path[i]}--${path[i + 1]}`);
      linkKeys.add(`${path[i + 1]}--${path[i]}`);
    }
    setHighlightedPathLinks(linkKeys);
  }, [pathNodeA, pathNodeB, adjacency]);

  // Clear path mode when toggled off
  useEffect(() => {
    if (!pathMode) {
      setPathNodeA(null);
      setPathNodeB(null);
      setHighlightedPath(new Set());
      setHighlightedPathLinks(new Set());
    }
  }, [pathMode]);

  // ── Filtered files/links for graph ──────────────────────────
  const filteredFiles = useMemo(() => {
    if (hiddenDepts.size === 0) return files;
    return files.filter((f) => {
      const dept = getDepartment(f.path);
      return !hiddenDepts.has(dept);
    });
  }, [files, hiddenDepts]);

  const filteredLinks = useMemo(() => {
    const visibleIds = new Set(filteredFiles.map((f) => f.id));
    const pathToId = new Map<string, string>();
    for (const f of filteredFiles) {
      pathToId.set(f.path, f.id);
      pathToId.set(f.path.replace(/\.md$/, ''), f.id);
      const name = getDisplayName(f.path);
      if (!pathToId.has(name)) pathToId.set(name, f.id);
    }
    return links.filter((l) => {
      if (!visibleIds.has(l.source_file_id)) return false;
      const targetId =
        pathToId.get(l.target_path) ??
        pathToId.get(l.target_path.replace(/\.md$/, '')) ??
        pathToId.get(getDisplayName(l.target_path));
      return targetId && visibleIds.has(targetId);
    });
  }, [filteredFiles, links]);

  // ── Minimap ────────────────────────────────────────────────
  const drawMinimap = useCallback(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nodes = nodesRef.current;
    const simLinks = simLinksRef.current;
    const t = transformRef.current;
    const { w: mainW, h: mainH } = mainSizeRef.current;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_W * dpr;
    canvas.height = MINIMAP_H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.roundRect(0, 0, MINIMAP_W, MINIMAP_H, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(43,42,37,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, MINIMAP_W - 1, MINIMAP_H - 1, 8);
    ctx.stroke();

    if (nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny;
      if (ny > maxY) maxY = ny;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const innerW = MINIMAP_W - MINIMAP_PAD * 2;
    const innerH = MINIMAP_H - MINIMAP_PAD * 2;
    const sc = Math.min(innerW / rangeX, innerH / rangeY);
    const ox = MINIMAP_PAD + (innerW - rangeX * sc) / 2;
    const oy = MINIMAP_PAD + (innerH - rangeY * sc) / 2;

    const mapX = (x: number) => ox + (x - minX) * sc;
    const mapY = (y: number) => oy + (y - minY) * sc;

    ctx.strokeStyle = 'rgba(180,178,170,0.35)';
    ctx.lineWidth = 0.5;
    for (const l of simLinks) {
      const s = l.source as SimNode;
      const tg = l.target as SimNode;
      ctx.beginPath();
      ctx.moveTo(mapX(s.x ?? 0), mapY(s.y ?? 0));
      ctx.lineTo(mapX(tg.x ?? 0), mapY(tg.y ?? 0));
      ctx.stroke();
    }

    for (const n of nodes) {
      const cx = mapX(n.x ?? 0);
      const cy = mapY(n.y ?? 0);
      ctx.fillStyle = n.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, n.linkCount * 0.4 + 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (mainW > 0 && mainH > 0) {
      const vLeft = -t.x / t.k;
      const vTop = -t.y / t.k;
      const vRight = (mainW - t.x) / t.k;
      const vBottom = (mainH - t.y) / t.k;
      const rx = mapX(vLeft);
      const ry = mapY(vTop);
      const rw = (vRight - vLeft) * sc;
      const rh = (vBottom - vTop) * sc;
      ctx.strokeStyle = 'rgba(91,154,101,0.7)';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(91,154,101,0.06)';
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.fill();
      ctx.stroke();
    }
  }, []);

  // ── Build Graph ────────────────────────────────────────────
  const buildGraph = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const isUpdate = !isInitialBuildRef.current && !!simulationRef.current;
    const savedPositions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    if (isUpdate && simulationRef.current) {
      for (const n of simulationRef.current.nodes()) {
        savedPositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: n.vx ?? 0, vy: n.vy ?? 0 });
      }
    }
    simulationRef.current?.stop();

    mainSizeRef.current = { w: width, h: height };

    const pathToId = new Map<string, string>();
    for (const f of filteredFiles) {
      pathToId.set(f.path, f.id);
      const noExt = f.path.replace(/\.md$/, '');
      if (!pathToId.has(noExt)) pathToId.set(noExt, f.id);
      const name = getDisplayName(f.path);
      if (!pathToId.has(name)) pathToId.set(name, f.id);
    }

    const colorMap = buildDepartmentColorMap(files);

    const linkCountMap = new Map<string, number>();
    const resolvedLinks: Array<{ sourceId: string; targetId: string }> = [];

    for (const link of filteredLinks) {
      const targetId =
        pathToId.get(link.target_path) ??
        pathToId.get(link.target_path.replace(/\.md$/, '')) ??
        pathToId.get(getDisplayName(link.target_path));
      if (!targetId) continue;
      resolvedLinks.push({ sourceId: link.source_file_id, targetId });
      linkCountMap.set(link.source_file_id, (linkCountMap.get(link.source_file_id) ?? 0) + 1);
      linkCountMap.set(targetId, (linkCountMap.get(targetId) ?? 0) + 1);
    }

    const newNodeIds = new Set<string>();
    const nodes: SimNode[] = filteredFiles.map((f) => {
      const saved = savedPositions.get(f.id);
      if (!saved && isUpdate) newNodeIds.add(f.id);
      const node: SimNode = {
        id: f.id,
        path: f.path,
        name: getDisplayName(f.path),
        color: colorMap.get(getDepartment(f.path)) ?? DEFAULT_COLOR,
        dept: getDepartment(f.path),
        linkCount: linkCountMap.get(f.id) ?? 0,
      };
      if (saved) {
        node.x = saved.x; node.y = saved.y;
        node.vx = saved.vx; node.vy = saved.vy;
      } else if (isUpdate) {
        const connLink = resolvedLinks.find(
          (l) => (l.sourceId === f.id && savedPositions.has(l.targetId)) ||
                 (l.targetId === f.id && savedPositions.has(l.sourceId))
        );
        if (connLink) {
          const connId = connLink.sourceId === f.id ? connLink.targetId : connLink.sourceId;
          const connPos = savedPositions.get(connId)!;
          node.x = connPos.x + (Math.random() - 0.5) * 60;
          node.y = connPos.y + (Math.random() - 0.5) * 60;
        } else {
          node.x = (Math.random() - 0.5) * 100;
          node.y = (Math.random() - 0.5) * 100;
        }
      }
      return node;
    });
    nodesRef.current = nodes;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = resolvedLinks
      .filter((l) => nodeMap.has(l.sourceId) && nodeMap.has(l.targetId))
      .map((l) => ({ source: l.sourceId, target: l.targetId }));
    simLinksRef.current = simLinks;

    const svg = select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const defs = svg.append('defs');
    const glowFilter = defs.append('filter').attr('id', 'node-glow');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
    glowFilter.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

    const g = svg.append('g');

    const zoom = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        transformRef.current = event.transform;
        drawMinimap();
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    svg.on('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      ctxMenu.open(event, { type: 'canvas' }, 1);
    });

    if (isUpdate) {
      svg.call(zoom.transform, transformRef.current);
    } else {
      const initialScale = Math.min(width, height) / 600;
      const initT = zoomIdentity
        .translate(width / 2, height / 2)
        .scale(Math.max(0.5, Math.min(initialScale, 1.2)));
      svg.call(zoom.transform, initT);
      transformRef.current = initT;
    }

    const link = g.append('g').selectAll('path').data(simLinks).join('path')
      .attr('fill', 'none')
      .attr('stroke', '#C5C4BC')
      .attr('stroke-opacity', 0.45)
      .attr('stroke-width', 0.8);

    const node = g.append('g').selectAll<SVGGElement, SimNode>('g').data(nodes).join('g')
      .style('cursor', 'pointer');

    const radiusScale = scaleSqrt()
      .domain([0, max(nodes, (n) => n.linkCount) ?? 1])
      .range([5, 18]);
    radiusScaleRef.current = radiusScale;

    node.append('circle').attr('class', 'glow')
      .attr('r', (d) => radiusScale(d.linkCount) + 3)
      .attr('fill', (d) => d.color).attr('opacity', 0.15).attr('filter', 'url(#node-glow)');

    node.append('circle').attr('class', 'main')
      .attr('r', (d) => radiusScale(d.linkCount))
      .attr('fill', (d) => d.color).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', 0.92);

    node.append('text')
      .text((d) => (d.name.length > 18 ? d.name.slice(0, 16) + '..' : d.name))
      .attr('dx', (d) => radiusScale(d.linkCount) + 5).attr('dy', 3)
      .attr('fill', '#5A5950').attr('font-size', '10px').attr('font-weight', '500')
      .attr('font-family', 'Inter, sans-serif').attr('pointer-events', 'none');

    node.on('click', (_event, d) => {
      if (pathModeRef.current) {
        handlePathNodeClickRef.current(d.id);
      } else {
        onSelectFileRef.current(d.id, d.path);
      }
    });

    node.on('contextmenu', (event: MouseEvent, d: SimNode) => {
      event.stopPropagation();
      ctxMenu.open(event, { type: 'node', node: d }, 3);
    });

    node
      .on('mouseenter', (_event, d) => {
        if (highlightedPathRef.current.size > 0) return;
        const connectedIds = new Set<string>();
        connectedIds.add(d.id);
        simLinks.forEach((l) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          if (src === d.id) connectedIds.add(tgt);
          if (tgt === d.id) connectedIds.add(src);
        });
        node.select('circle.main').attr('opacity', (n) => connectedIds.has(n.id) ? 1 : 0.15);
        node.select('circle.glow').attr('opacity', (n) => connectedIds.has(n.id) ? 0.25 : 0.03);
        node.select('text').attr('opacity', (n) => connectedIds.has(n.id) ? 1 : 0.15);
        link
          .attr('stroke-opacity', (l) => { const src = typeof l.source === 'object' ? l.source.id : l.source; const tgt = typeof l.target === 'object' ? l.target.id : l.target; return src === d.id || tgt === d.id ? 0.7 : 0.06; })
          .attr('stroke-width', (l) => { const src = typeof l.source === 'object' ? l.source.id : l.source; const tgt = typeof l.target === 'object' ? l.target.id : l.target; return src === d.id || tgt === d.id ? 1.8 : 0.8; })
          .attr('stroke', (l) => { const src = typeof l.source === 'object' ? l.source.id : l.source; const tgt = typeof l.target === 'object' ? l.target.id : l.target; return src === d.id || tgt === d.id ? d.color : '#C5C4BC'; });
        select(_event.currentTarget as SVGGElement).select('circle.main').attr('stroke', '#2B2A25').attr('stroke-width', 2);
      })
      .on('mouseleave', () => {
        if (highlightedPathRef.current.size > 0) return;
        node.select('circle.main').attr('opacity', 0.92).attr('stroke', '#fff').attr('stroke-width', 1.5);
        node.select('circle.glow').attr('opacity', 0.15);
        node.select('text').attr('opacity', 1);
        link.attr('stroke-opacity', 0.45).attr('stroke', '#C5C4BC').attr('stroke-width', 0.8);
      });

    const drag = d3Drag<SVGGElement, SimNode>()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; });
    node.call(drag);

    if (isUpdate && newNodeIds.size > 0) {
      node.filter((d) => newNodeIds.has(d.id))
        .attr('opacity', 0)
        .transition()
        .duration(500)
        .attr('opacity', 1);
    }

    function linkPath(d: SimLink) {
      const s = d.source as SimNode;
      const tgt = d.target as SimNode;
      const sx = s.x ?? 0, sy = s.y ?? 0, tx = tgt.x ?? 0, ty = tgt.y ?? 0;
      const dx = tx - sx, dy = ty - sy;
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
      return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`;
    }

    // Choose forces based on layout preset
    const simulation = forceSimulation<SimNode>(nodes);

    if (layoutPreset === 'force') {
      simulation
        .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(80))
        .force('charge', forceManyBody().strength(-120))
        .force('center', forceCenter(0, 0))
        .force('collision', forceCollide<SimNode>().radius((d) => radiusScale(d.linkCount) + 6));
    } else if (layoutPreset === 'radial') {
      const depts = Array.from(new Set(nodes.map((n) => n.dept)));
      const deptAngle = new Map<string, number>();
      depts.forEach((d, i) => deptAngle.set(d, (i / depts.length) * Math.PI * 2));
      const maxLinks = max(nodes, (n) => n.linkCount) ?? 1;

      simulation
        .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(60))
        .force('charge', forceManyBody().strength(-60))
        .force('collision', forceCollide<SimNode>().radius((d) => radiusScale(d.linkCount) + 4))
        .force('radial', forceRadial<SimNode>(
          (d) => {
            const ratio = 1 - (d.linkCount / maxLinks);
            return 30 + ratio * 160;
          }, 0, 0
        ).strength(0.8))
        .force('x', forceX<SimNode>((d) => {
          const angle = deptAngle.get(d.dept) ?? 0;
          const ratio = 1 - (d.linkCount / maxLinks);
          const r = 30 + ratio * 160;
          return Math.cos(angle) * r * 0.4;
        }).strength(0.3))
        .force('y', forceY<SimNode>((d) => {
          const angle = deptAngle.get(d.dept) ?? 0;
          const ratio = 1 - (d.linkCount / maxLinks);
          const r = 30 + ratio * 160;
          return Math.sin(angle) * r * 0.4;
        }).strength(0.3));
    } else if (layoutPreset === 'hierarchical') {
      const depts = Array.from(new Set(nodes.map((n) => n.dept))).sort();
      const deptIndex = new Map<string, number>();
      depts.forEach((d, i) => deptIndex.set(d, i));
      const colSpacing = 180;
      const totalWidth = (depts.length - 1) * colSpacing;

      simulation
        .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(60).strength(0.1))
        .force('charge', forceManyBody().strength(-40))
        .force('collision', forceCollide<SimNode>().radius((d) => radiusScale(d.linkCount) + 4))
        .force('x', forceX<SimNode>((d) => {
          const idx = deptIndex.get(d.dept) ?? 0;
          return idx * colSpacing - totalWidth / 2;
        }).strength(0.8))
        .force('y', forceY<SimNode>(0).strength(0.05));
    }

    simulation.on('tick', () => {
      link.attr('d', linkPath);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      drawMinimap();
    });

    if (isUpdate) {
      simulation.alpha(0.15).alphaDecay(0.05);
    }

    simulationRef.current = simulation;
    isInitialBuildRef.current = false;
    setIsTidy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFiles, filteredLinks, files, drawMinimap, layoutPreset]);

  // ── Apply path highlighting after graph builds ──────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const g = svg.select('g');
    if (g.empty()) return;

    if (highlightedPath.size > 0) {
      g.selectAll<SVGGElement, SimNode>('g > g > g')
        .select('circle.main')
        .attr('opacity', (d) => highlightedPath.has(d.id) ? 1 : 0.12);
      g.selectAll<SVGGElement, SimNode>('g > g > g')
        .select('circle.glow')
        .attr('opacity', (d) => highlightedPath.has(d.id) ? 0.3 : 0.02);
      g.selectAll<SVGGElement, SimNode>('g > g > g')
        .select('text')
        .attr('opacity', (d) => highlightedPath.has(d.id) ? 1 : 0.12);

      g.selectAll<SVGPathElement, SimLink>('g > g > path')
        .attr('stroke-opacity', (l) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          const key = `${src}--${tgt}`;
          return highlightedPathLinks.has(key) ? 0.9 : 0.04;
        })
        .attr('stroke-width', (l) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          const key = `${src}--${tgt}`;
          return highlightedPathLinks.has(key) ? 2.5 : 0.8;
        })
        .attr('stroke', (l) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          const key = `${src}--${tgt}`;
          return highlightedPathLinks.has(key) ? '#5B9A65' : '#C5C4BC';
        });

      g.selectAll<SVGGElement, SimNode>('g > g > g')
        .select('circle.main')
        .attr('stroke', (d) => (d.id === pathNodeA || d.id === pathNodeB) ? '#2B2A25' : '#fff')
        .attr('stroke-width', (d) => (d.id === pathNodeA || d.id === pathNodeB) ? 2.5 : 1.5);
    } else if (searchHighlightId) {
      g.selectAll<SVGGElement, SimNode>('g > g > g')
        .select('circle.main')
        .attr('opacity', (d) => d.id === searchHighlightId ? 1 : 0.2)
        .attr('stroke', (d) => d.id === searchHighlightId ? '#2B2A25' : '#fff')
        .attr('stroke-width', (d) => d.id === searchHighlightId ? 2.5 : 1.5);
      g.selectAll<SVGGElement, SimNode>('g > g > g')
        .select('circle.glow')
        .attr('opacity', (d) => d.id === searchHighlightId ? 0.35 : 0.02);
      g.selectAll<SVGGElement, SimNode>('g > g > g')
        .select('text')
        .attr('opacity', (d) => d.id === searchHighlightId ? 1 : 0.2);
    }
  }, [highlightedPath, highlightedPathLinks, pathNodeA, pathNodeB, searchHighlightId, filteredFiles]);

  // ── Toolbar actions ────────────────────────────────────────

  const handleFitView = useCallback(() => {
    const svgEl = svgRef.current;
    const zoomBehavior = zoomRef.current;
    const nodes = nodesRef.current;
    if (!svgEl || !zoomBehavior || nodes.length === 0) return;

    const { w, h } = mainSizeRef.current;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const nx = n.x ?? 0, ny = n.y ?? 0;
      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny;
      if (ny > maxY) maxY = ny;
    }
    const pad = 60;
    const rangeX = (maxX - minX) || 1;
    const rangeY = (maxY - minY) || 1;
    const scale = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const t = zoomIdentity.translate(w / 2 - cx * scale, h / 2 - cy * scale).scale(scale);
    select(svgEl).transition().duration(400).call(zoomBehavior.transform, t);
  }, []);

  const handleZoomIn = useCallback(() => {
    const svgEl = svgRef.current;
    const zoomBehavior = zoomRef.current;
    if (!svgEl || !zoomBehavior) return;
    select(svgEl).transition().duration(250).call(zoomBehavior.scaleBy, 1.4);
  }, []);

  const handleZoomOut = useCallback(() => {
    const svgEl = svgRef.current;
    const zoomBehavior = zoomRef.current;
    if (!svgEl || !zoomBehavior) return;
    select(svgEl).transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.4);
  }, []);

  const handleTidyUp = useCallback(() => {
    const sim = simulationRef.current;
    const nodes = nodesRef.current;
    if (!sim || nodes.length === 0) return;

    if (isTidy) {
      sim
        .force('radial', null)
        .force('x', null)
        .force('y', null)
        .force('charge', forceManyBody().strength(-120))
        .force('center', forceCenter(0, 0));
      for (const n of nodes) { n.fx = null; n.fy = null; }
      sim.alpha(0.8).restart();
      setIsTidy(false);
      return;
    }

    const depts = Array.from(new Set(nodes.map((n) => n.dept)));
    const deptAngle = new Map<string, number>();
    depts.forEach((d, i) => deptAngle.set(d, (i / depts.length) * Math.PI * 2));

    const maxLinks = max(nodes, (n) => n.linkCount) ?? 1;

    sim
      .force('center', null)
      .force('charge', forceManyBody().strength(-60))
      .force('radial', forceRadial<SimNode>(
        (d) => {
          const ratio = 1 - (d.linkCount / maxLinks);
          return 30 + ratio * 160;
        },
        0, 0
      ).strength(0.8))
      .force('x', forceX<SimNode>((d) => {
        const angle = deptAngle.get(d.dept) ?? 0;
        const ratio = 1 - (d.linkCount / maxLinks);
        const r = 30 + ratio * 160;
        return Math.cos(angle) * r * 0.4;
      }).strength(0.3))
      .force('y', forceY<SimNode>((d) => {
        const angle = deptAngle.get(d.dept) ?? 0;
        const ratio = 1 - (d.linkCount / maxLinks);
        const r = 30 + ratio * 160;
        return Math.sin(angle) * r * 0.4;
      }).strength(0.3));

    for (const n of nodes) { n.fx = null; n.fy = null; }
    sim.alpha(1).restart();
    setIsTidy(true);

    setTimeout(() => handleFitView(), 1200);
  }, [isTidy, handleFitView]);

  // ── Zoom to a specific node ─────────────────────────────────
  const zoomToNode = useCallback((nodeId: string) => {
    const svgEl = svgRef.current;
    const zoomBehavior = zoomRef.current;
    const nodes = nodesRef.current;
    if (!svgEl || !zoomBehavior) return;

    const targetNode = nodes.find((n) => n.id === nodeId);
    if (!targetNode) return;

    const { w, h } = mainSizeRef.current;
    const scale = 1.5;
    const nx = targetNode.x ?? 0;
    const ny = targetNode.y ?? 0;

    const t = zoomIdentity.translate(w / 2 - nx * scale, h / 2 - ny * scale).scale(scale);
    select(svgEl).transition().duration(500).call(zoomBehavior.transform, t);

    setSearchHighlightId(nodeId);
    setTimeout(() => setSearchHighlightId(null), 3000);
  }, []);

  // ── Handle path mode node click ─────────────────────────────
  const handlePathNodeClick = useCallback((nodeId: string) => {
    if (!pathNodeA) {
      setPathNodeA(nodeId);
    } else if (!pathNodeB && nodeId !== pathNodeA) {
      setPathNodeB(nodeId);
    } else {
      setPathNodeA(nodeId);
      setPathNodeB(null);
    }
  }, [pathNodeA, pathNodeB]);
  handlePathNodeClickRef.current = handlePathNodeClick;

  // ── Minimap click ──────────────────────────────────────────
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    const svgEl = svgRef.current;
    if (!canvas || !svgEl || !zoomRef.current) return;
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const nx = n.x ?? 0, ny = n.y ?? 0;
      if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const innerW = MINIMAP_W - MINIMAP_PAD * 2;
    const innerH = MINIMAP_H - MINIMAP_PAD * 2;
    const sc = Math.min(innerW / rangeX, innerH / rangeY);
    const ox = MINIMAP_PAD + (innerW - rangeX * sc) / 2;
    const oy = MINIMAP_PAD + (innerH - rangeY * sc) / 2;
    const graphX = (clickX - ox) / sc + minX;
    const graphY = (clickY - oy) / sc + minY;

    const { w: mainW, h: mainH } = mainSizeRef.current;
    const t = transformRef.current;
    const newT = zoomIdentity.translate(mainW / 2 - graphX * t.k, mainH / 2 - graphY * t.k).scale(t.k);
    select(svgEl).transition().duration(300).call(zoomRef.current.transform, newT);
  }, []);

  // ── Mount / data updates (debounced during streaming) ─────
  useEffect(() => {
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    const delay = isInitialBuildRef.current ? 0 : 250;
    rebuildTimerRef.current = setTimeout(() => buildGraph(), delay);
    return () => { if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current); };
  }, [buildGraph]);

  // ── Resize (update dimensions without full rebuild) ───────
  useEffect(() => {
    const handleResize = () => {
      if (!svgRef.current || !containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      mainSizeRef.current = { w, h };
      select(svgRef.current).attr('width', w).attr('height', h);
      drawMinimap();
    };
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => { observer.disconnect(); simulationRef.current?.stop(); };
  }, [drawMinimap]);

  // ── Close dropdowns on outside click ────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (filterOpen && !target.closest('[data-graph-filter]')) setFilterOpen(false);
      if (layoutDropdownOpen && !target.closest('[data-graph-layout]')) setLayoutDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen, layoutDropdownOpen]);

  // ── Context menu items ─────────────────────────────────────
  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    const ctx = ctxMenu.state.context;
    if (!ctx) return [];

    if (ctx.type === 'node') {
      const { node } = ctx;
      return [
        {
          id: 'open-viewer',
          label: 'Open in viewer',
          icon: <FileText size={14} />,
          onAction: () => onSelectFileRef.current(node.id, node.path),
        },
        {
          id: 'open-new-tab',
          label: 'Open in new tab',
          icon: <ExternalLink size={14} />,
          onAction: () => onOpenInNewTabRef.current?.(node.id, node.path),
        },
        {
          id: 'copy-link',
          label: 'Copy link',
          icon: <Link size={14} />,
          onAction: () => { navigator.clipboard.writeText(node.path); },
        },
      ];
    }

    return [
      {
        id: 'zoom-to-fit',
        label: 'Zoom to fit',
        icon: <Maximize2 size={14} />,
        onAction: handleFitView,
      },
    ];
  }, [ctxMenu.state.context, handleFitView]);

  const btnColor = '#4A4940';

  const layoutLabels: Record<LayoutPreset, string> = {
    force: 'Force-directed',
    radial: 'Radial',
    hierarchical: 'Hierarchical',
  };

  return (
    <div ref={containerRef} className="relative h-full w-full" style={{ backgroundColor: '#F2F1EA' }}>
      <svg ref={svgRef} className="h-full w-full" />

      {/* Context menu */}
      {ctxMenu.state.isOpen && (
        <ContextMenu
          ref={ctxMenu.menuRef}
          items={contextMenuItems}
          position={ctxMenu.state.adjustedPosition}
          onClose={ctxMenu.close}
        />
      )}

      {/* ── Top toolbar: Search + Filter + Layout + Path ───────── */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        {/* Search */}
        <div className="relative" data-graph-filter>
          {searchOpen ? (
            <div
              className="flex items-center gap-1 rounded-lg px-2 py-1"
              style={{
                backgroundColor: 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(43,42,37,0.15)',
              }}
            >
              <Search size={14} color={btnColor} />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes..."
                className="w-[160px] bg-transparent text-[12px] text-[#2B2A25] outline-none placeholder:text-[#A1A09A]"
              />
              <button
                onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchHighlightId(null); }}
                className="rounded p-0.5 hover:bg-black/[0.06]"
              >
                <X size={12} color={btnColor} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.06]"
              style={{
                backgroundColor: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(43,42,37,0.1)',
              }}
              title="Search nodes"
            >
              <Search size={15} color={btnColor} strokeWidth={2} />
            </button>
          )}

          {/* Search results dropdown */}
          {searchOpen && searchQuery.trim() && searchResults.length > 0 && (
            <div
              className="absolute left-0 top-full mt-1 w-[240px] overflow-hidden rounded-lg py-1 shadow-lg"
              style={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(43,42,37,0.12)',
              }}
            >
              {searchResults.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    zoomToNode(f.id);
                    setSearchQuery('');
                    setSearchOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-black/[0.04]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: deptColorMap.get(getDepartment(f.path)) ?? DEFAULT_COLOR }}
                  />
                  <span className="truncate text-[#2B2A25]">{getDisplayName(f.path)}</span>
                  <span className="ml-auto truncate text-[10px] text-[#A1A09A]">{getDepartment(f.path)}</span>
                </button>
              ))}
            </div>
          )}
          {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
            <div
              className="absolute left-0 top-full mt-1 w-[200px] rounded-lg px-3 py-2 shadow-lg"
              style={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(43,42,37,0.12)',
              }}
            >
              <span className="text-[12px] text-[#A1A09A]">No results found</span>
            </div>
          )}
        </div>

        {/* Department filter */}
        <div className="relative" data-graph-filter>
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.06]"
            style={{
              backgroundColor: hiddenDepts.size > 0 ? 'rgba(91,154,101,0.12)' : 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${hiddenDepts.size > 0 ? 'rgba(91,154,101,0.3)' : 'rgba(43,42,37,0.1)'}`,
            }}
            title="Filter departments"
          >
            <Filter size={15} color={hiddenDepts.size > 0 ? '#5B9A65' : btnColor} strokeWidth={2} />
          </button>

          {filterOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-[200px] overflow-hidden rounded-lg py-1 shadow-lg"
              style={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(43,42,37,0.12)',
              }}
            >
              <div className="border-b border-black/[0.06] px-3 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#A1A09A]">Departments</span>
                  <button
                    onClick={() => setHiddenDepts(new Set())}
                    className="text-[10px] font-medium text-[#5B9A65] hover:underline"
                  >
                    Show all
                  </button>
                </div>
              </div>
              {departments.map((dept) => {
                const isHidden = hiddenDepts.has(dept);
                const color = deptColorMap.get(dept) ?? DEFAULT_COLOR;
                const count = files.filter((f) => getDepartment(f.path) === dept).length;
                return (
                  <button
                    key={dept}
                    onClick={() => {
                      setHiddenDepts((prev) => {
                        const next = new Set(prev);
                        if (next.has(dept)) next.delete(dept);
                        else next.add(dept);
                        return next;
                      });
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-black/[0.04]"
                    style={{ opacity: isHidden ? 0.4 : 1 }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-[#2B2A25]">{dept}</span>
                    <span className="ml-auto text-[10px] text-[#A1A09A]">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Layout presets */}
        <div className="relative" data-graph-layout>
          <button
            onClick={() => setLayoutDropdownOpen(!layoutDropdownOpen)}
            className="flex h-8 items-center gap-1 rounded-lg px-2 transition-colors hover:bg-black/[0.06]"
            style={{
              backgroundColor: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(43,42,37,0.1)',
            }}
            title="Layout preset"
          >
            <LayoutGrid size={14} color={btnColor} strokeWidth={2} />
            <span className="text-[11px] font-medium text-[#5A5950]">{layoutLabels[layoutPreset]}</span>
            <ChevronDown size={12} color={btnColor} />
          </button>

          {layoutDropdownOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-[160px] overflow-hidden rounded-lg py-1 shadow-lg"
              style={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(43,42,37,0.12)',
              }}
            >
              {(['force', 'radial', 'hierarchical'] as LayoutPreset[]).map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setLayoutPreset(preset);
                    setLayoutDropdownOpen(false);
                    setIsTidy(false);
                    isInitialBuildRef.current = true;
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-black/[0.04]"
                  style={layoutPreset === preset ? { backgroundColor: 'rgba(91,154,101,0.08)' } : undefined}
                >
                  <span className="text-[#2B2A25]">{layoutLabels[preset]}</span>
                  {layoutPreset === preset && (
                    <span className="ml-auto text-[10px] text-[#5B9A65]">Active</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Path highlighting toggle */}
        <button
          onClick={() => setPathMode(!pathMode)}
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.06]"
          style={{
            backgroundColor: pathMode ? 'rgba(91,154,101,0.12)' : 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${pathMode ? 'rgba(91,154,101,0.3)' : 'rgba(43,42,37,0.1)'}`,
          }}
          title={pathMode ? 'Exit path mode' : 'Find path between nodes'}
        >
          <Route size={15} color={pathMode ? '#5B9A65' : btnColor} strokeWidth={2} />
        </button>
      </div>

      {/* Path mode status bar */}
      {pathMode && (
        <div
          className="absolute top-14 left-3 z-10 flex items-center gap-2 rounded-lg px-3 py-1.5"
          style={{
            backgroundColor: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(91,154,101,0.2)',
          }}
        >
          <Route size={12} color="#5B9A65" />
          <span className="text-[11px] text-[#5A5950]">
            {!pathNodeA
              ? 'Click first node'
              : !pathNodeB
              ? 'Click second node'
              : highlightedPath.size > 0
              ? `Path: ${highlightedPath.size} nodes`
              : 'No path found'}
          </span>
          {(pathNodeA || pathNodeB) && (
            <button
              onClick={() => { setPathNodeA(null); setPathNodeB(null); }}
              className="ml-1 rounded p-0.5 hover:bg-black/[0.06]"
            >
              <X size={11} color={btnColor} />
            </button>
          )}
        </div>
      )}

      {/* Toolbar + Minimap */}
      <div className="absolute bottom-3 left-3 flex flex-col items-center gap-1.5">
        {/* Toolbar */}
        <div
          className="flex items-center gap-0.5 rounded-lg px-1 py-0.5"
          style={{
            backgroundColor: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(43,42,37,0.1)',
          }}
        >
          <ToolbarBtn label="Fit view" onClick={handleFitView}>
            <Maximize2 size={15} color={btnColor} strokeWidth={2} />
          </ToolbarBtn>
          <ToolbarBtn label="Zoom in" onClick={handleZoomIn}>
            <ZoomIn size={15} color={btnColor} strokeWidth={2} />
          </ToolbarBtn>
          <ToolbarBtn label="Zoom out" onClick={handleZoomOut}>
            <ZoomOut size={15} color={btnColor} strokeWidth={2} />
          </ToolbarBtn>
          <ToolbarBtn
            label={isTidy ? 'Reset layout' : 'Tidy up'}
            onClick={handleTidyUp}
            active={isTidy}
          >
            <Sparkles size={15} color={isTidy ? '#5B9A65' : btnColor} strokeWidth={2} />
          </ToolbarBtn>
        </div>

        {/* Minimap (hidden on small screens) */}
        <canvas
          ref={minimapCanvasRef}
          onClick={handleMinimapClick}
          className="hidden cursor-pointer sm:block"
          style={{ width: MINIMAP_W, height: MINIMAP_H, borderRadius: 8 }}
        />
      </div>
    </div>
  );
}
