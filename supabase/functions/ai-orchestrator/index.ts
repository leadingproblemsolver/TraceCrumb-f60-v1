import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function allowedOrigin(): string {
  return Deno.env.get("ALLOWED_ORIGIN") || "*";
}

function cors() {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const branchEnvPrefix: Record<string, string> = {
  first60: "TRACECRUMB_FIRST60",
  resume: "TRACECRUMB_RESUME",
  handoff: "TRACECRUMB_HANDOFF",
  continuity: "TRACECRUMB_CONTINUITY",
  shared: "TRACECRUMB_SHARED",
};

const systemPrompts: Record<string, string> = {
  first60: `You are TraceCrumb First-60. Produce strict JSON only — no prose, no markdown, no explanation outside the JSON object.

Objective: prevent wrong first diagnostic calls during incidents. Given symptoms, signals, service context, similar prior incidents, and recent change clues, produce the single most defensible first diagnostic hypothesis and the evidence for and against it.

If the payload contains a "decision_context" field, it contains organisational memory from prior incidents at this company — use it explicitly. The memory_items within it show what branches were tried before, whether they succeeded or failed, and confirmed root causes. Prefer resolutions that succeeded before; do not repeat branches that failed. Reflect any cold_start=true in your confidence (cap at 0.6) and assumptions.

If MATCHED_REFERENCE_INCIDENTS is provided, it is TraceCrumb's own hand-labeled validation corpus (not this org's history) — used specifically so a brand-new org with zero incident memory still gets a grounded answer instead of a guess. Ground suggested_branch in these matches when overlap exists and cite which reference incident(s) informed the call in loss_prevention_reason. If MATCHED_REFERENCE_INCIDENTS is empty and decision_context is absent or cold_start, say so plainly rather than inventing a false sense of precedent.

Required JSON keys (all required):
- suggested_branch: string — the single highest-leverage diagnostic hypothesis to investigate first
- supporting_signals: string[] — signals from the supplied data that support this branch; be specific
- contradicting_signals: string[] — signals that argue against this branch or suggest it may be wrong; be honest even if weak
- assumptions: string[] — what must be true for this branch to be correct
- priority_checks: string[] — first 3–4 concrete, observable steps to confirm or falsify this branch quickly; each must be actionable
- abort_branch_if: string[] — specific observable conditions that should cause the responder to abandon this branch immediately and re-evaluate
- memory_incidents_used: string[] — titles or IDs of any similar_incidents or decision_context memory_items that meaningfully informed this branch; empty array if none used
- loss_prevention_reason: string — the specific costly wrong action this branch prevents the responder from taking
- confidence: number 0–1 — confidence this is the correct first branch given available evidence
- metrics_to_record: string[]

Be concrete and loss-aware. Prefer falsifiable checks over vague investigation steps.`,
  resume: `You are TraceCrumb Resume. Produce strict JSON only. Objective: restore interrupted cognitive state with minimum re-ramp cost. Build a context restoration bundle. Required keys: intent_layer, state_layer, open_threads, dependencies, recent_decisions, risk_layer, suggested_next_action, confidence, metrics_to_record.`,
  handoff: `You are TraceCrumb Handoff. Produce strict JSON only. Objective: preserve operational continuity across actors. Build a handoff packet that prevents re-contact and missing-intent errors. Required keys: state, intent, constraints, open_unknowns, dependencies, risk_forecast, continuation_path, continuity_risks, confidence, metrics_to_record.`,
  continuity: `You are TraceCrumb Continuity. Produce strict JSON only. Objective: replace fragile synchronous coordination with persistent artifacts and compute continuity risk. Required keys: artifact_type, async_artifact, meeting_substitution_verdict, eci_score_estimate, risks, next_actions, confidence, metrics_to_record.`,
  shared: `You are TraceCrumb. Produce strict JSON only. Create operational continuity artifacts tied to measurable loss reduction.`,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}

function keyFor(branch: string, provider: "OPENAI" | "GEMINI") {
  const prefix = branchEnvPrefix[branch] ?? branchEnvPrefix.shared;
  return Deno.env.get(`${prefix}_${provider}_API_KEY`) || Deno.env.get(`${provider}_API_KEY`) || "";
}

function extractJson(text: string) {
  const cleaned = text.trim().replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = cleaned.slice(first, last + 1);
    try { return JSON.parse(slice); } catch (_) {}
  }
  return { summary: cleaned.slice(0, 2000), confidence: 0.35 };
}

const PROVIDER_TIMEOUT_MS = 9000;
const CORPUS_TIMEOUT_MS = 4000;
const MAX_BODY_BYTES = 16_384;

// Derives a simple fingerprint from free-text symptom input when the client
// hasn't already supplied one. Deliberately dumb (lowercase, split, filter
// short tokens) — this is the v1 matching key, same "rules-based, no
// embeddings yet" discipline as the rest of the pipeline. Upgrade path is
// swapping this for a better tokenizer, not restructuring the schema.
function deriveFingerprint(payload: any): string[] {
  if (Array.isArray(payload?.fingerprint) && payload.fingerprint.length) {
    return payload.fingerprint.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean);
  }
  const text = String(payload?.symptom_text || payload?.symptom || payload?.title || "");
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((tok) => tok.length > 3)
  )].slice(0, 12);
}

// Matches against TraceCrumb's own hand-labeled reference corpus (26 mined
// incidents), not this org's data — this is what gives a brand-new org with
// zero incident history a grounded answer instead of an empty lookup.
async function fetchMatchedIncidents(fingerprint: string[]) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey || fingerprint.length === 0) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CORPUS_TIMEOUT_MS);
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase.rpc("match_reference_incidents", {
      input_fingerprint: fingerprint,
      match_count: 3,
    }).abortSignal(ctrl.signal);
    if (error) {
      console.error("match_reference_incidents error:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("fetchMatchedIncidents threw:", err instanceof Error ? err.message : String(err));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(branch: string, action: string, payload: unknown, matched: unknown[] = []) {
  const apiKey = keyFor(branch, "OPENAI");
  if (!apiKey) return null;
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompts[branch] ?? systemPrompts.shared },
          { role: "user", content: JSON.stringify({ action, payload, MATCHED_REFERENCE_INCIDENTS: matched }) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    return { provider: "openai", result: extractJson(content) };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error(`OpenAI timed out after ${PROVIDER_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(branch: string, action: string, payload: unknown, matched: unknown[] = []) {
  const apiKey = keyFor(branch, "GEMINI");
  if (!apiKey) return null;
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          contents: [{
            role: "user",
            parts: [{ text: `${systemPrompts[branch] ?? systemPrompts.shared}\n\nAction: ${action}\nPayload JSON:\n${JSON.stringify(payload)}\n\nMATCHED_REFERENCE_INCIDENTS:\n${JSON.stringify(matched)}` }],
          }],
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") ?? "{}";
    return { provider: "gemini", result: extractJson(text) };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error(`Gemini timed out after ${PROVIDER_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function lines(value: unknown): string[] {
  return String(value ?? "").split(/\n|,|;/g).map((x) => x.trim()).filter(Boolean).slice(0, 8);
}

function heuristic(branch: string, payload: any, matched: any[] = []) {
  if (branch === "first60") {
    const symptom = payload?.symptom_text || payload?.symptom || payload?.title || "incident signals";

    if (matched.length > 0) {
      const top = matched[0];
      return {
        provider: "heuristic",
        result: {
          suggested_branch: top.correct_first_branch,
          supporting_signals: [`Matched reference incident "${top.title}" (${top.failure_mode}) — overlap ${top.overlap_count ?? "n/a"}`],
          contradicting_signals: ["No AI provider available to weigh this against your specific live signals — treat as corpus-grounded, not incident-specific, analysis"],
          assumptions: ["This incident's fingerprint overlaps meaningfully with a known labeled failure mode in TraceCrumb's validation corpus"],
          priority_checks: matched.slice(0, 3).map((m: any) => `Compare against reference: "${m.title}" (${m.failure_mode}) — correct first branch was: ${m.correct_first_branch}`),
          abort_branch_if: [`This incident does not actually share the ${top.failure_mode} failure mode with the matched reference — re-evaluate from scratch`],
          memory_incidents_used: matched.map((m: any) => m.id),
          loss_prevention_reason: top.loss_description
            || `Prior incident "${top.title}" shows this failure mode (${top.failure_mode}); the wrong first branch taken then was: ${top.wrong_first_branch_taken || "not recorded"}.`,
          confidence: Math.min(0.5 + matched.length * 0.08, 0.8),
          summary: `Incident fingerprint created from: ${String(symptom).slice(0, 180)}. Matched ${matched.length} prior incident(s) in the reference corpus.`,
          metrics_to_record: ["first_action_taken", "accepted_recommendation", "time_to_resolution_minutes", "root_cause_category"],
        },
      };
    }

    return {
      provider: "heuristic",
      result: {
        suggested_branch: "Validate recent change, dependency health, and blast radius before assuming local service failure.",
        supporting_signals: ["Generic safe-start — no AI provider was available to analyze your specific signals"],
        contradicting_signals: ["Cannot assess contradicting signals without AI analysis of your incident"],
        assumptions: ["Most incidents involve a recent change or upstream dependency as the proximate trigger"],
        priority_checks: [
          "Check last deploy/config change in affected service",
          "Check upstream dependency health",
          "Compare fingerprint against last 30 incidents",
          "Verify customer impact before widening response",
        ],
        abort_branch_if: ["No recent change found and all upstream dependencies are healthy — re-evaluate for service-local failure"],
        memory_incidents_used: [],
        loss_prevention_reason: "No matched prior incident exists for this fingerprint in either your org's memory or the reference corpus; this is a general best-practice default, not a validated match.",
        confidence: 0.35,
        summary: `Incident fingerprint created from: ${String(symptom).slice(0, 180)}. No matches found — this is a genuinely novel pattern, not a validated match.`,
        metrics_to_record: ["first_action_taken", "accepted_recommendation", "time_to_resolution_minutes", "root_cause_category"],
      },
    };
  }
  if (branch === "resume") {
    return {
      provider: "heuristic",
      result: {
        intent_layer: payload?.objective || "Resume the active work block with minimal context reconstruction.",
        state_layer: payload?.active_state || "Current state not fully specified; use source context to resume.",
        open_threads: lines(payload?.open_threads || payload?.source_context).slice(0, 5),
        dependencies: lines(payload?.dependencies || payload?.source_context).slice(0, 5),
        recent_decisions: lines(payload?.recent_decisions).slice(0, 5),
        risk_layer: ["Missing decision rationale", "Stale dependency state", "Unclear next action"],
        suggested_next_action: "Open the latest task/PR, verify blocker status, then execute the smallest action that produces a visible state change.",
        confidence: 0.5,
        metrics_to_record: ["minutes_to_first_output", "context_search_time", "restore_error_count"],
      },
    };
  }
  if (branch === "handoff") {
    return {
      provider: "heuristic",
      result: {
        state: payload?.state || "Current operational state captured from sender notes.",
        intent: payload?.intent || "Preserve the receiver's ability to continue without re-contact.",
        constraints: lines(payload?.constraints),
        open_unknowns: lines(payload?.open_unknowns),
        dependencies: lines(payload?.dependencies),
        risk_forecast: lines(payload?.risks).concat(["Receiver may miss rationale if decision context is absent"]).slice(0, 6),
        continuation_path: payload?.continuation_path || "Receiver should validate blockers first, then continue the lowest-risk next action.",
        continuity_risks: ["Missing intent", "Missing uncertainty", "Missing dependency owner"],
        confidence: 0.5,
        metrics_to_record: ["recontact_required", "recovery_minutes", "continuity_score", "error_introduced"],
      },
    };
  }
  return {
    provider: "heuristic",
    result: {
      artifact_type: "async_coordination_artifact",
      async_artifact: {
        current_state: payload?.current_state || "Workflow state needs canonical update.",
        decisions_needed: lines(payload?.decisions_needed),
        blockers: lines(payload?.blockers),
        owners: lines(payload?.owners),
        next_update_required: "Only escalate to meeting if blockers or decision conflict remain unresolved.",
      },
      meeting_substitution_verdict: "partial",
      eci_score_estimate: 0.55,
      risks: ["Decision ambiguity", "Dependency fragility", "Weak async update discipline"],
      next_actions: ["Publish state artifact", "Collect async responses", "Escalate only unresolved decision/conflict items"],
      confidence: 0.5,
      metrics_to_record: ["meeting_minutes_removed", "coordination_latency", "escalation_frequency", "eci_score"],
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST required" }, 405);

  try {
    // Reject oversized bodies before parsing
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "Request body too large" }, 413);
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "Request body too large" }, 413);
    }

    const body = JSON.parse(rawBody);
    const branch = String(body.branch || "shared");
    const action = String(body.action || "generate");
    const payload = body.payload || {};

    const startMs = Date.now();
    const generated_at = new Date().toISOString();
    let lastError = "";

    // Reference corpus matching only applies to first60 — a brand-new org
    // with zero incident memory still gets a grounded answer instead of a
    // pure LLM guess or an empty lookup.
    const matched = branch === "first60" ? await fetchMatchedIncidents(deriveFingerprint(payload)) : [];

    for (const fn of [callOpenAI, callGemini]) {
      try {
        const out = await fn(branch, action, payload, matched);
        if (out) {
          return jsonResponse({ ok: true, generated_at, latency_ms: Date.now() - startMs, matched_count: matched.length, ...out });
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const fallback = heuristic(branch, payload, matched);
    return jsonResponse({ ok: true, fallback: true, generated_at, latency_ms: Date.now() - startMs, matched_count: matched.length, lastError, ...fallback });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
