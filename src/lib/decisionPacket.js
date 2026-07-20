/**
 * Builds the structured LLM decision packet.
 * Includes: org memory language, active constraints, if/then branches, required output schema.
 */

import { buildMemoryContext, retrieveSubgraph } from './graphService.js';
import { evaluateRules } from './coordinator.js';

/**
 * Build a complete decision packet ready to embed in the AI call.
 *
 * @param {object} params
 *   - incident: form data
 *   - mergedGraph: org + user merged graph
 *   - userId: string
 *   - options.maxIncidents: subgraph retrieval limit
 * @returns { template, subgraph, ruleEvaluations, subgraphIds }
 */
export function buildDecisionPacket({ incident, mergedGraph, userId, options = {} }) {
  const subgraph     = retrieveSubgraph(mergedGraph, incident, { maxIncidents: options.maxIncidents || 5 });
  const memoryCtx    = buildMemoryContext(subgraph);
  const subgraphIds  = Object.keys(subgraph.nodes);

  // Derive a few summary values for constraint evaluation
  const failedBranchEdges = Object.values(subgraph.edges || {}).filter(e => e.type === 'failed');
  const lastFailedNode    = failedBranchEdges.length > 0
    ? subgraph.nodes[failedBranchEdges[failedBranchEdges.length - 1].from] : null;

  const rulesCtx = {
    incident,
    memory: {
      ...memoryCtx,
      cold_start: memoryCtx.cold_start,
      failure_count_for_service: (mergedGraph.index?.by_outcome?.failed || [])
        .filter(id => mergedGraph.nodes[id]?.data?.service_name === incident.service_name).length,
      last_failed_branch: lastFailedNode?.data?.branch || lastFailedNode?.label || '',
    },
    patterns: mergedGraph.patterns || {},
    proposed: null,
  };

  const ruleResult = evaluateRules(rulesCtx);

  const orgLanguage = formatOrgLanguage(memoryCtx, incident, mergedGraph.patterns || {});
  const template    = compileTemplate(incident, memoryCtx, orgLanguage, ruleResult);

  return {
    template,
    subgraph,
    ruleEvaluations: ruleResult.evaluations,
    subgraphIds,
    constraints: ruleResult.constraints,
    memoryCtx,
    ruleResult,
  };
}

// ─── Org-language formatter ───────────────────────────────────────────────────

function formatOrgLanguage(memoryCtx, incident, patterns) {
  const lines = [];

  if (memoryCtx.cold_start) {
    lines.push('No prior incidents from this organisation match these symptoms.');
    lines.push('This is a cold-start analysis based on general SRE knowledge only.');
  } else {
    lines.push(`Your organisation has ${memoryCtx.incident_count_considered} prior incident(s) similar to this one.`);

    memoryCtx.memory_items.forEach((item, i) => {
      lines.push(`\nPrior incident #${i + 1} (${item.similarity_pct}% match, service: ${item.service}):`);

      if (item.decisions_tried.length > 0) {
        lines.push(`  Engineers at your company previously tried: ${item.decisions_tried.join(', ')}.`);
      }
      if (item.failed_approaches.length > 0) {
        item.failed_approaches.forEach(f => {
          lines.push(`  This failed because: ${f.reason} (approach: ${f.action}).`);
        });
      }
      if (item.successful_resolution) {
        lines.push(`  The successful workaround was: ${item.successful_resolution}.`);
      }
      if (item.confirmed_root_cause) {
        lines.push(`  Confirmed root cause: ${item.confirmed_root_cause}.`);
      }
    });
  }

  if (patterns.known_risks?.length > 0) {
    lines.push('\nKnown risks for this environment:');
    patterns.known_risks.slice(0, 2).forEach(r => {
      lines.push(`  • ${r.system}: ${r.risk}`);
    });
  }

  if (patterns.unresolved?.length > 0) {
    lines.push(`\n${patterns.unresolved.length} incident(s) in your org are unresolved — consider whether this incident is related.`);
  }

  return lines.join('\n');
}

// ─── Template compiler ────────────────────────────────────────────────────────

function compileTemplate(incident, memoryCtx, orgLanguage, ruleResult) {
  return {
    meta: {
      packet_version:  'v1',
      generated_at:    new Date().toISOString(),
      decision_engine: 'coordinator-v1',
    },

    // ── Section 1: Current incident state
    current_state: {
      title:        incident.title || '',
      service_name: incident.service_name || '',
      severity:     incident.severity || 'unknown',
      symptom_text: incident.symptom_text || '',
      signals:      incident.signals || '',
      impact:       incident.impact || '',
    },

    // ── Section 2: Org + user context from graph
    organisational_context: orgLanguage,

    // ── Section 3: Historical evidence (structured)
    historical_evidence: memoryCtx.memory_items.map(item => ({
      incident_id:           item.incident_id,
      match_score:           item.match_score,
      service:               item.service,
      decisions_tried:       item.decisions_tried,
      successful_resolution: item.successful_resolution,
      failed_approaches:     item.failed_approaches,
      confirmed_root_cause:  item.confirmed_root_cause,
      source:                item.source,
    })),

    // ── Section 4: Active constraints from rule engine
    active_constraints: ruleResult.constraints,

    // ── Section 5: Open risks
    open_risks: [
      ...ruleResult.warns.map(w => ({ source: 'rule_engine', rule: w.rule_id, risk: w.reason })),
      ...(memoryCtx.warnings || []).map(w => ({ source: 'graph_patterns', risk: JSON.stringify(w) })),
    ],

    // ── Section 6: Prior failed actions
    prior_failed_actions: memoryCtx.memory_items.flatMap(item =>
      item.failed_approaches.map(f => ({ service: item.service, action: f.action, reason: f.reason })),
    ),

    // ── Section 7: Prior successful actions
    prior_successful_actions: memoryCtx.memory_items
      .filter(item => item.successful_resolution)
      .map(item => ({ service: item.service, resolution: item.successful_resolution })),

    // ── Section 8: Confidence levels
    confidence_levels: {
      max_allowed:          ruleResult.constraints.max_confidence,
      cold_start:           ruleResult.constraints.cold_start,
      escalation_required:  ruleResult.constraints.escalation_required,
      heuristic_only:       ruleResult.constraints.heuristic_fallback,
    },

    // ── Section 9: Required output schema
    required_output_schema: {
      suggested_branch:       'string — the first diagnostic path to investigate',
      supporting_signals:     'string[] — signals that support this branch',
      contradicting_signals:  'string[] — signals that argue against this branch',
      assumptions:            'string[] — assumptions being made',
      priority_checks:        'string[] — ordered steps for the engineer',
      abort_branch_if:        'string[] — conditions that mean this branch is wrong; stop and pivot',
      memory_incidents_used:  'number — count of prior incidents used',
      loss_prevention_reason: 'string — why this branch minimises further damage (required for critical)',
      confidence:             `number 0–${ruleResult.constraints.max_confidence} — your confidence in this recommendation`,
      metrics_to_record:      'string[] — what to observe to confirm or deny this branch',
    },

    // ── Section 10: if/then decision branches (10+)
    if_then_branches: [
      {
        branch: 'B01',
        condition: 'All supporting signals are present and no contradicting signals found',
        then: 'Proceed with suggested_branch immediately. Set confidence ≥ 0.8.',
      },
      {
        branch: 'B02',
        condition: 'Contradicting signals outnumber supporting signals',
        then: 'Lower confidence to ≤ 0.5. Add the contradicting signals to abort_branch_if.',
      },
      {
        branch: 'B03',
        condition: 'Prior incident in org with same service had a confirmed root cause',
        then: 'Lead with that root cause as the first priority_check. Reference the prior incident.',
      },
      {
        branch: 'B04',
        condition: 'Prior incident shows the proposed branch was tried and failed',
        then: 'Do not repeat that branch. Propose an alternative. Note in assumptions why you diverged.',
      },
      {
        branch: 'B05',
        condition: 'Severity is critical and service has known risk in org graph',
        then: 'Add the known risk as the first abort_branch_if condition. Reduce confidence by 0.1.',
      },
      {
        branch: 'B06',
        condition: 'Cold start (no prior org memory)',
        then: 'Cap confidence at 0.6. Add "No org history available" to assumptions. Recommend the safest, most reversible diagnostic step.',
      },
      {
        branch: 'B07',
        condition: 'Severity is critical and no loss_prevention_reason has been formed',
        then: 'Produce loss_prevention_reason before finalising. Explain data, user, or revenue impact of this branch.',
      },
      {
        branch: 'B08',
        condition: 'Heuristic fallback only (no AI providers responded)',
        then: 'Set provider to "heuristic". Cap confidence at 0.5. Make suggested_branch a generic safe starting point (check logs, verify metrics, confirm dependencies).',
      },
      {
        branch: 'B09',
        condition: 'Org has unresolved incidents on the same service',
        then: 'Note in assumptions that a related incident may be active. Add "Confirm this is a new root cause, not a cascade" as first priority_check.',
      },
      {
        branch: 'B10',
        condition: 'Successful resolution exists in org for same service',
        then: 'Surface it explicitly in priority_checks. Do not repeat the diagnostic steps if resolution is known; go straight to validation.',
      },
      {
        branch: 'B11',
        condition: 'abort_branch_if conditions are present in signals right now',
        then: 'Do not recommend this branch. Return suggested_branch as "PIVOT_REQUIRED" and explain what condition triggered the abort.',
      },
      {
        branch: 'B12',
        condition: 'severity is "low" or "info" and org has no memory',
        then: 'Cap confidence at 0.5. Recommend a lightweight monitoring step rather than a destructive diagnostic.',
      },
    ],
  };
}
