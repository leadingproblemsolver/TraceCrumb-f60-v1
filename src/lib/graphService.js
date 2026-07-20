/**
 * Intelligence graph service.
 * Pure graph operations (addNode, addEdge, …) take a graph object and return a new one.
 * DB operations (load*, save*) are async and interact with Supabase.
 *
 * Graph JSON schema
 * ─────────────────
 * nodes: { [id]: { id, type, label, data, provenance, tags, updated_at } }
 * edges: { [id]: { id, from, to, type, relationship, label, confidence, evidence, provenance, updated_at } }
 * patterns: { failure_patterns, successful_resolutions, known_risks, unresolved }
 * index:    { by_service, by_type, by_outcome }
 *
 * Node types: incident | decision | action | outcome | user | team | system | pattern | dependency
 * Edge types: caused | correlated | resolved_by | attempted | failed | escalated | depends_on | member_of
 * Relationship types (visual): observed_fact | correlation | rule_derived | llm_suggestion | confirmed_causal
 */

// Supabase is loaded lazily so pure graph functions can be imported in Node.js test
// contexts (where import.meta.env is undefined) without crashing.
let _supabase = null;
async function db() {
  if (!_supabase) {
    const mod = await import('./supabaseClient.js');
    _supabase = mod.supabase;
  }
  return _supabase;
}

// ─── ID generation ──────────────────────────────────────────────────────────

function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Empty graph factory ─────────────────────────────────────────────────────

export function emptyGraph(orgId = null) {
  return {
    version: '1.0',
    org_id: orgId,
    nodes: {},
    edges: {},
    patterns: {
      failure_patterns: [],
      successful_resolutions: [],
      known_risks: [],
      unresolved: [],
    },
    index: {
      by_service: {},
      by_type: {},
      by_outcome: {},
    },
  };
}

// ─── Index maintenance ───────────────────────────────────────────────────────

function indexAdd(index, node) {
  const i = {
    by_service: { ...index.by_service },
    by_type:    { ...index.by_type },
    by_outcome: { ...index.by_outcome },
  };

  const service = node.data?.service_name || node.data?.service;
  if (service) {
    if (!i.by_service[service]) i.by_service[service] = [];
    if (!i.by_service[service].includes(node.id)) i.by_service[service] = [...i.by_service[service], node.id];
  }

  if (!i.by_type[node.type]) i.by_type[node.type] = [];
  if (!i.by_type[node.type].includes(node.id)) i.by_type[node.type] = [...i.by_type[node.type], node.id];

  return i;
}

// ─── Pure graph operations ───────────────────────────────────────────────────

export function addNode(graph, nodeData) {
  const id  = nodeData.id || uid();
  const now = new Date().toISOString();
  const node = {
    id,
    type:  nodeData.type,
    label: nodeData.label || '',
    data:  nodeData.data  || {},
    provenance: {
      source:     nodeData.source     || 'observed',
      confidence: nodeData.confidence ?? 1.0,
      evidence:   nodeData.evidence   || [],
      created_at: now,
      created_by: nodeData.created_by || null,
    },
    tags:       nodeData.tags || [],
    updated_at: now,
  };

  return {
    ...graph,
    nodes: { ...graph.nodes, [id]: node },
    index: indexAdd(graph.index, node),
  };
}

export function updateNode(graph, nodeId, patch) {
  const existing = graph.nodes[nodeId];
  if (!existing) return graph;
  const updated = { ...existing, ...patch, id: nodeId, updated_at: new Date().toISOString() };
  return { ...graph, nodes: { ...graph.nodes, [nodeId]: updated } };
}

export function addEdge(graph, edgeData) {
  // Deduplicate: if same from→to→type exists, upgrade confidence instead of adding duplicate
  const existing = Object.values(graph.edges).find(
    e => e.from === edgeData.from && e.to === edgeData.to && e.type === edgeData.type,
  );
  if (existing) {
    if ((edgeData.confidence ?? 0) > existing.confidence) {
      return {
        ...graph,
        edges: {
          ...graph.edges,
          [existing.id]: { ...existing, confidence: edgeData.confidence, updated_at: new Date().toISOString() },
        },
      };
    }
    return graph;
  }

  const id  = uid();
  const now = new Date().toISOString();
  const edge = {
    id,
    from:         edgeData.from,
    to:           edgeData.to,
    type:         edgeData.type,
    relationship: edgeData.relationship || 'observed_fact',
    label:        edgeData.label        || '',
    confidence:   edgeData.confidence   ?? 0.8,
    evidence:     edgeData.evidence     || [],
    provenance:   edgeData.provenance   || {},
    updated_at:   now,
  };

  return { ...graph, edges: { ...graph.edges, [id]: edge } };
}

// ─── Domain helpers ──────────────────────────────────────────────────────────

export function addIncidentToGraph(graph, incident, userId) {
  return addNode(graph, {
    type:       'incident',
    label:      incident.title || 'Incident',
    data: {
      incident_id:   incident.id,
      service_name:  incident.service_name,
      severity:      incident.severity,
      symptom_text:  incident.symptom_text,
      fingerprint:   incident.fingerprint || [],
      created_at:    incident.created_at,
    },
    source:     'observed',
    confidence: 1.0,
    evidence:   [`incident:${incident.id}`],
    created_by: userId,
    tags:       [`service:${incident.service_name}`, `severity:${incident.severity}`],
  });
}

export function addDecisionToGraph(graph, incidentNodeId, recommendation, userId) {
  const g1 = addNode(graph, {
    type:  'decision',
    label: recommendation.suggested_branch || 'Diagnostic branch',
    data: {
      recommendation_id: recommendation.id,
      branch:            recommendation.suggested_branch,
      provider:          recommendation.provider,
      confidence:        recommendation.confidence,
      priority_checks:   recommendation.priority_checks || [],
    },
    source:     recommendation.provider === 'heuristic' ? 'rule_derived' : 'llm_suggestion',
    confidence: recommendation.confidence || 0.5,
    evidence:   [`recommendation:${recommendation.id}`],
    created_by: userId,
  });

  // Find the node we just added (last added node by evidence match)
  const decisionNodeId = Object.keys(g1.nodes).find(
    id => g1.nodes[id].data?.recommendation_id === recommendation.id,
  );

  if (!decisionNodeId || !incidentNodeId) return { graph: g1, decisionNodeId };

  const g2 = addEdge(g1, {
    from:         incidentNodeId,
    to:           decisionNodeId,
    type:         'attempted',
    relationship: recommendation.provider === 'heuristic' ? 'rule_derived' : 'llm_suggestion',
    label:        'diagnostic branch attempted',
    confidence:   recommendation.confidence || 0.5,
    evidence:     [`recommendation:${recommendation.id}`],
  });

  return { graph: g2, decisionNodeId };
}

export function recordOutcomeInGraph(graph, incidentNodeId, decisionNodeId, outcome, userId) {
  const labels = {
    successful: 'Branch led to root cause',
    partial:    'Branch partially useful',
    failed:     'Branch did not lead to root cause',
  };
  const label = labels[outcome.usefulness] || 'Outcome unknown';

  const g1 = addNode(graph, {
    type:  'outcome',
    label,
    data: {
      outcome_id:   outcome.id,
      usefulness:   outcome.usefulness,
      outcome:      outcome.usefulness === 'successful' ? 'successful'
                  : outcome.usefulness === 'failed'     ? 'failed' : 'partial',
      resolution:   outcome.resolution || null,
    },
    source:     'observed',
    confidence: 1.0,
    evidence:   [`outcome:${outcome.id}`],
    created_by: userId,
  });

  const outcomeNodeId = Object.keys(g1.nodes).find(
    id => g1.nodes[id].data?.outcome_id === outcome.id,
  );

  const edgeType = outcome.usefulness === 'successful' ? 'resolved_by' : 'failed';

  let g2 = g1;
  if (outcomeNodeId && incidentNodeId) {
    g2 = addEdge(g2, {
      from: incidentNodeId, to: outcomeNodeId,
      type: edgeType, relationship: 'observed_fact',
      label, confidence: 1.0, evidence: [`outcome:${outcome.id}`],
    });
  }
  if (outcomeNodeId && decisionNodeId) {
    g2 = addEdge(g2, {
      from: decisionNodeId, to: outcomeNodeId,
      type: edgeType, relationship: 'observed_fact',
      label: outcome.usefulness === 'successful' ? 'led to resolution' : 'was not effective',
      confidence: 1.0,
    });
  }

  // Update outcome index
  const key = outcome.usefulness === 'successful' ? 'successful'
            : outcome.usefulness === 'failed'     ? 'failed' : 'unknown';
  const existing = g2.index.by_outcome[key] || [];
  const g3 = {
    ...g2,
    index: {
      ...g2.index,
      by_outcome: {
        ...g2.index.by_outcome,
        [key]: incidentNodeId && !existing.includes(incidentNodeId)
          ? [...existing, incidentNodeId]
          : existing,
      },
    },
  };

  return inferPatterns(g3);
}

export function findIncidentNode(graph, incidentId) {
  return Object.values(graph.nodes).find(
    n => n.type === 'incident' && n.data?.incident_id === incidentId,
  ) || null;
}

// ─── Subgraph retrieval ───────────────────────────────────────────────────────

export function retrieveSubgraph(graph, incident, options = {}) {
  const { maxIncidents = 5 } = options;
  const fp          = incident.fingerprint || [];
  const serviceName = incident.service_name || '';
  const severity    = incident.severity || '';

  const incidentNodeIds = graph.index?.by_type?.incident || [];

  const scored = incidentNodeIds
    .map(id => graph.nodes[id])
    .filter(Boolean)
    .map(node => {
      let score = 0;
      const nfp = node.data?.fingerprint || [];

      // Jaccard similarity on fingerprint tokens
      if (fp.length && nfp.length) {
        const A = new Set(fp), B = new Set(nfp);
        let inter = 0;
        A.forEach(x => B.has(x) && inter++);
        score += (inter / new Set([...A, ...B]).size) * 0.6;
      }
      if (serviceName && node.data?.service_name === serviceName) score += 0.3;
      if (severity    && node.data?.severity      === severity)    score += 0.1;

      return { node, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxIncidents);

  const subgraphNodeIds = new Set();
  const relevantEdges   = [];

  scored.forEach(({ node }) => {
    subgraphNodeIds.add(node.id);
    Object.values(graph.edges).forEach(edge => {
      if (edge.from === node.id || edge.to === node.id) {
        relevantEdges.push(edge);
        subgraphNodeIds.add(edge.from);
        subgraphNodeIds.add(edge.to);
      }
    });
  });

  const subgraphNodes = {};
  subgraphNodeIds.forEach(id => { if (graph.nodes[id]) subgraphNodes[id] = graph.nodes[id]; });

  return {
    nodes:            subgraphNodes,
    edges:            relevantEdges.filter(e => subgraphNodeIds.has(e.from) && subgraphNodeIds.has(e.to)),
    matchedIncidents: scored,
    patterns:         graph.patterns,
  };
}

// ─── Memory context (formatted for LLM packet) ───────────────────────────────

export function buildMemoryContext(subgraph) {
  const { matchedIncidents = [], nodes = {}, edges = [], patterns = {} } = subgraph || {};

  if (!matchedIncidents.length) {
    return { has_memory: false, cold_start: true, memory_items: [], patterns: [], warnings: [] };
  }

  const memory_items = matchedIncidents.map(({ node, score }) => {
    const iid = node.id;

    const decisions = edges
      .filter(e => e.from === iid && e.type === 'attempted')
      .map(e => nodes[e.to]).filter(Boolean);

    const successEdges = edges.filter(e => e.from === iid && e.type === 'resolved_by');
    const failedEdges  = edges.filter(e => e.from === iid && e.type === 'failed');

    const successOutcome = successEdges.map(e => nodes[e.to]).filter(Boolean)[0];
    const failedActions  = failedEdges.map(e => nodes[e.to]).filter(Boolean);

    return {
      incident_id:            iid,
      match_score:            score,
      similarity_pct:         Math.round(score * 100),
      label:                  node.label,
      service:                node.data?.service_name,
      severity:               node.data?.severity,
      confirmed_root_cause:   node.data?.confirmed_root_cause || null,
      decisions_tried:        decisions.map(d => d.data?.branch || d.label),
      successful_resolution:  successOutcome ? (successOutcome.data?.resolution || successOutcome.label) : null,
      failed_approaches:      failedActions.map(f => ({
        action: f.label,
        reason: f.data?.failure_reason || 'recorded as failed',
      })),
      source: `graph_node:${iid}`,
    };
  });

  return {
    has_memory:               true,
    cold_start:               false,
    incident_count_considered: matchedIncidents.length,
    memory_items,
    patterns:  (patterns.failure_patterns || []).slice(0, 3),
    warnings:  (patterns.known_risks      || []).slice(0, 2),
  };
}

// ─── Pattern inference ────────────────────────────────────────────────────────

export function inferPatterns(graph) {
  const incidentNodeIds = graph.index?.by_type?.incident || [];
  const failedSet   = new Set(graph.index?.by_outcome?.failed      || []);
  const successSet  = new Set(graph.index?.by_outcome?.successful   || []);
  const unknownSet  = new Set(graph.index?.by_outcome?.unknown      || []);

  // Known risks: services with ≥2 failed first-branch outcomes
  const serviceFailures = {};
  incidentNodeIds.forEach(id => {
    const node = graph.nodes[id];
    if (!node) return;
    const svc = node.data?.service_name;
    if (svc && failedSet.has(id)) serviceFailures[svc] = (serviceFailures[svc] || 0) + 1;
  });
  const known_risks = Object.entries(serviceFailures)
    .filter(([, n]) => n >= 2)
    .map(([system, n]) => ({
      system, risk: `${n} incidents with failed first diagnostic branch`, evidence: [`${n} failed outcomes`],
    }));

  // Successful resolutions with recorded outcome
  const successful_resolutions = [];
  Array.from(successSet).forEach(incidentId => {
    const node = graph.nodes[incidentId];
    if (!node) return;
    Object.values(graph.edges)
      .filter(e => e.from === incidentId && e.type === 'resolved_by')
      .forEach(edge => {
        const o = graph.nodes[edge.to];
        if (o?.data?.resolution) {
          successful_resolutions.push({
            service:        node.data?.service_name,
            incident_type:  node.label,
            resolution:     o.data.resolution,
            confidence:     0.9,
            source:         `outcome:${o.data.outcome_id}`,
          });
        }
      });
  });

  // Unresolved: incidents with no outcome recorded
  const unresolved = incidentNodeIds.filter(
    id => !failedSet.has(id) && !successSet.has(id) && !unknownSet.has(id),
  );

  return {
    ...graph,
    patterns: {
      ...graph.patterns,
      known_risks:            known_risks.slice(0, 10),
      successful_resolutions: successful_resolutions.slice(0, 20),
      unresolved,
    },
  };
}

// ─── Merge org + user graphs ──────────────────────────────────────────────────

export function mergeGraphs(orgGraph, userGraph) {
  const merged = {
    ...orgGraph,
    nodes: { ...orgGraph.nodes, ...userGraph.nodes },
    edges: { ...orgGraph.edges, ...userGraph.edges },
  };

  // Rebuild full index
  const index = { by_service: {}, by_type: {}, by_outcome: {} };
  Object.values(merged.nodes).forEach(node => {
    const svc = node.data?.service_name || node.data?.service;
    if (svc) {
      if (!index.by_service[svc]) index.by_service[svc] = [];
      if (!index.by_service[svc].includes(node.id)) index.by_service[svc].push(node.id);
    }
    if (!index.by_type[node.type]) index.by_type[node.type] = [];
    if (!index.by_type[node.type].includes(node.id)) index.by_type[node.type].push(node.id);
  });

  ['successful', 'failed', 'unknown'].forEach(k => {
    const a = orgGraph.index?.by_outcome?.[k] || [];
    const b = userGraph.index?.by_outcome?.[k] || [];
    index.by_outcome[k] = [...new Set([...a, ...b])];
  });

  return { ...merged, index };
}

// ─── DB operations ────────────────────────────────────────────────────────────

export async function loadOrgGraph(orgId) {
  const supabase = await db();
  const { data, error } = await supabase
    .from('org_intelligence_graph')
    .select('graph, version')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data?.graph ? { ...emptyGraph(orgId), ...data.graph, _dbVersion: data.version } : emptyGraph(orgId);
}

export async function saveOrgGraph(orgId, graph, userId) {
  const supabase = await db();
  const { _dbVersion, ...clean } = graph;
  const { error } = await supabase
    .from('org_intelligence_graph')
    .upsert({ org_id: orgId, graph: clean, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function loadUserGraph(userId, orgId) {
  const supabase = await db();
  const { data, error } = await supabase
    .from('user_intelligence_graph')
    .select('graph, version')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.graph ? { ...emptyGraph(orgId), ...data.graph } : emptyGraph(orgId);
}

export async function saveUserGraph(userId, orgId, graph) {
  const supabase = await db();
  const { _dbVersion, ...clean } = graph;
  const { error } = await supabase
    .from('user_intelligence_graph')
    .upsert({ org_id: orgId, user_id: userId, graph: clean, updated_at: new Date().toISOString() }, { onConflict: 'org_id, user_id' });
  if (error) throw error;
}

export async function saveDecisionPacket(orgId, userId, incidentId, packet) {
  const supabase = await db();
  const { data, error } = await supabase
    .from('decision_packets')
    .insert({
      org_id: orgId, user_id: userId, incident_id: incidentId,
      packet_version:  'v1',
      template:        packet.template,
      rule_evaluations: packet.rule_evaluations || [],
      subgraph_ids:    packet.subgraph_ids || [],
    })
    .select('id')
    .single();
  if (error) { console.error('Decision packet save failed:', error.message); return null; }
  return data?.id || null;
}

export async function updateDecisionPacketResponse(packetId, response, recommendationId) {
  const supabase = await db();
  if (!packetId) return;
  const { error } = await supabase
    .from('decision_packets')
    .update({ response, recommendation_id: recommendationId })
    .eq('id', packetId);
  if (error) console.error('Decision packet response update failed:', error.message);
}
