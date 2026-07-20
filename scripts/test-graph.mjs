/**
 * Intelligence graph unit tests.
 * Run: node scripts/test-graph.mjs
 *
 * 14 assertions covering: graph CRUD, subgraph retrieval, coordinator rules,
 * decision packet structure. No network calls, no Supabase dependency.
 */

import {
  emptyGraph, addNode, addEdge, updateNode,
  addIncidentToGraph, addDecisionToGraph, recordOutcomeInGraph,
  retrieveSubgraph, buildMemoryContext, mergeGraphs,
  findIncidentNode, inferPatterns,
} from '../src/lib/graphService.js';

import { evaluateRules, buildConstraints } from '../src/lib/coordinator.js';
import { buildDecisionPacket } from '../src/lib/decisionPacket.js';

// ─── Mini assert helpers ──────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✓  ${name}`); passed++; }
  else           { console.error(`  ✗  FAIL: ${name}`); failed++; }
}

function assertDeepKey(obj, key, name) {
  const val = key.split('.').reduce((o, k) => o?.[k], obj);
  assert(val !== undefined && val !== null, name);
}

// ─── Test 1: emptyGraph structure ─────────────────────────────────────────────

console.log('\n[1] emptyGraph structure');
{
  const g = emptyGraph('org-1');
  assert(g.version === '1.0',           'version is 1.0');
  assert(g.org_id === 'org-1',          'org_id is set');
  assert(typeof g.nodes === 'object',   'nodes is object');
  assert(Array.isArray(g.patterns?.known_risks), 'patterns.known_risks is array');
}

// ─── Test 2: addNode round-trip ───────────────────────────────────────────────

console.log('\n[2] addNode');
{
  let g = emptyGraph('org-1');
  g = addNode(g, { type: 'incident', label: 'Redis OOM', data: { service_name: 'cache' }, created_by: 'user-1' });
  const nodes = Object.values(g.nodes);
  assert(nodes.length === 1,              'one node added');
  assert(nodes[0].type === 'incident',    'type preserved');
  assert(nodes[0].label === 'Redis OOM', 'label preserved');
  assert(g.index.by_type.incident?.length === 1, 'type index updated');
  assert(g.index.by_service.cache?.length === 1,  'service index updated');
}

// ─── Test 3: addEdge deduplication ────────────────────────────────────────────

console.log('\n[3] addEdge deduplication');
{
  let g = emptyGraph('org-1');
  g = addNode(g, { id: 'n1', type: 'incident', label: 'A' });
  g = addNode(g, { id: 'n2', type: 'decision', label: 'B' });
  g = addEdge(g, { from: 'n1', to: 'n2', type: 'attempted', relationship: 'llm_suggestion', confidence: 0.6 });
  const countBefore = Object.keys(g.edges).length;
  g = addEdge(g, { from: 'n1', to: 'n2', type: 'attempted', relationship: 'llm_suggestion', confidence: 0.5 });
  assert(Object.keys(g.edges).length === countBefore, 'duplicate edge not added');
}

// ─── Test 4: updateNode ───────────────────────────────────────────────────────

console.log('\n[4] updateNode');
{
  let g = emptyGraph('org-1');
  g = addNode(g, { id: 'n1', type: 'incident', label: 'Before' });
  g = updateNode(g, 'n1', { label: 'After' });
  assert(g.nodes['n1'].label === 'After', 'label updated');
  assert(g.nodes['n1'].id === 'n1',       'id unchanged');
}

// ─── Test 5: addIncidentToGraph ───────────────────────────────────────────────

console.log('\n[5] addIncidentToGraph');
{
  const incident = { id: 'inc-1', title: 'Timeout spike', service_name: 'payments', severity: 'high', symptom_text: 'timeouts', fingerprint: ['timeout', 'payment'] };
  let g = emptyGraph('org-1');
  g = addIncidentToGraph(g, incident, 'user-1');
  const node = findIncidentNode(g, 'inc-1');
  assert(node !== null,                         'incident node found');
  assert(node.type === 'incident',              'type is incident');
  assert(node.data.service_name === 'payments', 'service_name stored');
}

// ─── Test 6: addDecisionToGraph ───────────────────────────────────────────────

console.log('\n[6] addDecisionToGraph');
{
  const incident = { id: 'inc-1', title: 'Test', service_name: 'api', severity: 'high', symptom_text: 'errors', fingerprint: ['error'] };
  let g = emptyGraph('org-1');
  g = addIncidentToGraph(g, incident, 'user-1');
  const incNode = findIncidentNode(g, 'inc-1');
  const rec = { id: 'rec-1', suggested_branch: 'Check DB', confidence: 0.75, provider: 'openai' };
  const { graph: g2, decisionNodeId } = addDecisionToGraph(g, incNode.id, rec, 'user-1');
  assert(decisionNodeId !== null,                              'decisionNodeId returned');
  assert(g2.nodes[decisionNodeId].type === 'decision',         'decision node type');
  assert(Object.keys(g2.edges).length > 0,                    'edge created');
}

// ─── Test 7: recordOutcomeInGraph + inferPatterns ─────────────────────────────

console.log('\n[7] recordOutcomeInGraph + pattern inference');
{
  const incident = { id: 'inc-2', title: 'DB crash', service_name: 'postgres', severity: 'critical', symptom_text: 'db down', fingerprint: ['crash', 'db'] };
  let g = emptyGraph('org-1');
  g = addIncidentToGraph(g, incident, 'user-1');
  const incNode = findIncidentNode(g, 'inc-2');
  const { graph: g2, decisionNodeId } = addDecisionToGraph(g, incNode.id, { id: 'rec-2', suggested_branch: 'Restart DB', confidence: 0.6 }, 'user-1');
  const g3 = recordOutcomeInGraph(g2, incNode.id, decisionNodeId, { id: 'out-1', usefulness: 'successful', resolution: 'Restarted primary' }, 'user-1');
  assert(g3.index.by_outcome.successful?.includes(incNode.id), 'successful outcome indexed');
  // Add second failed outcome for same service to trigger pattern
  const inc2 = { id: 'inc-3', title: 'DB crash2', service_name: 'postgres', severity: 'critical', symptom_text: 'db down', fingerprint: ['crash'] };
  let g4 = addIncidentToGraph(g3, inc2, 'user-1');
  const incNode2 = findIncidentNode(g4, 'inc-3');
  const { graph: g5, decisionNodeId: dn2 } = addDecisionToGraph(g4, incNode2.id, { id: 'rec-3', suggested_branch: 'Restart', confidence: 0.5 }, 'user-1');
  const g6 = recordOutcomeInGraph(g5, incNode2.id, dn2, { id: 'out-2', usefulness: 'failed', resolution: '' }, 'user-1');
  const g7 = inferPatterns(g6);
  assert(g7.patterns.successful_resolutions.some(r => r.service === 'postgres'), 'successful resolution pattern recorded');
}

// ─── Test 8: retrieveSubgraph ─────────────────────────────────────────────────

console.log('\n[8] retrieveSubgraph');
{
  let g = emptyGraph('org-1');
  const inc = { id: 'inc-x', title: 'Timeout', service_name: 'checkout', severity: 'high', symptom_text: 'checkout timeouts', fingerprint: ['checkout', 'timeout', 'latency'] };
  g = addIncidentToGraph(g, inc, 'u');
  const query = { title: 'Checkout slow', service_name: 'checkout', severity: 'high', symptom_text: 'checkout latency', fingerprint: ['checkout', 'latency', 'slow'] };
  const sub = retrieveSubgraph(g, query);
  assert(sub.matchedIncidents.length > 0,                      'matched incident found');
  assert(sub.matchedIncidents[0].score > 0,                    'score > 0');
  assert(Object.keys(sub.nodes).length > 0,                    'subgraph has nodes');
}

// ─── Test 9: buildMemoryContext ───────────────────────────────────────────────

console.log('\n[9] buildMemoryContext');
{
  let g = emptyGraph('org-1');
  const sub = retrieveSubgraph(g, { fingerprint: ['some', 'tokens'], service_name: 'api', severity: 'high', symptom_text: '' });
  const ctx = buildMemoryContext(sub);
  assert(ctx.cold_start === true,            'cold_start when empty graph');
  assert(ctx.has_memory === false,           'has_memory false for empty graph');
  assert(Array.isArray(ctx.memory_items),   'memory_items is array');
}

// ─── Test 10: mergeGraphs ─────────────────────────────────────────────────────

console.log('\n[10] mergeGraphs');
{
  let g1 = emptyGraph('org-1');
  let g2 = emptyGraph('org-1');
  g1 = addNode(g1, { type: 'incident', label: 'A', data: { service_name: 'svc' } });
  g2 = addNode(g2, { type: 'decision', label: 'B' });
  const merged = mergeGraphs(g1, g2);
  assert(Object.keys(merged.nodes).length === 2, 'both nodes in merged graph');
  assert(merged.index.by_type.incident?.length === 1, 'incident index preserved');
  assert(merged.index.by_type.decision?.length === 1,  'decision index preserved');
}

// ─── Test 11: coordinator rule evaluation (cold-start) ───────────────────────

console.log('\n[11] coordinator — cold-start annotation');
{
  const ctx = { incident: { severity: 'high', service_name: 'api' }, memory: { cold_start: true }, patterns: {}, proposed: { confidence: 0.7 } };
  const result = evaluateRules(ctx);
  assert(result.annotations.includes('COLD_START'),  'COLD_START annotated');
  assert(result.constraints.cold_start === true,      'constraint.cold_start set');
  assert(result.constraints.max_confidence < 1,       'confidence ceiling reduced');
}

// ─── Test 12: coordinator rule evaluation (escalation) ───────────────────────

console.log('\n[12] coordinator — critical escalation rule');
{
  const ctx = {
    incident: { severity: 'critical', service_name: 'payments' },
    memory: { cold_start: false, failure_count_for_service: 2, last_failed_branch: '' },
    patterns: {}, proposed: null,
  };
  const result = evaluateRules(ctx);
  assert(result.evaluations.some(e => e.rule_id === 'R01'), 'R01 evaluated');
  // R01 triggers on critical + ≥2 failures
  assert(result.decision === 'ESCALATE' || result.evaluations.find(e => e.rule_id === 'R01')?.action === 'ESCALATE', 'escalation flagged');
}

// ─── Test 13: buildConstraints shape ─────────────────────────────────────────

console.log('\n[13] buildConstraints shape');
{
  const constraints = buildConstraints({}, [], 0.7);
  assert(Array.isArray(constraints.required_output_fields), 'required_output_fields is array');
  assert(constraints.required_output_fields.includes('suggested_branch'), 'suggested_branch in required fields');
  assert(constraints.max_confidence === 0.7, 'max_confidence correct');
}

// ─── Test 14: buildDecisionPacket structure ───────────────────────────────────

console.log('\n[14] buildDecisionPacket structure');
{
  const incident = { title: 'Test', service_name: 'api', severity: 'high', symptom_text: 'errors', signals: '', impact: '', fingerprint: ['error', 'api'] };
  let g = emptyGraph('org-1');
  const { template, ruleEvaluations, subgraphIds } = buildDecisionPacket({ incident, mergedGraph: g, userId: 'user-1' });
  assert(template.current_state.title === 'Test',             'current_state populated');
  assert(typeof template.organisational_context === 'string', 'organisational_context is string');
  assert(Array.isArray(template.if_then_branches),            'if_then_branches array');
  assert(template.if_then_branches.length >= 10,              '≥10 if/then branches');
  assertDeepKey(template, 'required_output_schema.suggested_branch', 'required_output_schema.suggested_branch defined');
  assert(Array.isArray(ruleEvaluations),                      'ruleEvaluations array');
  assert(ruleEvaluations.length === 10,                       '10 rule evaluations (R01–R10)');
  assert(Array.isArray(subgraphIds),                          'subgraphIds array');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('TESTS FAILED'); process.exit(1); }
else             { console.log('All tests passed.'); }
