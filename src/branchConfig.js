export const BRANCH = {
  "id": "first60",
  "product": "TraceCrumb First-60",
  "kicker": "Wrong-first-call prevention",
  "tagline": "Incident memory for the first 60 seconds.",
  "headline": "Know where to look first when an incident hits.",
  "subheadline": "TraceCrumb matches live incident symptoms to how similar failures unfolded before — so the engineer on call can start with the most defensible diagnostic branch instead of guessing, repeating dead ends, or rebuilding context under pressure.",
  "promise": "A clear first place to investigate, backed by your own incident history — not a guess.",
  "benefitHook": "Get the first branch to check, the prior incidents that support it, the failed approaches to avoid, and the fixes that worked before — before you've finished reading the alert.",
  "pain": "When a P1 starts, responders improvise from memory, scan scattered Slack threads, and repeat old diagnostic branches while the clock compounds against them.",
  "loss": "Every wrong first branch costs MTTR minutes, trust, incident commander clarity, and postmortem quality.",
  "rootSolve": "TraceCrumb captures the symptom, compares it against team incident memory, and returns the first branch most likely to prevent wasted motion.",
  "cognitiveGain": "Less thrashing. Faster orientation. Calmer first decisions — confidence that the next move is grounded in your company's own incident history, not a guess made under pressure.",
  "proofMetric": "First-action success rate + time-to-resolution minutes.",
  "distribution": "Drop the First-60 demo into live SRE/DevOps pain threads. Convert only when a responder confirms the loss is real and wants to run the workflow against their own incident history.",
  "primaryChannel": "Reddit SRE/DevOps incident-response threads and comment replies where engineers describe debugging loops, MTTR drag, or repeated incidents.",
  "landing": {
    "problemTitle": "The painful part is not the alert. It is the first wrong move.",
    "problemBody": "The first minute of incident response is usually spent reconstructing context from memory, Slack, dashboards, and half-remembered postmortems. That is where teams silently lose time.",
    "solutionTitle": "TraceCrumb protects the first diagnostic branch.",
    "solutionBody": "Paste the live symptom. Get a clear first place to investigate, the prior incidents that support it, the failed approaches to avoid, and the fixes that worked before — before your team burns time on a familiar dead end.",
    "proofTitle": "Built for rapid validation, not dashboard theater.",
    "proofBody": "The only metric that matters at this stage is whether the first action improves. Demo drops capture source channel and outcome feedback so distribution can iterate on real pain, not vague interest.",
    "ctaPrimary": "Continue to protected app",
    "ctaSecondary": "See the first branch",
    "lossCTA": "Do not let the same incident teach the same lesson twice."
  },
  "drops": {
    "reddit": "This is exactly the first-60-seconds problem: the team loses time choosing the first diagnostic branch, not because nobody is smart, but because incident memory is scattered. I made a no-signup demo that turns symptoms + prior memory into the first branch to check: ?demo=1&source_channel=reddit. Try it on one incident shape and reply with whether the first suggested branch would have saved time.",
    "x": "Most P1s lose minutes before the real debugging even starts: wrong first branch, repeated checks, forgotten prior incident. TraceCrumb First-60 compresses symptom → prior memory → first diagnostic branch: ?demo=1&source_channel=x. Run the demo and tell me whether the first branch is useful, partial, or wrong.",
    "linkedin": "Teams do not just lose time during incidents; they lose the first minute reconstructing context they already had. TraceCrumb First-60 turns live symptoms and prior incident memory into the safest first diagnostic branch: ?demo=1&source_channel=linkedin. Please test the demo against one recurring incident pattern and mark the output as useful, partial, or missed."
  },
  "psc": {
    "score": "8.2/10",
    "rationale": "Exceptional root solve for a painful, time-sensitive workflow; sub-5-minute demo value; embeddable in SRE/DevOps threads; scalable if teams confirm first-action improvement. Risk: needs enough incident memory to become obviously superior after first use."
  }
};
