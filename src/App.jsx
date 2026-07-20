import React, { useEffect, useMemo, useState } from 'react';
import { supabase, AI_FUNCTION_NAME } from './lib/supabaseClient.js';
import { BRANCH } from './branchConfig.js';
import GraphView from './GraphView.jsx';
import {
  emptyGraph, addIncidentToGraph, addDecisionToGraph, recordOutcomeInGraph,
  findIncidentNode, mergeGraphs, retrieveSubgraph, buildMemoryContext,
  loadOrgGraph, saveOrgGraph, loadUserGraph, saveUserGraph,
} from './lib/graphService.js';

function fingerprint(text) {
  const stop = new Set(['the','and','for','with','this','that','from','into','when','then','have','been','were','will','not','are','our','was','has','but','they','you','your','service']);
  return Array.from(new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w)))).slice(0, 18);
}

function similarity(a, b) {
  const A = new Set(a || []); const B = new Set(b || []);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(x => { if (B.has(x)) inter += 1; });
  return inter / new Set([...A, ...B]).size;
}

function pretty(obj) { return JSON.stringify(obj || {}, null, 2); }
function num(v, fallback = 0.5) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function textLines(v) { return String(v || '').split(/\n|,|;/).map(x => x.trim()).filter(Boolean); }

const CONTACT_EMAIL = 'leadingproblemsolver@gmail.com';

function safeFilename(value, fallback = 'tracecrumb-export') {
  const cleaned = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function shareOrCopy({ title, text, url }) {
  const shareData = { title, text, url };
  if (navigator.share) {
    try { await navigator.share(shareData); return 'shared'; }
    catch (err) { if (err?.name === 'AbortError') return 'cancelled'; }
  }
  const copyText = [text, url].filter(Boolean).join(' ');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(copyText);
  } else {
    const area = document.createElement('textarea');
    area.value = copyText;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  return 'copied';
}

function ShareButton({ label = 'Share TraceCrumb', text = BRANCH.subheadline, url }) {
  const [status, setStatus] = useState('');
  async function share() {
    try {
      const result = await shareOrCopy({
        title: BRANCH.product,
        text,
        url: url || `${window.location.origin}${window.location.pathname}?demo=1&source_channel=shared`,
      });
      setStatus(result === 'shared' ? 'Shared' : result === 'copied' ? 'Link copied' : '');
      if (result !== 'cancelled') logDistributionEvent('share_clicked', { surface: label });
      setTimeout(() => setStatus(''), 2200);
    } catch (_) {
      setStatus('Copy failed');
      setTimeout(() => setStatus(''), 2200);
    }
  }
  return <button className="secondary" type="button" onClick={share}>{status || label}</button>;
}

// ─── Intelligence graph hook ─────────────────────────────────────────────────
function useIntelligenceGraph(userId, orgId) {
  const [orgGraph, setOrgGraph]   = useState(null);
  const [userGraph, setUserGraph] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const mergedGraph = useMemo(() => {
    const base = orgGraph  || emptyGraph(orgId);
    const user = userGraph || emptyGraph(orgId);
    return mergeGraphs(base, user);
  }, [orgGraph, userGraph, orgId]);

  useEffect(() => {
    if (!userId || !orgId) return;
    setGraphLoading(true);
    Promise.all([loadOrgGraph(orgId), loadUserGraph(userId, orgId)])
      .then(([og, ug]) => { setOrgGraph(og); setUserGraph(ug); })
      .catch(err => console.warn('Graph load error:', err.message))
      .finally(() => setGraphLoading(false));
  }, [userId, orgId]);

  async function persistOrgGraph(newGraph) {
    if (!orgId || !userId) return;
    try { await saveOrgGraph(orgId, newGraph, userId); setOrgGraph(newGraph); }
    catch (err) { console.warn('Graph save error:', err.message); }
  }

  async function persistUserGraph(newGraph) {
    if (!userId || !orgId) return;
    try { await saveUserGraph(userId, orgId, newGraph); setUserGraph(newGraph); }
    catch (err) { console.warn('Graph save error:', err.message); }
  }

  return { mergedGraph, graphLoading, persistOrgGraph, persistUserGraph };
}

// P0-01: Recommendation provenance — never imply organizational memory without proof
function ProvenanceBlock({ provider, similar, generatedAt, latencyMs }) {
  const coldStart = !similar?.length;
  const topMatch = similar?.[0];
  return (
    <div style={{marginBottom:12}}>
      <div className="row" style={{marginBottom:6,flexWrap:'wrap',gap:6}}>
        <span className="pill">Provider: {provider || 'unknown'}</span>
        {coldStart
          ? <span className="pill" style={{borderColor:'var(--warn)',color:'var(--warn)'}}>0 prior incidents — cold start</span>
          : <span className="pill">{similar.length} prior incident{similar.length !== 1 ? 's' : ''} considered</span>
        }
        {latencyMs && <span className="pill">Generated in {(latencyMs / 1000).toFixed(1)}s</span>}
        {generatedAt && <span className="pill">{new Date(generatedAt).toLocaleTimeString()}</span>}
      </div>
      {coldStart && (
        <p style={{fontSize:12,color:'var(--warn)',margin:0,lineHeight:1.5}}>
          Cold start: no prior organizational incidents matched. This recommendation uses your current incident description and general operational patterns only — not your team's incident history.
        </p>
      )}
      {!coldStart && topMatch && (
        <p style={{fontSize:12,color:'var(--text2)',margin:0,lineHeight:1.5}}>
          Closest match: &quot;{topMatch.title}&quot; · {topMatch.service} · {(topMatch.score * 100).toFixed(0)}% lexical overlap
        </p>
      )}
    </div>
  );
}

// P0-03: Explicit fallback — must never look like model-produced reasoning
function FallbackBanner({ onRetry, busy }) {
  return (
    <div className="card" style={{borderColor:'var(--warn)',background:'var(--warn-dim)',marginBottom:12}}>
      <div className="kicker" style={{color:'var(--warn)',marginBottom:6}}>Generic safe-start checklist — no AI provider responded</div>
      <p style={{margin:0,fontSize:13}}>No AI model produced this output. This is a static safe-start checklist, not incident-specific reasoning. Do not treat it as an analysis of your specific incident.</p>
      <div className="row" style={{marginTop:10}}>
        {onRetry && <button className="secondary" type="button" style={{fontSize:12}} onClick={onRetry} disabled={busy}>{busy ? 'Retrying...' : 'Retry AI analysis'}</button>}
        <span style={{fontSize:12,color:'var(--text2)'}}>Continue with this checklist as a general starting point only.</span>
      </div>
    </div>
  );
}

// Structured recommendation display — works for AI and heuristic responses
function RecommendationOutput({ rec }) {
  if (!rec) return null;
  const hasStructuredFields = rec.suggested_branch || rec.supporting_signals || rec.priority_checks;
  if (!hasStructuredFields) return <pre className="output">{JSON.stringify(rec, null, 2)}</pre>;

  return (
    <div>
      {rec.suggested_branch && (
        <div style={{marginBottom:14,padding:'10px 12px',background:'var(--surface2)',borderRadius:6,borderLeft:'3px solid var(--accent)'}}>
          <div className="kicker" style={{marginBottom:4}}>First diagnostic branch</div>
          <p style={{margin:0,fontWeight:600,fontSize:14,lineHeight:1.5}}>{rec.suggested_branch}</p>
        </div>
      )}
      {rec.supporting_signals?.length > 0 && (
        <div style={{marginBottom:10}}>
          <div className="kicker" style={{color:'var(--ok)',marginBottom:4}}>Supporting signals</div>
          <ul style={{margin:0,paddingLeft:18}}>{rec.supporting_signals.map((s,i)=><li key={i} style={{fontSize:13,lineHeight:1.5,marginBottom:2}}>{s}</li>)}</ul>
        </div>
      )}
      {rec.contradicting_signals?.length > 0 && (
        <div style={{marginBottom:10}}>
          <div className="kicker" style={{color:'var(--warn)',marginBottom:4}}>Contradicting signals</div>
          <ul style={{margin:0,paddingLeft:18}}>{rec.contradicting_signals.map((s,i)=><li key={i} style={{fontSize:13,lineHeight:1.5,marginBottom:2}}>{s}</li>)}</ul>
        </div>
      )}
      {rec.priority_checks?.length > 0 && (
        <div style={{marginBottom:10}}>
          <div className="kicker" style={{marginBottom:4}}>Priority checks</div>
          <ol style={{margin:0,paddingLeft:20}}>{rec.priority_checks.map((c,i)=><li key={i} style={{fontSize:13,lineHeight:1.5,marginBottom:2}}>{c}</li>)}</ol>
        </div>
      )}
      {rec.abort_branch_if?.length > 0 && (
        <div style={{marginBottom:10,padding:'8px 12px',background:'var(--loss-dim,rgba(220,38,38,0.08))',borderRadius:4,borderLeft:'3px solid var(--loss,#dc2626)'}}>
          <div className="kicker" style={{color:'var(--loss,#dc2626)',marginBottom:4}}>Abandon this branch if</div>
          <ul style={{margin:0,paddingLeft:18}}>{rec.abort_branch_if.map((c,i)=><li key={i} style={{fontSize:13,lineHeight:1.5,marginBottom:2}}>{c}</li>)}</ul>
        </div>
      )}
      {rec.loss_prevention_reason && (
        <div style={{marginBottom:10}}>
          <div className="kicker" style={{marginBottom:4}}>Loss prevention reason</div>
          <p style={{margin:0,fontSize:13,lineHeight:1.5}}>{rec.loss_prevention_reason}</p>
        </div>
      )}
      <div className="row" style={{marginTop:8,flexWrap:'wrap',gap:6}}>
        {rec.confidence !== undefined && <span className="pill">Confidence: {(Number(rec.confidence || 0) * 100).toFixed(0)}%</span>}
        {rec.memory_incidents_used?.length > 0 && <span className="pill">{rec.memory_incidents_used.length} memory incident{rec.memory_incidents_used.length !== 1 ? 's' : ''} used</span>}
        {rec.assumptions?.length > 0 && (
          <details style={{fontSize:12}}>
            <summary style={{color:'var(--text2)',cursor:'pointer'}}>View {rec.assumptions.length} assumption{rec.assumptions.length !== 1 ? 's' : ''}</summary>
            <ul style={{margin:'4px 0 0',paddingLeft:16}}>{rec.assumptions.map((a,i)=><li key={i} style={{fontSize:12,color:'var(--text2)',lineHeight:1.4,marginBottom:2}}>{a}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}

// Real postmortem pre-fill for cold-start orgs — GitHub Oct 21 2018 MySQL incident
// Source: github.blog/engineering/engineering-principles/october-21-post-incident-analysis/
const SAMPLE_INCIDENT = {
  title: 'GitHub Oct 21 2018 — MySQL primary lost network connectivity',
  service_name: 'github-mysql-primary',
  severity: 'critical',
  symptom_text: 'MySQL primary (US East) lost network connectivity during planned network switch. Automatic HA failover (Orchestrator) promoted a replica that was 43 seconds behind. Replication topology broke after promotion. Application returned mixed read/write errors.',
  signals: 'Planned network maintenance 11 minutes before alert. Orchestrator promoted replica automatically without lag safety check. Replica lag at promotion time: 43 seconds. Application errors: mixed read/write failures across git push/pull, API, web UI.',
  impact: 'git push/pull, API, web UI globally degraded — 24h+ outage. First-response window spent on application-level fixes rather than replication topology inspection.',
};


function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem('tracecrumb-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('tracecrumb-theme', theme);
  }, [theme]);
  return <button
    className="theme-toggle secondary"
    type="button"
    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
  >
    {theme === 'dark' ? 'Light mode' : 'Dark mode'}
  </button>
}

function NewsletterSignup({ context = 'landing-inline', compact = false }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const normalized = email.trim().toLowerCase();
    const { error: insertError } = await supabase.from('newsletter_signups').insert({
      email: normalized,
      answer: 'Release notes and incident-response field notes',
      branch: BRANCH.id,
      source_channel: getSourceChannel(),
      context,
    });
    setBusy(false);
    if (insertError) return setError('Could not save your email. Try again or contact us directly.');
    setDone(true);
    markNewsletterPopupSeen();
    logDistributionEvent('newsletter_signup', { context });
  }

  if (done) return <p className="ok" style={{margin:0}}>You are on the list — release notes only, no noise.</p>;

  return <form className={compact ? 'newsletter-inline compact' : 'newsletter-inline'} onSubmit={submit}>
    <label className="sr-only" htmlFor={`newsletter-${context}`}>Email address</label>
    <input id={`newsletter-${context}`} required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" />
    <button disabled={busy}>{busy ? 'Joining...' : 'Get release notes'}</button>
    {error && <p className="loss newsletter-inline-error">{error}</p>}
  </form>;
}

function hasSeenNewsletterPopup() {
  return typeof window !== 'undefined' && window.localStorage.getItem('tracecrumb-newsletter-seen') === '1';
}
function markNewsletterPopupSeen() {
  if (typeof window !== 'undefined') window.localStorage.setItem('tracecrumb-newsletter-seen', '1');
}

function NewsletterPopup({ context, delayMs = 0 }) {
  const [ready, setReady] = useState(delayMs === 0);
  const [email, setEmail] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (delayMs === 0) return;
    const t = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (hasSeenNewsletterPopup() || dismissed || !ready) return null;

  function dismiss() { markNewsletterPopupSeen(); setDismissed(true); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase.from('newsletter_signups').insert({
      email, answer, branch: BRANCH.id, source_channel: getSourceChannel(), context,
    });
    setBusy(false);
    if (error) return setError('Could not save. Try again.');
    setDone(true);
    markNewsletterPopupSeen();
    setTimeout(() => setDismissed(true), 3000);
  }

  return <div className="newsletter-popup card" role="dialog" aria-label="Newsletter signup">
    <button className="secondary newsletter-close" type="button" onClick={dismiss} aria-label="Dismiss">×</button>
    {done ? <p className="ok">Thanks — that helps us build the right thing.</p> : <>
      <h3>One quick question</h3>
      <p>What happened today that made you want to use this?</p>
      <form className="form-grid" onSubmit={submit}>
        <textarea required value={answer} onChange={e => setAnswer(e.target.value)} placeholder="e.g. lost 20 minutes on a P1 chasing the wrong service..." />
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
        {error && <p className="loss">{error}</p>}
        <button disabled={busy}>{busy ? 'Sending...' : 'Send + join the newsletter'}</button>
      </form>
    </>}
  </div>
}

function LandingPage({ onStart }) {
  return <main className="landing-shell">
    <nav className="landing-nav" aria-label="Primary">
      <div className="brand-mark">
        <span className="brand-dot" />
        <span>{BRANCH.product}</span>
      </div>
      <div className="row">
        <a className="button-link secondary" href="#updates">Updates</a>
        <a className="button-link secondary" href="?contact=1">Contact</a>
        <ThemeToggle />
        <button className="secondary" type="button" onClick={onStart}>Sign in</button>
      </div>
    </nav>

    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="kicker">{BRANCH.kicker}</div>
      <p className="landing-tagline">{BRANCH.tagline}</p>
      <h1 id="landing-title">{BRANCH.headline}</h1>
      <p className="landing-copy">{BRANCH.subheadline}</p>
      <p className="landing-hook">{BRANCH.benefitHook}</p>
      <div className="landing-actions">
        <button type="button" onClick={onStart}>{BRANCH.landing.ctaPrimary}</button>
        <a className="button-link secondary" href="?demo=1&source_channel=landing">{BRANCH.landing.ctaSecondary}</a>
        <ShareButton label="Share with an on-call engineer" />
      </div>
      <div className="landing-stats" aria-label="First60 value proof points">
        <div className="landing-stat"><span className="landing-stat-num">≤5m</span><span className="landing-stat-label">time to value</span></div>
        <div className="landing-stat"><span className="landing-stat-num">60s</span><span className="landing-stat-label">first diagnostic window protected</span></div>
        <div className="landing-stat"><span className="landing-stat-num">1st</span><span className="landing-stat-label">action quality is the proof</span></div>
      </div>
    </section>

    <section className="landing-grid landing-grid-primary" aria-label="Product Hunt core sections">
      <div className="card"><span className="kicker">Problem</span><h3>{BRANCH.landing.problemTitle}</h3><p>{BRANCH.landing.problemBody}</p></div>
      <div className="card"><span className="kicker">Solution</span><h3>{BRANCH.landing.solutionTitle}</h3><p>{BRANCH.landing.solutionBody}</p><p className="loss"><b>{BRANCH.landing.lossCTA}</b></p></div>
      <div className="card"><span className="kicker">Proof loop</span><h3>{BRANCH.landing.proofTitle}</h3><p>{BRANCH.landing.proofBody}</p></div>
    </section>

    <section className="landing-panel" aria-label="Deployment package copy">
      <div>
        <span className="kicker">Surgical pain destruction</span>
        <h2>From scattered recall to a first move you can defend.</h2>
        <p>{BRANCH.pain} {BRANCH.rootSolve} {BRANCH.cognitiveGain}</p>
      </div>
      <div className="landing-loss-box">
        <span className="kicker">Loss prevented</span>
        <p>{BRANCH.loss}</p>
        <div className="row"><span className="pill">{BRANCH.proofMetric}</span><span className="pill">Outcome tracking per incident</span></div>
      </div>
    </section>

    <section id="updates" className="landing-panel landing-updates" aria-label="Release notes signup">
      <div>
        <span className="kicker">Build notes, not marketing noise</span>
        <h2>Get the next release and the incident lesson behind it.</h2>
        <p>Occasional notes on what changed, what failed, and what on-call engineers said was actually useful.</p>
      </div>
      <div className="card landing-updates-card">
        <NewsletterSignup context="landing-inline" />
        <p className="microcopy">Unsubscribe any time. No account required.</p>
      </div>
    </section>

    <footer className="landing-footer">
      <div><strong>{BRANCH.product}</strong><span> · Built for the engineer holding the pager.</span></div>
      <div className="row">
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <a href="?contact=1">Contact</a>
        <ShareButton label="Share app" />
      </div>
    </footer>
    <NewsletterPopup context="landing" delayMs={9000} />
  </main>
}

function ContactPage() {
  const [form, setForm] = useState({ name:'', email:'', role:'', company:'', reason:'Product feedback', message:'' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const mailto = useMemo(() => {
    const subject = encodeURIComponent(`[TraceCrumb] ${form.reason || 'Contact'}${form.company ? ` — ${form.company}` : ''}`);
    const body = encodeURIComponent([
      `Name: ${form.name || '-'}`,
      `Email: ${form.email || '-'}`,
      `Role: ${form.role || '-'}`,
      `Company: ${form.company || '-'}`,
      `Reason: ${form.reason || '-'}`,
      '',
      form.message || '',
    ].join('\n'));
    return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }, [form]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error: insertError } = await supabase.from('contact_messages').insert({
      ...form,
      email: form.email.trim().toLowerCase(),
      branch: BRANCH.id,
      source_channel: getSourceChannel(),
    });
    setBusy(false);
    if (insertError) return setError('Could not save the message. Use the direct email button below.');
    setDone(true);
    logDistributionEvent('contact_submitted', { reason: form.reason });
  }

  return <main className="contact-shell">
    <nav className="landing-nav">
      <a className="brand-mark" href="./"><span className="brand-dot" /><span>{BRANCH.product}</span></a>
      <div className="row"><ThemeToggle /><a className="button-link secondary" href="./">← Back</a></div>
    </nav>
    <section className="contact-layout">
      <div className="contact-intro">
        <span className="kicker">Contact</span>
        <h1>Bring one real incident pattern.</h1>
        <p>Use this for product feedback, a pilot question, a bug, or a first-response workflow you think TraceCrumb should handle.</p>
        <div className="contact-direct card">
          <span className="kicker">Direct email</span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <p>Messages go directly to the builder. Include the affected workflow and what happened first.</p>
        </div>
      </div>
      <div className="card contact-form-card">
        {done ? <>
          <span className="kicker">Message received</span>
          <h2>Thanks — the context is saved.</h2>
          <p>For the fastest direct path, you can also open the same message in your email client.</p>
          <div className="row"><a className="button-link" href={mailto}>Open in email</a><a className="button-link secondary" href="./">Return home</a></div>
        </> : <form className="form-grid" onSubmit={submit}>
          <div className="contact-form-grid">
            <label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Your name" maxLength={120} /></label>
            <label>Work email<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="you@company.com" /></label>
            <label>Role<input value={form.role} onChange={e=>setForm({...form,role:e.target.value})} placeholder="SRE, platform engineer..." maxLength={120} /></label>
            <label>Company<input value={form.company} onChange={e=>setForm({...form,company:e.target.value})} placeholder="Company or team" maxLength={160} /></label>
          </div>
          <label>What is this about?<select value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}><option>Product feedback</option><option>Test a real incident</option><option>Pilot with my team</option><option>Bug or broken flow</option><option>Press / research</option><option>Other</option></select></label>
          <label>What happened?<textarea required value={form.message} onChange={e=>setForm({...form,message:e.target.value})} placeholder="Describe the incident pattern, current first-response workflow, or the exact thing that felt wrong." maxLength={4000} /></label>
          {error && <p className="loss">{error}</p>}
          <div className="row"><button disabled={busy}>{busy ? 'Sending...' : 'Send message'}</button><a className="button-link secondary" href={mailto}>Open in email instead</a></div>
        </form>}
      </div>
    </section>
  </main>;
}

function AuthPanel({ onReady, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmPending, setConfirmPending] = useState(false);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    const fn = mode === 'signup' ? supabase.auth.signUp : supabase.auth.signInWithPassword;
    const { data, error } = await fn.call(supabase.auth, { email, password });
    setBusy(false);
    if (error) return setError(error.message);
    // C17: distinguish email-confirmation-required from successful session
    if (mode === 'signup' && data?.user && !data?.session) {
      setConfirmPending(true);
      return;
    }
    if (data?.session) {
      if (mode === 'signup') logDistributionEvent('signup', { email_domain: email.split('@')[1] });
      onReady();
    }
  }

  if (confirmPending) return <div className="auth-wrap">
    <div className="auth-top row"><button className="secondary" type="button" onClick={onBack}>← Landing</button><ThemeToggle /></div>
    <div className="auth card">
      <div className="kicker">Check your email</div>
      <h2>Confirm your account</h2>
      <p>We sent a confirmation link to <strong>{email}</strong>. Open it to activate your workspace, then return here and sign in.</p>
      <button type="button" onClick={() => { setConfirmPending(false); setMode('signin'); }}>Go to sign in</button>
    </div>
  </div>;

  return <div className="auth-wrap">
    <div className="auth-top row">
      <button className="secondary" type="button" onClick={onBack}>← Landing</button>
      <ThemeToggle />
    </div>
    <div className="auth card">
    <div className="kicker">Secure access</div>
    <h2>{mode === 'signup' ? 'Create your TraceCrumb workspace' : 'Sign in to TraceCrumb'}</h2>
    <p>{BRANCH.promise}</p>
    <form className="form-grid" onSubmit={submit}>
      <label>Email<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" /></label>
      <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="minimum 6 characters" /></label>
      {error && <p className="loss">{error}</p>}
      <button disabled={busy}>{busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      <button className="secondary" type="button" onClick={()=>setMode(mode === 'signup' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Have an account? Sign in' : 'Need access? Create account'}</button>
    </form>
    </div>
  </div>
}

async function ensureOrg(user) {
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, orgs(id,name)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (membership?.org_id) return { id: membership.org_id, name: membership.orgs?.name || 'First60 Org' };

  const defaultName = `${(user.email || 'First60').split('@')[0]} Ops`;
  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .insert({ name: defaultName, created_by: user.id })
    .select('id,name')
    .single();
  if (orgError) throw orgError;
  const { error: memberError } = await supabase
    .from('org_members')
    .insert({ org_id: org.id, user_id: user.id, role: 'owner' });
  if (memberError) throw memberError;
  return org;
}

function Header({ user, org, signOut }) {
  return <div className="header">
    <div className="brand">
      <span className="kicker">{BRANCH.kicker}</span>
      <h1>{BRANCH.product}</h1>
      <p>{BRANCH.promise}</p>
    </div>
    <div className="row">
      <a className="button-link secondary" href="?contact=1">Contact</a>
      <ShareButton label="Share app" />
      <ThemeToggle />
      <span className="pill">{org?.name || 'No org'}</span>
      <span className="pill">{user?.email}</span>
      <button className="secondary" onClick={signOut}>Sign out</button>
    </div>
  </div>
}

async function callAI(branch, action, payload) {
  const { data, error } = await supabase.functions.invoke(AI_FUNCTION_NAME, { body: { branch, action, payload } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'AI function failed');
  return data;
}

function LossCard() {
  return <div className="card">
    <h3>Why this matters</h3>
    <p><b className="loss">Pain:</b> {BRANCH.pain}</p>
    <p><b className="loss">Loss prevented:</b> {BRANCH.loss}</p>
    <p><b className="ok">Proof metric:</b> {BRANCH.proofMetric}</p>
  </div>
}

function First60({ user, org, graphState }) {
  const [form, setForm] = useState({ title:'', service_name:'', severity:'high', symptom_text:'', impact:'', signals:'' });
  const [incidents, setIncidents] = useState([]);
  const [output, setOutput] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryData, setRetryData] = useState(null);
  const [outcomeSaved, setOutcomeSaved] = useState(false);
  const [currentIncidentNodeId, setCurrentIncidentNodeId] = useState(null);
  const [currentDecisionNodeId, setCurrentDecisionNodeId] = useState(null);

  async function load() {
    const { data } = await supabase.from('incidents').select('*').eq('org_id', org.id).order('created_at', { ascending:false }).limit(20);
    setIncidents(data || []);
  }
  useEffect(() => { load(); }, [org?.id]);

  async function persistRecommendation(incidentId, result, provider) {
    const { data: recRow, error: recErr } = await supabase.from('incident_recommendations').insert({
      org_id: org.id, incident_id: incidentId,
      suggested_branch: result.suggested_branch || 'Validate recent changes and dependencies first.',
      priority_checks: result.priority_checks || [],
      loss_prevention_reason: result.loss_prevention_reason || '',
      confidence: num(result.confidence),
      provider,
      raw_response: result,
    }).select('id').single();
    if (recErr) console.error('Recommendation persist failed:', recErr.message);
    return recRow?.id || null;
  }

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setOutput(null); setRetryData(null); setOutcomeSaved(false);
    try {
      const fp = fingerprint(`${form.title} ${form.symptom_text} ${form.signals} ${form.impact}`);
      const similar = incidents
        .map(i => ({ id:i.id, title:i.title, service:i.service_name, score: similarity(fp, i.fingerprint), symptom:i.symptom_text, ai_summary:i.ai_summary }))
        .filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, 5);

      const { data: incident, error: insErr } = await supabase.from('incidents').insert({
        org_id: org.id, created_by: user.id,
        title: form.title || 'Live incident',
        service_name: form.service_name || 'unknown-service',
        severity: form.severity,
        symptom_text: form.symptom_text,
        impact: form.impact,
        signals: { raw: form.signals },
        fingerprint: fp,
      }).select('*').single();
      if (insErr) throw insErr;

      logDistributionEvent('first_input', { org_id: org.id });

      // Pre-call: retrieve graph memory context and pass to AI
      const graphMem = graphState
        ? buildMemoryContext(retrieveSubgraph(graphState.mergedGraph, { ...form, fingerprint: fp }))
        : null;

      const ai = await callAI('first60', 'first_diagnostic_branch', {
        ...form, fingerprint: fp, similar_incidents: similar,
        ...(graphMem?.has_memory ? { decision_context: graphMem } : {}),
      });
      const result = ai.result || {};
      logDistributionEvent('first_output', { org_id: org.id, provider: ai.provider });

      // P0-04: store recommendation_id from insert directly
      const recId = await persistRecommendation(incident.id, result, ai.provider);
      await supabase.from('incidents').update({ ai_summary: result }).eq('id', incident.id);

      // Post-call: add incident + decision nodes to intelligence graph
      if (graphState) {
        try {
          const g1 = addIncidentToGraph(graphState.mergedGraph, { ...incident, fingerprint: fp }, user.id);
          const incNode = findIncidentNode(g1, incident.id);
          const { graph: g2, decisionNodeId } = addDecisionToGraph(g1, incNode?.id, { ...result, id: recId }, user.id);
          await graphState.persistOrgGraph(g2);
          setCurrentIncidentNodeId(incNode?.id || null);
          setCurrentDecisionNodeId(decisionNodeId || null);
        } catch (gErr) {
          console.warn('Graph update failed:', gErr.message);
        }
      }

      // Store data needed for retry in case of fallback
      setRetryData({ fp, similar, incident, form: { ...form } });
      setOutput({ incident, similar, provider: ai.provider, recommendation: result, rec_id: recId, fallback: !!ai.fallback, generatedAt: ai.generated_at, latencyMs: ai.latency_ms });
      setForm({ title:'', service_name:'', severity:'high', symptom_text:'', impact:'', signals:'' });
      await load();
    } catch (err) { setError(err.message || String(err)); }
    setBusy(false);
  }

  async function retryAI() {
    if (!retryData || busy) return;
    setBusy(true); setError('');
    try {
      const ai = await callAI('first60', 'first_diagnostic_branch', {
        ...retryData.form, fingerprint: retryData.fp, similar_incidents: retryData.similar,
      });
      const result = ai.result || {};
      const recId = await persistRecommendation(retryData.incident.id, result, ai.provider);
      setOutput(prev => ({ ...prev, provider: ai.provider, recommendation: result, rec_id: recId, fallback: !!ai.fallback, generatedAt: ai.generated_at, latencyMs: ai.latency_ms }));
    } catch (err) { setError(err.message || String(err)); }
    setBusy(false);
  }

  async function saveOutcome(usefulness) {
    if (!output?.incident?.id || outcomeSaved) return;
    const outcomeMap = { successful: 'successful', partial: 'partial', failed: 'failed' };
    // P0-04: rec_id stored at generation time; adopted only true when branch was actually followed
    const { data: outcomeRow } = await supabase.from('recommendation_outcomes').insert({
      org_id: org.id,
      incident_id: output.incident.id,
      recommendation_id: output.rec_id || null,
      adopted: usefulness === 'successful',
      outcome: outcomeMap[usefulness] || 'unknown',
      notes: `Branch usefulness: ${usefulness}.`,
    }).select('id').single();
    setOutcomeSaved(true);
    logDistributionEvent('outcome_tagged', { org_id: org.id, outcome: usefulness });

    // Record outcome in intelligence graph
    if (graphState && currentIncidentNodeId) {
      try {
        const g = recordOutcomeInGraph(
          graphState.mergedGraph, currentIncidentNodeId, currentDecisionNodeId,
          { id: outcomeRow?.id || `outcome-${Date.now()}`, usefulness, resolution: '' }, user.id,
        );
        await graphState.persistOrgGraph(g);
      } catch (gErr) {
        console.warn('Graph outcome update failed:', gErr.message);
      }
    }

    await load();
  }

  const isColdStart = incidents.length === 0 && !output;

  return <div className="grid">
    <div className="card">
      <h2>First-60 diagnostic capture</h2>
      {isColdStart && (
        <div style={{marginBottom:16,padding:'12px 14px',background:'var(--surface2)',borderRadius:6,borderLeft:'3px solid var(--accent)'}}>
          <div className="kicker" style={{marginBottom:4}}>No prior incidents yet</div>
          <p style={{margin:'0 0 8px',fontSize:13}}>Load a real postmortem to see how TraceCrumb works — GitHub's 2018 MySQL incident, where the first-response window was spent on application fixes while a 43-second replica lag gap was the actual cause.</p>
          <div className="row">
            <button className="secondary" type="button" style={{fontSize:12}} onClick={() => setForm(SAMPLE_INCIDENT)}>Load sample incident</button>
            <span style={{fontSize:11,color:'var(--text2)'}}>Public postmortem · github.blog</span>
          </div>
        </div>
      )}
      <form className="form-grid" onSubmit={submit}>
        <label>Incident title<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Checkout latency spike after deploy" maxLength={200} /></label>
        <label>Service<input value={form.service_name} onChange={e=>setForm({...form,service_name:e.target.value})} placeholder="payments-api" maxLength={100} /></label>
        <label>Severity<select value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label>
        <label>Symptoms<textarea required value={form.symptom_text} onChange={e=>setForm({...form,symptom_text:e.target.value})} placeholder="Error rate jumped, 5xx concentrated on POST /charge, queue depth rising..." maxLength={2000} /></label>
        <label>Signals / recent changes<textarea value={form.signals} onChange={e=>setForm({...form,signals:e.target.value})} placeholder="Last deploy 14m ago; Redis CPU high; auth dependency stable..." maxLength={2000} /></label>
        <label>Impact<textarea value={form.impact} onChange={e=>setForm({...form,impact:e.target.value})} placeholder="EU customers unable to checkout" maxLength={1000} /></label>
        {error && <p className="loss">{error}</p>}
        <button disabled={busy}>{busy ? 'Generating branch...' : 'Generate first diagnostic branch'}</button>
      </form>
    </div>

    <div className="card">
      <h2>First diagnostic branch</h2>
      {output ? <>
        {output.fallback && <FallbackBanner onRetry={retryAI} busy={busy} />}
        <ProvenanceBlock provider={output.provider} similar={output.similar} generatedAt={output.generatedAt} latencyMs={output.latencyMs} />
        <RecommendationOutput rec={output.recommendation} />
        <div className="row result-actions">
          <button className="secondary" type="button" onClick={() => downloadJson(
            `${safeFilename(output.incident?.title, 'tracecrumb-incident')}-packet.json`,
            {
              exported_at: new Date().toISOString(),
              product: BRANCH.product,
              incident: output.incident,
              recommendation: output.recommendation,
              provenance: {
                provider: output.provider,
                generated_at: output.generatedAt,
                latency_ms: output.latencyMs,
                fallback: output.fallback,
                similar_incidents: output.similar,
              },
            },
          )}>Export private incident packet</button>
          <ShareButton label="Share the app" text="A first-response tool that turns incident symptoms into a defensible first diagnostic branch." />
        </div>
        {!outcomeSaved ? <>
          <p style={{fontSize:12,color:'var(--text2)',margin:'12px 0 6px'}}>Did this branch lead toward the root cause?</p>
          <div className="row">
            <button onClick={()=>saveOutcome('successful')}>Useful — followed this branch</button>
            <button className="secondary" onClick={()=>saveOutcome('partial')}>Partially useful</button>
            <button className="danger" onClick={()=>saveOutcome('failed')}>Wrong branch — did not follow</button>
          </div>
        </> : <p className="ok" style={{marginTop:10}}>Outcome recorded — this becomes part of your incident memory.</p>}
      </> : <p>Submit an incident to generate the first branch and preserve the decision trace.</p>}
    </div>

    <div className="card" style={{gridColumn:'1 / -1'}}>
      <div className="header compact-header">
        <div><h2>Recent incident memory</h2><p className="microcopy">Export stays local to your browser download. Sharing sends only the app link, never incident data.</p></div>
        <div className="row">
          {incidents.length > 0 && <button className="secondary" type="button" onClick={() => downloadJson(`tracecrumb-${safeFilename(org?.name, 'org')}-incident-memory.json`, { exported_at:new Date().toISOString(), org:{id:org.id,name:org.name}, incidents })}>Export history</button>}
          <ShareButton label="Share app" />
        </div>
      </div>
      {incidents.length === 0
        ? <p style={{color:'var(--text2)',fontSize:13}}>No incidents yet. Submit your first incident above — or load the sample to see how the output looks.</p>
        : <div className="list">{incidents.map(i=><div className="item" key={i.id}><strong>{i.title}</strong><p>{i.service_name} · {i.severity} · {new Date(i.created_at).toLocaleString()}</p><p>{i.symptom_text}</p></div>)}</div>
      }
    </div>
  </div>
}

function Resume({ user, org }) {
  const [form, setForm] = useState({ title:'', objective:'', task_ref:'', active_state:'', interruption_type:'context_switch', source_context:'', open_threads:'', dependencies:'', recent_decisions:'' });
  const [bundles, setBundles] = useState([]); const [output, setOutput] = useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function load(){ const {data}=await supabase.from('resume_bundles').select('*, work_blocks(title, task_ref)').eq('org_id',org.id).order('created_at',{ascending:false}).limit(20); setBundles(data||[]); }
  useEffect(()=>{load();},[org?.id]);
  async function submit(e){ e.preventDefault(); setBusy(true); setError(''); setOutput(null); try{
    const {data:block,error:blockErr}=await supabase.from('work_blocks').insert({org_id:org.id,created_by:user.id,...form}).select('*').single(); if(blockErr) throw blockErr;
    if(form.source_context) await supabase.from('context_fragments').insert({org_id:org.id,work_block_id:block.id,source_type:'note',content:form.source_context,source_ref:form.task_ref,importance:.8});
    const ai=await callAI('resume','context_restoration_bundle',form); const result=ai.result||{};
    const {data:bundle,error:bErr}=await supabase.from('resume_bundles').insert({org_id:org.id,work_block_id:block.id,bundle:result,confidence:num(result.confidence),provider:ai.provider}).select('*').single(); if(bErr) throw bErr;
    setOutput({block,bundle,result,provider:ai.provider}); setForm({ title:'', objective:'', task_ref:'', active_state:'', interruption_type:'context_switch', source_context:'', open_threads:'', dependencies:'', recent_decisions:'' }); await load();
  }catch(err){setError(err.message||String(err));} setBusy(false); }
  async function mark(minutes){ if(!output?.block) return; await supabase.from('restoration_events').insert({org_id:org.id,work_block_id:output.block.id,resume_bundle_id:output.bundle.id,minutes_to_first_output:minutes,notes:'Marked from MVP UI'}); await load(); }
  return <div className="grid"><div className="card"><h2>Context restoration bundle</h2><form className="form-grid" onSubmit={submit}>
    <label>Work block title<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Finish auth/RLS migration" /></label>
    <label>Objective<textarea required value={form.objective} onChange={e=>setForm({...form,objective:e.target.value})} placeholder="What outcome matters when you return?" /></label>
    <label>Task / PR / ticket ref<input value={form.task_ref} onChange={e=>setForm({...form,task_ref:e.target.value})} placeholder="GH#42 / Linear ENG-19" /></label>
    <label>Current state<textarea value={form.active_state} onChange={e=>setForm({...form,active_state:e.target.value})} placeholder="What is already done? What is still unstable?" /></label>
    <label>Interruption type<select value={form.interruption_type} onChange={e=>setForm({...form,interruption_type:e.target.value})}><option>context_switch</option><option>meeting</option><option>overnight</option><option>incident</option><option>handoff</option><option>other</option></select></label>
    <label>Source context<textarea value={form.source_context} onChange={e=>setForm({...form,source_context:e.target.value})} placeholder="Paste Slack/Jira/GitHub notes. Keep secrets out." /></label>
    <label>Open threads<textarea value={form.open_threads} onChange={e=>setForm({...form,open_threads:e.target.value})} /></label>
    <label>Dependencies<textarea value={form.dependencies} onChange={e=>setForm({...form,dependencies:e.target.value})} /></label>
    <label>Recent decisions<textarea value={form.recent_decisions} onChange={e=>setForm({...form,recent_decisions:e.target.value})} /></label>
    {error && <p className="loss">{error}</p>}<button disabled={busy}>{busy?'Generating restore state...':'Generate Resume Work bundle'}</button>
  </form></div><div className="card"><h2>Resume output</h2>{output?<><div className="row"><span className="pill">provider: {output.provider}</span><span className="pill">TTFMO target: &lt; 5 min</span></div><pre className="output">{pretty(output.result)}</pre><div className="row"><button onClick={()=>mark(5)}>First output ≤5m</button><button className="secondary" onClick={()=>mark(15)}>≤15m</button><button className="danger" onClick={()=>mark(30)}>30m+</button></div></>:<p>Generate a bundle before stopping work; use it when returning.</p>}</div><div className="card" style={{gridColumn:'1 / -1'}}><h2>Recent resume bundles</h2><div className="list">{bundles.map(b=><div className="item" key={b.id}><strong>{b.work_blocks?.title || 'Work block'}</strong><p>{new Date(b.created_at).toLocaleString()} · confidence {b.confidence}</p><pre className="output">{pretty(b.bundle)}</pre></div>)}</div></div></div>
}

function Handoff({ user, org }) {
  const [form,setForm]=useState({workflow_ref:'',from_actor:'',to_actor:'',state:'',intent:'',constraints:'',open_unknowns:'',dependencies:'',risks:'',continuation_path:''});
  const [packets,setPackets]=useState([]); const [output,setOutput]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function load(){const{data}=await supabase.from('handoff_packets').select('*').eq('org_id',org.id).order('created_at',{ascending:false}).limit(20);setPackets(data||[])}
  useEffect(()=>{load()},[org?.id]);
  async function submit(e){e.preventDefault();setBusy(true);setError('');setOutput(null);try{const ai=await callAI('handoff','continuity_handoff_packet',form);const result=ai.result||{};const{data,error:pErr}=await supabase.from('handoff_packets').insert({org_id:org.id,created_by:user.id,workflow_ref:form.workflow_ref,from_actor:form.from_actor||'sender',to_actor:form.to_actor||'receiver',packet:result,status:'sent'}).select('*').single();if(pErr)throw pErr;setOutput({packet:data,result,provider:ai.provider});setForm({workflow_ref:'',from_actor:'',to_actor:'',state:'',intent:'',constraints:'',open_unknowns:'',dependencies:'',risks:'',continuation_path:''});await load();}catch(err){setError(err.message||String(err));}setBusy(false)}
  async function mark(recontact,score){if(!output?.packet)return;await supabase.from('handoff_outcomes').insert({org_id:org.id,handoff_packet_id:output.packet.id,recontact_required:recontact,continuity_score:score,notes:recontact?'Receiver required clarification':'Receiver continued without re-contact'});await load()}
  return <div className="grid"><div className="card"><h2>Operational handoff packet</h2><form className="form-grid" onSubmit={submit}>
    <label>Workflow / incident ref<input value={form.workflow_ref} onChange={e=>setForm({...form,workflow_ref:e.target.value})} placeholder="INC-1042 / Shift A→B" /></label><div className="grid"><label>From<input value={form.from_actor} onChange={e=>setForm({...form,from_actor:e.target.value})} /></label><label>To<input value={form.to_actor} onChange={e=>setForm({...form,to_actor:e.target.value})} /></label></div>
    <label>Current state<textarea required value={form.state} onChange={e=>setForm({...form,state:e.target.value})} /></label><label>Intent/rationale<textarea required value={form.intent} onChange={e=>setForm({...form,intent:e.target.value})} /></label><label>Constraints<textarea value={form.constraints} onChange={e=>setForm({...form,constraints:e.target.value})} /></label><label>Open unknowns<textarea value={form.open_unknowns} onChange={e=>setForm({...form,open_unknowns:e.target.value})} /></label><label>Dependencies<textarea value={form.dependencies} onChange={e=>setForm({...form,dependencies:e.target.value})} /></label><label>Risks<textarea value={form.risks} onChange={e=>setForm({...form,risks:e.target.value})} /></label><label>Suggested continuation path<textarea value={form.continuation_path} onChange={e=>setForm({...form,continuation_path:e.target.value})} /></label>{error&&<p className="loss">{error}</p>}<button disabled={busy}>{busy?'Building packet...':'Generate handoff packet'}</button>
  </form></div><div className="card"><h2>Handoff output</h2>{output?<><div className="row"><span className="pill">provider: {output.provider}</span><span className="pill">primary metric: re-contact</span></div><pre className="output">{pretty(output.result)}</pre><div className="row"><button onClick={()=>mark(false,.9)}>No re-contact</button><button className="danger" onClick={()=>mark(true,.35)}>Re-contact needed</button></div></>:<p>Generate a packet that transfers intent, uncertainty, dependency state, and next action.</p>}</div><div className="card" style={{gridColumn:'1 / -1'}}><h2>Recent handoffs</h2><div className="list">{packets.map(p=><div className="item" key={p.id}><strong>{p.workflow_ref || 'Handoff'}</strong><p>{p.from_actor} → {p.to_actor} · {new Date(p.created_at).toLocaleString()}</p><pre className="output">{pretty(p.packet)}</pre></div>)}</div></div></div>
}

function Continuity({ user, org }) {
  const [form,setForm]=useState({workflow_name:'',meeting_type:'status_sync',original_meeting_frequency:'weekly',current_state:'',decisions_needed:'',blockers:'',owners:'',restoration_capacity:.5,handoff_integrity:.5,coordination_persistence:.5,decision_memory_density:.5,dependency_resilience:.5,interruption_sensitivity:.5});
  const [items,setItems]=useState([]); const [output,setOutput]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function load(){const{data}=await supabase.from('coordination_artifacts').select('*').eq('org_id',org.id).order('created_at',{ascending:false}).limit(20);setItems(data||[])}
  useEffect(()=>{load()},[org?.id]);
  const eci=useMemo(()=>{const r=num(form.restoration_capacity),h=num(form.handoff_integrity),c=num(form.coordination_persistence),d=num(form.decision_memory_density),dep=num(form.dependency_resilience),i=num(form.interruption_sensitivity); return Math.max(0,Math.min(1,(.25*r)+(.25*h)+(.20*c)+(.15*d)+(.10*dep)+(.05*(1-i))));},[form]);
  async function submit(e){e.preventDefault();setBusy(true);setError('');setOutput(null);try{const payload={...form,eci_score:eci};const ai=await callAI('continuity','async_coordination_and_eci',payload);const result=ai.result||{};const sub=result.meeting_substitution_verdict==='high'?'high':result.meeting_substitution_verdict==='low'?'low':'partial';const{data,error:aErr}=await supabase.from('coordination_artifacts').insert({org_id:org.id,created_by:user.id,workflow_name:form.workflow_name,meeting_type:form.meeting_type,original_meeting_frequency:form.original_meeting_frequency,substitutability:sub,artifact:result,status:'trial'}).select('*').single();if(aErr)throw aErr;await supabase.from('eci_snapshots').insert({org_id:org.id,workflow_name:form.workflow_name,restoration_capacity:num(form.restoration_capacity),handoff_integrity:num(form.handoff_integrity),coordination_persistence:num(form.coordination_persistence),decision_memory_density:num(form.decision_memory_density),dependency_resilience:num(form.dependency_resilience),interruption_sensitivity:num(form.interruption_sensitivity),eci_score:eci,raw_inputs:payload});setOutput({artifact:data,result,provider:ai.provider,eci});await load();}catch(err){setError(err.message||String(err));}setBusy(false)}
  function range(name,label){return <label>{label}: {form[name]}<input type="range" min="0" max="1" step="0.05" value={form[name]} onChange={e=>setForm({...form,[name]:e.target.value})}/></label>}
  return <div className="grid"><div className="card"><h2>Async coordination + ECI</h2><form className="form-grid" onSubmit={submit}><label>Workflow name<input required value={form.workflow_name} onChange={e=>setForm({...form,workflow_name:e.target.value})} placeholder="Platform deploy readiness" /></label><label>Meeting type<select value={form.meeting_type} onChange={e=>setForm({...form,meeting_type:e.target.value})}><option value="broadcast">broadcast</option><option value="status_sync">status sync</option><option value="decision_resolution">decision resolution</option><option value="incident_sync">incident sync</option><option value="architecture_sync">architecture sync</option><option value="conflict_resolution">conflict resolution</option><option value="novel_reasoning">novel reasoning</option><option value="other">other</option></select></label><label>Meeting frequency<input value={form.original_meeting_frequency} onChange={e=>setForm({...form,original_meeting_frequency:e.target.value})}/></label><label>Current state<textarea required value={form.current_state} onChange={e=>setForm({...form,current_state:e.target.value})}/></label><label>Decisions needed<textarea value={form.decisions_needed} onChange={e=>setForm({...form,decisions_needed:e.target.value})}/></label><label>Blockers<textarea value={form.blockers} onChange={e=>setForm({...form,blockers:e.target.value})}/></label><label>Owners<textarea value={form.owners} onChange={e=>setForm({...form,owners:e.target.value})}/></label>{range('restoration_capacity','Restoration capacity')}{range('handoff_integrity','Handoff integrity')}{range('coordination_persistence','Coordination persistence')}{range('decision_memory_density','Decision memory density')}{range('dependency_resilience','Dependency resilience')}{range('interruption_sensitivity','Interruption sensitivity')}<div className="pill">ECI preview: {eci.toFixed(2)}</div>{error&&<p className="loss">{error}</p>}<button disabled={busy}>{busy?'Generating artifact...':'Generate coordination artifact'}</button></form></div><div className="card"><h2>Continuity output</h2>{output?<><div className="metric"><div><span>ECI</span><b>{output.eci.toFixed(2)}</b></div><div><span>Provider</span><b>{output.provider}</b></div><div><span>Mode</span><b>trial</b></div></div><pre className="output">{pretty(output.result)}</pre></>:<p>Generate a persistent coordination artifact and continuity score before replacing a meeting.</p>}</div><div className="card" style={{gridColumn:'1 / -1'}}><h2>Recent coordination artifacts</h2><div className="list">{items.map(i=><div className="item" key={i.id}><strong>{i.workflow_name}</strong><p>{i.meeting_type} · substitutability {i.substitutability} · {new Date(i.created_at).toLocaleString()}</p><pre className="output">{pretty(i.artifact)}</pre></div>)}</div></div></div>
}


function getSourceChannel() {
  if (typeof window === 'undefined') return 'unknown';
  const params = new URLSearchParams(window.location.search);
  return params.get('source_channel') || params.get('utm_source') || 'direct';
}

async function logDistributionEvent(eventType, metadata = {}) {
  try {
    await supabase.from('distribution_events').insert({
      branch: BRANCH.id,
      source_channel: getSourceChannel(),
      event_type: eventType,
      metadata: { demo: true, path: typeof window !== 'undefined' ? window.location.pathname : '/', ...metadata },
    });
  } catch (_) {
    // Demo utility must never fail because telemetry is unavailable.
  }
}

function demoPayload(branchId) {
  const demos = {
    // Real case study: GitHub Oct 21 2018 database incident (public postmortem)
    // Source: github.blog/engineering/engineering-principles/october-21-post-incident-analysis/
    // Teams spent the first response window on application-level fixes while the
    // actual cause was a 43-second replication lag gap on the auto-promoted replica.
    first60: {
      title: 'GitHub Oct 21 2018 — MySQL primary lost network connectivity · 24h outage',
      source: 'Public GitHub postmortem — github.blog',
      input: [
        'Service: github.com — MySQL primary (US East)',
        'Severity: critical — site degraded / unavailable for 24h+',
        'Signals: planned network switch caused primary to lose connectivity; automatic HA failover (Orchestrator) promoted a replica that was 43 seconds behind; replication topology broke after promotion',
        'Impact: git push/pull, API, web UI globally degraded',
        'Recent change: routine network maintenance 11 minutes before alert',
      ],
      output: {
        suggested_branch: 'Validate replication topology and replica lag before assuming application-layer or pod-level failure.',
        supporting_signals: [
          'Network partition on primary coincides with maintenance window — planned change is likely trigger',
          'Automatic failover promotes a replica; replica lag at promotion time is the key unknown',
          'Application errors are mixed read/write failures — consistent with a behind-replica primary',
        ],
        contradicting_signals: [
          'No recent application deploys — reduces code-change hypothesis',
          'HA system (Orchestrator) selected the candidate — may have already filtered lag',
        ],
        priority_checks: [
          'Confirm replica lag at the exact moment of promotion (binlog position diff)',
          'Verify whether the new primary diverged from the failed primary state',
          'Compare application error types: are they write conflicts or read-version mismatches?',
          'Check if Orchestrator applied any replication safety filters before selecting the candidate',
        ],
        loss_prevention_reason: 'GitHub\'s first-response window was spent on application-level restarts and traffic rerouting. The actual issue was a 43-second gap in the promoted replica — not visible from application errors alone. Earlier replication topology inspection would have surfaced this within the first 10 minutes instead of after 24+ hours.',
        what_actually_happened: 'Orchestrator promoted a replica that was 43 seconds behind. That gap meant 43 seconds of transactions were absent from the new primary. Syncing data back required hours of careful replication work. A branch that checked replica lag first would have identified this before wide mitigation actions compounded the state.',
        confidence: 0.71,
      },
    },
    resume: {
      title: 'Interrupted platform migration work block',
      input: ['Objective: finish deploy-readiness migration', 'Open threads: failing auth smoke test, pending infra review', 'Dependency: Supabase env confirmation'],
      output: {
        intent_layer: 'Resume the migration by restoring the exact blocker stack, not rereading all docs.',
        state_layer: 'Build passes; deployment blocked by env confirmation and auth smoke test.',
        open_threads: ['Auth smoke test', 'Infra review', 'Deployment env parity'],
        suggested_next_action: 'Run the auth smoke test, then update the deployment checklist with the actual failing env key.',
        confidence: 0.58,
      },
    },
    handoff: {
      title: 'Incident commander shift transfer',
      input: ['Sender: IC-A', 'Receiver: IC-B', 'State: mitigation deployed, monitoring error rate', 'Unknown: cache invalidation lag'],
      output: {
        state: 'Mitigation is live; error rate is falling but cache lag remains unverified.',
        intent: 'Receiver can continue monitoring without re-contacting sender.',
        open_unknowns: ['Cache invalidation lag', 'Customer retry volume'],
        continuation_path: 'Validate cache lag, confirm customer impact trend, then decide whether to close incident watch.',
        confidence: 0.57,
      },
    },
    continuity: {
      title: 'Weekly deploy-readiness sync replacement',
      input: ['Meeting: weekly status sync', 'Current state: blockers known', 'Owners: platform + QA', 'ECI inputs: medium-high restoration capacity'],
      output: {
        artifact_type: 'async_coordination_artifact',
        meeting_substitution_verdict: 'partial',
        eci_score_estimate: 0.67,
        next_actions: ['Publish artifact', 'Collect owner updates async', 'Escalate only unresolved decision conflicts'],
        confidence: 0.55,
      },
    },
  };
  return demos[branchId] || demos.first60;
}

function DemoMode() {
  const demo = demoPayload(BRANCH.id);
  const [outcome, setOutcome] = useState('');
  useEffect(() => { logDistributionEvent('demo_loaded', { title: demo.title }); }, []);
  async function mark(value) {
    setOutcome(value);
    await logDistributionEvent('outcome_tagged', { outcome: value, title: demo.title });
  }
  return <div className="container">
    <div className="header">
      <div className="brand">
        <span className="kicker">Worked incident example · {getSourceChannel()}</span>
        <h1>{BRANCH.product}</h1>
        <p>{BRANCH.promise}</p>
      </div>
      <div className="row"><a className="button-link secondary" href="?contact=1&source_channel=demo">Contact</a><ShareButton label="Share demo" url={`${window.location.origin}${window.location.pathname}?demo=1&source_channel=shared_demo`} /><ThemeToggle /><span className="pill">Sample output — no live AI call</span></div>
    </div>
    <div className="hero"><LossCard/><div className="card">
      <h3>Incident scenario</h3>
      <h2>{demo.title}</h2>
      {demo.source && <p style={{fontSize:12,marginTop:0}}>Source: {demo.source}</p>}
      {demo.input.map((line)=><p key={line}>{line}</p>)}
    </div></div>
    <div className="card">
      <h2>First diagnostic branch — what TraceCrumb would have surfaced</h2>
      <RecommendationOutput rec={demo.output} />
      <div className="row result-actions">
        <button className="secondary" type="button" onClick={() => downloadJson(`${safeFilename(demo.title, 'tracecrumb-demo')}-example.json`, { exported_at:new Date().toISOString(), product:BRANCH.product, sample:true, ...demo })}>Export worked example</button>
        <ShareButton label="Share worked example" url={`${window.location.origin}${window.location.pathname}?demo=1&source_channel=shared_demo`} />
      </div>
      {!outcome ? (
        <div style={{marginTop:16}}>
          <p style={{fontSize:12,color:'var(--text2)',margin:'0 0 6px'}}>Would this branch have saved time in your incidents?</p>
          <div className="row">
            <button onClick={()=>mark('useful')}>Useful</button>
            <button className="secondary" onClick={()=>mark('partial')}>Partially useful</button>
            <button className="danger" onClick={()=>mark('missed')}>Missed the mark</button>
          </div>
        </div>
      ) : <p className="ok" style={{marginTop:10}}>Outcome captured: {outcome}</p>}
    </div>
    {outcome && <NewsletterPopup context="demo" />}
  </div>
}

export default function App() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const isDemo = params.get('demo') === '1';
  const isContact = params.get('contact') === '1';
  const [session, setSession] = useState(null);
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState('landing');
  const { mergedGraph, graphLoading, persistOrgGraph, persistUserGraph } = useIntelligenceGraph(
    session?.user?.id, org?.id,
  );
  const graphState = (session && org) ? { mergedGraph, persistOrgGraph, persistUserGraph } : null;

  async function boot() {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (session?.user) {
        const orgObj = await ensureOrg(session.user);
        setOrg(orgObj);
      }
    } catch (err) {
      setError(err.message || String(err));
    }
    setLoading(false);
  }

  useEffect(() => {
    boot();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => boot());
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setOrg(null);
    setScreen('landing');
  }

  if (isContact) return <ContactPage />;
  if (isDemo) return <DemoMode />;
  if (loading) return <div className="container"><div className="card">Loading First60...</div></div>;
  function continueFromLanding() {
    setScreen(session ? 'app' : 'auth');
  }

  if (screen !== 'app' && screen !== 'auth') return <LandingPage onStart={continueFromLanding} />;
  if (!session) return <AuthPanel onReady={async () => { await boot(); setScreen('app'); }} onBack={() => setScreen('landing')} />;

  return <div className="container">
    <Header user={session.user} org={org} signOut={signOut}/>
    {error && <div className="card"><p className="loss">{error}</p></div>}
    <div className="hero"><LossCard/><div className="card"><h3>Recommendation basis</h3><p>{BRANCH.promise}</p><div className="row"><span className="pill">Org-scoped incident memory</span><span className="pill">AI with safe fallback</span></div></div></div>
    {BRANCH.id === 'first60' && <First60 user={session.user} org={org} graphState={graphState}/>}
    {BRANCH.id === 'first60' && !graphLoading && (
      <div className="card" style={{marginTop:0}}>
        <GraphView graph={mergedGraph} title="Organisation Intelligence Graph" />
      </div>
    )}
    {BRANCH.id === 'resume' && <Resume user={session.user} org={org}/>}
    {BRANCH.id === 'handoff' && <Handoff user={session.user} org={org}/>}
    {BRANCH.id === 'continuity' && <Continuity user={session.user} org={org}/>}
  </div>;
}
