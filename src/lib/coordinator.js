/**
 * Deterministic coordinator / rule engine.
 * LLMs may propose; rules decide whether to route, block, or escalate.
 * Every evaluation is traced and returned as part of the decision packet.
 *
 * Rules R01–R10. Order matters — first failing BLOCK rule wins.
 */

// ─── Rule definitions ─────────────────────────────────────────────────────────

const RULES = [
  {
    id: 'R01',
    name: 'severity-escalation',
    description: 'Critical severity with >2 failed prior branches → escalate before retrying AI',
    evaluate(ctx) {
      const isCritical = ctx.incident?.severity === 'critical';
      const failedCount = ctx.memory?.failure_count_for_service ?? 0;
      if (isCritical && failedCount >= 2) {
        return { action: 'ESCALATE', reason: `Critical incident; service has ${failedCount} prior failed diagnostic branches`, confidence: 1.0 };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R02',
    name: 'cold-start-label',
    description: 'No prior memory → mark response as cold-start, reduce confidence floor',
    evaluate(ctx) {
      if (ctx.memory?.cold_start) {
        return { action: 'PASS', annotation: 'COLD_START', confidence_ceiling: 0.6 };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R03',
    name: 'known-risk-block',
    description: 'AI-suggested branch matches a known-risk pattern for this service → warn',
    evaluate(ctx) {
      const risks = ctx.patterns?.known_risks || [];
      const branch = ctx.proposed?.suggested_branch || '';
      const matchingRisk = risks.find(r => r.system === ctx.incident?.service_name);
      if (matchingRisk && branch) {
        return {
          action: 'WARN',
          reason: `Service ${ctx.incident?.service_name} has known risk: ${matchingRisk.risk}`,
          annotation: 'KNOWN_RISK',
        };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R04',
    name: 'confidence-floor',
    description: 'AI confidence < 0.4 → require human confirmation before acting',
    evaluate(ctx) {
      const conf = ctx.proposed?.confidence ?? 1.0;
      if (conf < 0.4) {
        return { action: 'WARN', reason: `AI confidence ${conf} is below 0.4 threshold`, annotation: 'LOW_CONFIDENCE' };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R05',
    name: 'duplicate-branch-guard',
    description: 'Proposed branch identical to last attempted branch that failed → suggest alternative',
    evaluate(ctx) {
      const proposed = (ctx.proposed?.suggested_branch || '').toLowerCase();
      const lastFailed = (ctx.memory?.last_failed_branch || '').toLowerCase();
      if (proposed && lastFailed && proposed === lastFailed) {
        return {
          action: 'WARN',
          reason: `Proposed branch "${proposed}" was already attempted and failed in a prior incident`,
          annotation: 'REPEATED_FAILED_BRANCH',
        };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R06',
    name: 'missing-priority-checks',
    description: 'AI response has no priority_checks → require at least placeholder before approval',
    evaluate(ctx) {
      const checks = ctx.proposed?.priority_checks;
      if (!checks || !Array.isArray(checks) || checks.length === 0) {
        return { action: 'WARN', reason: 'AI response missing priority_checks', annotation: 'INCOMPLETE_RESPONSE' };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R07',
    name: 'heuristic-fallback-label',
    description: 'Heuristic fallback active → must label output as non-AI',
    evaluate(ctx) {
      if (ctx.proposed?.provider === 'heuristic') {
        return { action: 'PASS', annotation: 'HEURISTIC_FALLBACK', confidence_ceiling: 0.5 };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R08',
    name: 'abort-signals-present',
    description: 'abort_branch_if is populated → surface prominently as a stop condition',
    evaluate(ctx) {
      const aborts = ctx.proposed?.abort_branch_if;
      if (aborts && Array.isArray(aborts) && aborts.length > 0) {
        return { action: 'PASS', annotation: 'HAS_ABORT_SIGNALS' };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R09',
    name: 'successful-resolution-match',
    description: 'Prior successful resolution exists for same service → elevate it in output',
    evaluate(ctx) {
      const resolutions = ctx.patterns?.successful_resolutions || [];
      const match = resolutions.find(r => r.service === ctx.incident?.service_name);
      if (match) {
        return {
          action: 'PASS',
          annotation: 'SUCCESSFUL_RESOLUTION_AVAILABLE',
          matched_resolution: match,
        };
      }
      return { action: 'PASS' };
    },
  },
  {
    id: 'R10',
    name: 'loss-prevention-required',
    description: 'Critical severity must have loss_prevention_reason populated',
    evaluate(ctx) {
      const isCritical = ctx.incident?.severity === 'critical';
      const lpr = ctx.proposed?.loss_prevention_reason;
      if (isCritical && (!lpr || lpr.trim() === '')) {
        return { action: 'WARN', reason: 'Critical incident requires loss_prevention_reason', annotation: 'MISSING_LPR' };
      }
      return { action: 'PASS' };
    },
  },
];

// ─── Evaluator ────────────────────────────────────────────────────────────────

/**
 * Run all rules against a context object.
 * Returns { decision, annotations, blocks, warns, evaluations, constraints }
 *
 * ctx = {
 *   incident,   // form data (severity, service_name, symptom_text, …)
 *   memory,     // buildMemoryContext() output
 *   patterns,   // graph.patterns
 *   proposed,   // AI recommendation object (may be null pre-call)
 * }
 */
export function evaluateRules(ctx) {
  const evaluations = [];
  const blocks      = [];
  const warns       = [];
  const annotations = new Set();
  let   confidence_ceiling = 1.0;
  const matched_resolutions = [];

  for (const rule of RULES) {
    let result;
    try {
      result = rule.evaluate(ctx);
    } catch (err) {
      result = { action: 'PASS', error: err.message };
    }

    const trace = {
      rule_id:    rule.id,
      rule_name:  rule.name,
      action:     result.action,
      reason:     result.reason     || null,
      annotation: result.annotation || null,
      confidence_ceiling: result.confidence_ceiling || null,
      evaluated_at: new Date().toISOString(),
    };
    evaluations.push(trace);

    if (result.action === 'BLOCK')   blocks.push(trace);
    if (result.action === 'WARN')    warns.push(trace);
    if (result.annotation)           annotations.add(result.annotation);
    if (result.confidence_ceiling)   confidence_ceiling = Math.min(confidence_ceiling, result.confidence_ceiling);
    if (result.matched_resolution)   matched_resolutions.push(result.matched_resolution);
  }

  const overallAction = blocks.length > 0 ? 'BLOCK'
                      : warns.length  > 0 ? 'WARN'
                      : 'APPROVE';

  return {
    decision:   overallAction,
    annotations: [...annotations],
    blocks,
    warns,
    evaluations,
    confidence_ceiling,
    matched_resolutions,
    constraints: buildConstraints(ctx, [...annotations], confidence_ceiling),
  };
}

/**
 * Build the constraints object that gets embedded in the LLM decision packet
 * so the AI knows exactly what the rule engine has determined.
 */
export function buildConstraints(ctx, annotations, confidence_ceiling) {
  return {
    max_confidence:         confidence_ceiling,
    cold_start:             annotations.includes('COLD_START'),
    heuristic_fallback:     annotations.includes('HEURISTIC_FALLBACK'),
    known_risk_detected:    annotations.includes('KNOWN_RISK'),
    repeated_failed_branch: annotations.includes('REPEATED_FAILED_BRANCH'),
    low_confidence_flag:    annotations.includes('LOW_CONFIDENCE'),
    missing_priority_checks: annotations.includes('INCOMPLETE_RESPONSE'),
    has_abort_signals:      annotations.includes('HAS_ABORT_SIGNALS'),
    resolution_available:   annotations.includes('SUCCESSFUL_RESOLUTION_AVAILABLE'),
    escalation_required:    annotations.includes('ESCALATE'),
    required_output_fields: [
      'suggested_branch',
      'supporting_signals',
      'contradicting_signals',
      'assumptions',
      'priority_checks',
      'abort_branch_if',
      'memory_incidents_used',
      'loss_prevention_reason',
      'confidence',
      'metrics_to_record',
    ],
  };
}
