/**
 * SVG force-directed intelligence graph view.
 * No D3 dependency — pure React + requestAnimationFrame spring simulation.
 *
 * Node types: incident | decision | action | outcome | user | team | system | pattern
 * Edge relationships (visual style):
 *   observed_fact    → solid grey
 *   correlation      → dashed grey
 *   rule_derived     → purple dotted
 *   llm_suggestion   → amber dotted
 *   confirmed_causal → solid thick green
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_COLORS = {
  incident:   '#ef4444',
  decision:   '#3b82f6',
  action:     '#8b5cf6',
  outcome:    '#22c55e',
  user:       '#f59e0b',
  team:       '#06b6d4',
  system:     '#64748b',
  pattern:    '#ec4899',
  dependency: '#a78bfa',
};

const EDGE_STYLES = {
  observed_fact:   { stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '' },
  correlation:     { stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '6,3' },
  rule_derived:    { stroke: '#a855f7', strokeWidth: 1.5, strokeDasharray: '4,4' },
  llm_suggestion:  { stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '4,4' },
  confirmed_causal:{ stroke: '#22c55e', strokeWidth: 3,   strokeDasharray: '' },
};

const NODE_RADIUS = 14;
const SIM_STEPS   = 60;
const K_REPEL     = 4000;
const K_ATTRACT   = 0.05;
const K_CENTER    = 0.015;

// ─── Spring layout simulation ─────────────────────────────────────────────────

function stableJitter(value) {
  let hash = 0;
  for (const char of String(value || '')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 1000) / 1000) - 0.5;
}

function buildInitialPositions(nodes, width, height) {
  const cx = width / 2, cy = height / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return nodes.reduce((acc, n, i) => {
    const angle = i * goldenAngle;
    const radius = Math.min(210, 78 + Math.sqrt(i + 1) * 42);
    const jitter = stableJitter(n.id) * 18;
    acc[n.id] = {
      x: cx + Math.cos(angle) * (radius + jitter),
      y: cy + Math.sin(angle) * (radius - jitter),
    };
    return acc;
  }, {});
}

function runSimulation(nodes, edges, width, height) {
  if (!nodes.length) return {};
  let pos = buildInitialPositions(nodes, width, height);
  const cx = width / 2, cy = height / 2;

  for (let step = 0; step < SIM_STEPS; step++) {
    const forces = {};
    nodes.forEach(n => { forces[n.id] = { x: 0, y: 0 }; });

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = pos[a.id].x - pos[b.id].x;
        const dy = pos[a.id].y - pos[b.id].y;
        const dist2 = dx * dx + dy * dy + 1;
        const force = K_REPEL / dist2;
        forces[a.id].x += dx * force;
        forces[a.id].y += dy * force;
        forces[b.id].x -= dx * force;
        forces[b.id].y -= dy * force;
      }
    }

    // Attraction along edges
    edges.forEach(edge => {
      if (!pos[edge.from] || !pos[edge.to]) return;
      const dx = pos[edge.to].x - pos[edge.from].x;
      const dy = pos[edge.to].y - pos[edge.from].y;
      forces[edge.from].x += dx * K_ATTRACT;
      forces[edge.from].y += dy * K_ATTRACT;
      forces[edge.to].x   -= dx * K_ATTRACT;
      forces[edge.to].y   -= dy * K_ATTRACT;
    });

    // Centre pull
    nodes.forEach(n => {
      forces[n.id].x += (cx - pos[n.id].x) * K_CENTER;
      forces[n.id].y += (cy - pos[n.id].y) * K_CENTER;
    });

    // Apply
    nodes.forEach(n => {
      pos[n.id] = {
        x: Math.max(NODE_RADIUS, Math.min(width - NODE_RADIUS,  pos[n.id].x + forces[n.id].x)),
        y: Math.max(NODE_RADIUS, Math.min(height - NODE_RADIUS, pos[n.id].y + forces[n.id].y)),
      };
    });
  }
  return pos;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 11, marginBottom: 8 }}>
      {Object.entries(NODE_COLORS).map(([type, color]) => (
        <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={color} /></svg>
          {type}
        </span>
      ))}
      <span style={{ color: '#64748b', marginLeft: 8 }}>|</span>
      {Object.entries(EDGE_STYLES).map(([rel, s]) => (
        <span key={rel} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="28" height="10">
            <line x1="0" y1="5" x2="28" y2="5"
              stroke={s.stroke} strokeWidth={s.strokeWidth}
              strokeDasharray={s.strokeDasharray || undefined} />
          </svg>
          {rel.replace(/_/g, ' ')}
        </span>
      ))}
    </div>
  );
}

// ─── Filter panel ─────────────────────────────────────────────────────────────

function FilterPanel({ nodeTypes, edgeRels, activeTypes, activeRels, onTypeToggle, onRelToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>Node:</span>
      {nodeTypes.map(t => (
        <button key={t} onClick={() => onTypeToggle(t)}
          style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 12, border: '1px solid',
            background: activeTypes.has(t) ? (NODE_COLORS[t] || '#3b82f6') : 'transparent',
            color: activeTypes.has(t) ? '#fff' : '#64748b',
            borderColor: NODE_COLORS[t] || '#94a3b8',
            cursor: 'pointer',
          }}>
          {t}
        </button>
      ))}
      <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center', marginLeft: 8 }}>Edge:</span>
      {edgeRels.map(r => (
        <button key={r} onClick={() => onRelToggle(r)}
          style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 12, border: '1px solid #94a3b8',
            background: activeRels.has(r) ? '#1e293b' : 'transparent',
            color: activeRels.has(r) ? '#fff' : '#64748b',
            cursor: 'pointer',
          }}>
          {r.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function exportGraphJson(graph, title) {
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), title, graph }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tracecrumb-${String(title || 'intelligence-graph').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function GraphView({ graph, title = 'Intelligence Graph' }) {
  const WIDTH  = 900;
  const HEIGHT = 540;

  const allNodes = useMemo(() => Object.values(graph?.nodes || {}), [graph]);
  const allEdges = useMemo(() => Object.values(graph?.edges || {}), [graph]);

  const allNodeTypes = useMemo(() => [...new Set(allNodes.map(n => n.type))], [allNodes]);
  const allEdgeRels  = useMemo(() => [...new Set(allEdges.map(e => e.relationship || 'observed_fact'))], [allEdges]);

  const [activeTypes, setActiveTypes] = useState(() => new Set(allNodeTypes));
  const [activeRels,  setActiveRels]  = useState(() => new Set(allEdgeRels));
  const [selected,    setSelected]    = useState(null);
  const [zoom,        setZoom]        = useState(1);
  const [pan,         setPan]         = useState({ x: 0, y: 0 });
  const [isDragging,  setIsDragging]  = useState(false);
  const [newNodeIds, setNewNodeIds] = useState(() => new Set());
  const [activityMessage, setActivityMessage] = useState('');
  const dragRef   = useRef(null);
  const svgRef    = useRef(null);
  const previousNodeIdsRef = useRef(null);

  // Animate only records added after the graph has loaded. Existing memory stays stable.
  useEffect(() => {
    const currentIds = new Set(allNodes.map(n => n.id));
    if (previousNodeIdsRef.current === null) {
      previousNodeIdsRef.current = currentIds;
      return;
    }
    const added = allNodes.filter(n => !previousNodeIdsRef.current.has(n.id));
    previousNodeIdsRef.current = currentIds;
    if (!added.length) return;
    setNewNodeIds(new Set(added.map(n => n.id)));
    setActivityMessage(`${added.length} new memory node${added.length === 1 ? '' : 's'} recorded`);
    const animationTimer = setTimeout(() => setNewNodeIds(new Set()), 1800);
    const messageTimer = setTimeout(() => setActivityMessage(''), 2600);
    return () => { clearTimeout(animationTimer); clearTimeout(messageTimer); };
  }, [allNodes.map(n => n.id).join('|')]);

  // Re-init filters when graph changes
  useEffect(() => {
    setActiveTypes(new Set(allNodeTypes));
    setActiveRels(new Set(allEdgeRels));
  }, [allNodeTypes.join(','), allEdgeRels.join(',')]);

  const visibleNodes = useMemo(() =>
    allNodes.filter(n => activeTypes.has(n.type)), [allNodes, activeTypes]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() =>
    allEdges.filter(e =>
      visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to) &&
      activeRels.has(e.relationship || 'observed_fact'),
    ), [allEdges, visibleNodeIds, activeRels]);

  const positions = useMemo(
    () => runSimulation(visibleNodes, visibleEdges, WIDTH, HEIGHT),
    [visibleNodes.map(n => n.id).join(','), visibleEdges.length],
  );

  const toggleType = useCallback(t => {
    setActiveTypes(prev => { const s = new Set(prev); s.has(t) ? s.delete(t) : s.add(t); return s; });
    setSelected(null);
  }, []);

  const toggleRel = useCallback(r => {
    setActiveRels(prev => { const s = new Set(prev); s.has(r) ? s.delete(r) : s.add(r); return s; });
  }, []);

  // Pan handling
  const onMouseDown = useCallback(e => {
    if (e.target.tagName === 'circle' || e.target.tagName === 'text') return;
    dragRef.current = { startX: e.clientX - pan.x, startY: e.clientY - pan.y };
    setIsDragging(true);
  }, [pan]);

  const onMouseMove = useCallback(e => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY });
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; setIsDragging(false); }, []);

  const onWheel = useCallback(e => {
    e.preventDefault();
    setZoom(z => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const selectedNode = selected ? (graph?.nodes?.[selected] || null) : null;

  if (!allNodes.length) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        <p style={{ marginBottom: 8, fontWeight: 600 }}>Intelligence graph is empty</p>
        <p>Nodes are added automatically as you submit incidents and record outcomes.</p>
      </div>
    );
  }

  return (
    <div style={{ background: '#0f172a', borderRadius: 12, padding: 16, userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>{title}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={() => exportGraphJson(graph, title)}
            style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontSize: 11 }}>Export graph</button>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.2))}
            style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>+</button>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))}
            style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>−</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setSelected(null); }}
            style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontSize: 11 }}>Reset</button>
        </div>
      </div>

      <div style={{ color: '#94a3b8' }}>
        <Legend />
        <FilterPanel
          nodeTypes={allNodeTypes} edgeRels={allEdgeRels}
          activeTypes={activeTypes} activeRels={activeRels}
          onTypeToggle={toggleType} onRelToggle={toggleRel}
        />
      </div>

      <div className="graph-canvas" style={{ position: 'relative', overflow: 'hidden', borderRadius: 8, border: '1px solid #1e293b' }}>
        {activityMessage && <div className="graph-activity" role="status"><span className="graph-activity-dot" />{activityMessage}</div>}
        <svg
          ref={svgRef}
          width={WIDTH} height={HEIGHT}
          style={{ display: 'block', cursor: isDragging ? 'grabbing' : 'grab', background: '#0f172a' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#475569" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {visibleEdges.map(edge => {
              const from = positions[edge.from];
              const to   = positions[edge.to];
              if (!from || !to) return null;
              const style = EDGE_STYLES[edge.relationship] || EDGE_STYLES.observed_fact;

              // Offset line endpoints to node radius
              const dx = to.x - from.x, dy = to.y - from.y;
              const len = Math.sqrt(dx*dx + dy*dy) || 1;
              const r = NODE_RADIUS + 4;
              const x1 = from.x + (dx / len) * r;
              const y1 = from.y + (dy / len) * r;
              const x2 = to.x   - (dx / len) * r;
              const y2 = to.y   - (dy / len) * r;

              return (
                <line key={edge.id}
                  className={newNodeIds.has(edge.from) || newNodeIds.has(edge.to) ? 'graph-edge-new' : ''}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
                  strokeDasharray={style.strokeDasharray || undefined}
                  markerEnd="url(#arrowhead)"
                  opacity={0.7}
                />
              );
            })}

            {/* Nodes */}
            {visibleNodes.map(node => {
              const pos = positions[node.id];
              if (!pos) return null;
              const color  = NODE_COLORS[node.type] || '#64748b';
              const isSel  = selected === node.id;

              const isNew = newNodeIds.has(node.id);
              return (
                <g key={node.id}
                  className="graph-node-position"
                  transform={`translate(${pos.x},${pos.y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); setSelected(isSel ? null : node.id); }}
                >
                  <g className={isNew ? 'graph-node-enter' : ''}>
                    {isNew && <circle className="graph-node-pulse" r={NODE_RADIUS + 7} fill="none" stroke={color} strokeWidth={2} />}
                    {isSel && (
                      <circle r={NODE_RADIUS + 6} fill="none" stroke={color} strokeWidth={2} opacity={0.5} />
                    )}
                    <circle r={NODE_RADIUS} fill={color} stroke="#0f172a" strokeWidth={2} />
                    <text
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={7} fill="#fff" fontWeight={600}
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.type.slice(0, 3).toUpperCase()}
                    </text>
                    <text
                      y={NODE_RADIUS + 10} textAnchor="middle"
                      fontSize={9} fill="#94a3b8"
                      style={{ pointerEvents: 'none' }}
                    >
                      {(node.label || '').slice(0, 24)}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Node detail panel */}
        {selectedNode && (
          <div style={{
            position: 'absolute', top: 12, right: 12, width: 240,
            background: '#1e293b', borderRadius: 8, padding: 12,
            border: '1px solid #334155', fontSize: 12, color: '#cbd5e1',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, color: NODE_COLORS[selectedNode.type] || '#94a3b8', textTransform: 'uppercase', fontSize: 10 }}>
                {selectedNode.type}
              </span>
              <button onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14 }}>×</button>
            </div>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#f1f5f9', fontSize: 13 }}>
              {selectedNode.label}
            </div>
            {selectedNode.provenance && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: '#64748b' }}>Source: </span>
                <span style={{ color: '#94a3b8' }}>{selectedNode.provenance.source}</span>
                {' · '}
                <span style={{ color: '#64748b' }}>Conf: </span>
                <span style={{ color: '#94a3b8' }}>{Math.round((selectedNode.provenance.confidence || 0) * 100)}%</span>
              </div>
            )}
            {selectedNode.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {selectedNode.tags.map(t => (
                  <span key={t} style={{ background: '#0f172a', borderRadius: 4, padding: '1px 6px', fontSize: 10 }}>{t}</span>
                ))}
              </div>
            )}
            {selectedNode.data && Object.keys(selectedNode.data).length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', color: '#64748b', fontSize: 11 }}>Raw data</summary>
                <pre style={{ fontSize: 10, color: '#475569', marginTop: 4, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(selectedNode.data, null, 2)}
                </pre>
              </details>
            )}
            {/* Connected edges */}
            {(() => {
              const connected = allEdges.filter(e => e.from === selectedNode.id || e.to === selectedNode.id);
              if (!connected.length) return null;
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Connections ({connected.length})</div>
                  {connected.slice(0, 4).map(e => {
                    const other = graph.nodes[e.from === selectedNode.id ? e.to : e.from];
                    if (!other) return null;
                    return (
                      <div key={e.id} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>
                        {e.from === selectedNode.id ? '→' : '←'} {e.type} {other.label?.slice(0, 20) || other.type}
                      </div>
                    );
                  })}
                  {connected.length > 4 && <div style={{ color: '#64748b', fontSize: 10 }}>+{connected.length - 4} more</div>}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: '#334155' }}>
        {visibleNodes.length} nodes · {visibleEdges.length} edges · scroll to zoom · drag to pan · click node to inspect
      </div>
    </div>
  );
}
