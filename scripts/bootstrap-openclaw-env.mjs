import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repoRoot = process.cwd();
const home = os.homedir();

const secretSources = {
  TELNYX_API_KEY: path.join(home, '.openclaw/workspace/telnyx-toolkit/.env'),
  INTERNAL_API_KEY: path.join(home, '.openclaw/workspace/apis/fixyourleads/secrets/key.env'),
  APP_BASE_URL: path.join(home, '.openclaw/workspace/apis/fixyourleads/secrets/key.env')
};

const aliasMap = {
  APP_BASE_URL: ['APP_BASE_URL', 'FYL_BASE_URL'],
  INTERNAL_API_KEY: ['INTERNAL_API_KEY'],
  TELNYX_API_KEY: ['TELNYX_API_KEY']
};

const requiredKeys = [
  'DATABASE_URL',
  'REDIS_URL',
  'TELNYX_API_KEY',
  'TELNYX_FROM_NUMBER',
  'APP_BASE_URL',
  'INTERNAL_API_KEY'
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();
    values[key] = raw.replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function loadResolvedValues() {
  const resolved = {};

  for (const [targetKey, filePath] of Object.entries(secretSources)) {
    const envValues = parseEnvFile(filePath);
    const aliases = aliasMap[targetKey] || [targetKey];
    const match = aliases.find((alias) => envValues[alias]);
    if (match) {
      resolved[targetKey] = envValues[match];
    }
  }

  return resolved;
}

function escapeEnvValue(value) {
  return JSON.stringify(value ?? '');
}

function buildEnvLocal(values) {
  const lines = [
    '# Generated from local OpenClaw secret files.',
    '# Fill in any blank values before running the app locally.'
  ];

  for (const key of requiredKeys) {
    lines.push(`${key}=${escapeEnvValue(values[key] ?? '')}`);
  }

  return `${lines.join('\n')}\n`;
}

const outputPath = path.join(repoRoot, '.env.local');
const resolvedValues = loadResolvedValues();
fs.writeFileSync(outputPath, buildEnvLocal(resolvedValues), 'utf8');

const missing = requiredKeys.filter((key) => !resolvedValues[key]);
console.log(`Wrote ${outputPath}`);
console.log(`Loaded: ${requiredKeys.filter((key) => resolvedValues[key]).join(', ') || 'none'}`);
console.log(`Missing: ${missing.join(', ') || 'none'}`);
