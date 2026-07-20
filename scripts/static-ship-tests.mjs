import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const branchName = pkg.name.replace('tracecrumb-', '');
const allowed = new Set(['first60', 'resume', 'handoff', 'continuity']);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

if (!allowed.has(branchName)) fail(`Unknown branch from package name: ${pkg.name}`); else pass(`branch package name ${pkg.name}`);

const appPath = join(root, 'src', 'App.jsx');
const configPath = join(root, 'src', 'branchConfig.js');
const schemaPath = join(root, 'supabase', 'schema.sql');
const clientPath = join(root, 'src', 'lib', 'supabaseClient.js');

for (const path of [appPath, configPath, schemaPath, clientPath, join(root, 'supabase', 'functions', 'ai-orchestrator', 'index.ts')]) {
  if (!existsSync(path)) fail(`Missing required file: ${path}`); else pass(`exists ${path.replace(root + '/', '')}`);
}

const app = readFileSync(appPath, 'utf8');
const config = readFileSync(configPath, 'utf8');
const schema = readFileSync(schemaPath, 'utf8');
const client = readFileSync(clientPath, 'utf8');

if (!config.includes(`"id": "${branchName}"`)) fail(`branchConfig id does not match ${branchName}`); else pass('branchConfig id matches package branch');
if (!app.includes('DemoMode')) fail('App lacks DemoMode'); else pass('DemoMode present');
if (!app.includes("get('demo') === '1'")) fail('App lacks ?demo=1 gate'); else pass('?demo=1 gate present');
if (!app.includes('source_channel')) fail('App lacks source_channel capture'); else pass('source_channel capture present');
if (!app.includes('outcome_tagged')) fail('App lacks demo outcome telemetry'); else pass('outcome telemetry present');
if (!schema.includes('create table if not exists public.distribution_events')) fail('schema lacks distribution_events table'); else pass('distribution_events table present');
if (!schema.includes('distribution_events_anon_insert')) fail('schema lacks anon/auth insert policy for demo telemetry'); else pass('distribution_events insert policy present');
if (client.includes("createClient(supabaseUrl || '', supabaseAnonKey || '')")) fail('Supabase client can crash with empty env'); else pass('Supabase client has safe env fallback');
if (app.includes('OPENAI_API_KEY') || app.includes('GEMINI_API_KEY')) fail('Client app references server-side AI secrets'); else pass('no server-side AI secrets in client app');

if (!app.includes('ContactPage')) fail('App lacks public ContactPage'); else pass('public ContactPage present');
if (!app.includes('leadingproblemsolver@gmail.com')) fail('App lacks direct contact email'); else pass('direct contact email present');
if (!app.includes('NewsletterSignup')) fail('App lacks persistent newsletter signup'); else pass('persistent newsletter signup present');
if (!app.includes('downloadJson')) fail('App lacks export utility'); else pass('incident export utility present');
if (!app.includes('ShareButton')) fail('App lacks share utility'); else pass('share utility present');
if (!schema.includes('create table if not exists public.contact_messages')) fail('schema lacks contact_messages table'); else pass('contact_messages table present');
if (!schema.includes('contact_messages_anon_insert')) fail('schema lacks public contact insert policy'); else pass('contact_messages insert policy present');
const graphViewPath = join(root, 'src', 'GraphView.jsx');
if (!existsSync(graphViewPath)) fail('Missing GraphView.jsx'); else {
  const graphView = readFileSync(graphViewPath, 'utf8');
  if (!graphView.includes('graph-node-enter')) fail('Graph lacks new-record animation'); else pass('new-record graph animation present');
  if (!graphView.includes('exportGraphJson')) fail('Graph lacks JSON export'); else pass('graph JSON export present');
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`STATIC SHIP TESTS OK: ${branchName}`);
