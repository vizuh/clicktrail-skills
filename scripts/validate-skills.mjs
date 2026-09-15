import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SKILLS_DIR = path.resolve(__dirname, '../skills');

export const EXPECTED_SKILLS = [
  'google-ads-offline-conversions',
  'meta-capi-deduplication',
  'preserve-click-ids',
  'cross-domain-attribution',
  'lead-to-sale-attribution',
  'crm-revenue-attribution',
  'attribution-debugging',
  'conversion-reconciliation'
];

export const REQUIRED_PROTOCOL_STEPS = [
  { num: 1, name: 'CAPTURE' },
  { num: 2, name: 'PERSIST' },
  { num: 3, name: 'CARRY' },
  { num: 4, name: 'ATTACH' },
  { num: 5, name: 'REPORT' },
  { num: 6, name: 'DEDUPE' },
  { num: 7, name: 'VERIFY' }
];

export function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { error: 'File does not start with YAML frontmatter delimiter (---)' };
  }
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { error: 'YAML frontmatter closing delimiter (---) not found' };
  }
  const yamlText = content.slice(3, endIdx).trim();
  const data = {};
  for (const line of yamlText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      data[key] = val;
    }
  }
  return { data, body: content.slice(endIdx + 4) };
}

export function validateSkill(skillDirName, skillsBaseDir = DEFAULT_SKILLS_DIR) {
  const skillPath = path.join(skillsBaseDir, skillDirName);
  const errors = [];

  if (!fs.existsSync(skillPath)) {
    return { valid: false, errors: [`Directory does not exist: ${skillPath}`] };
  }

  const skillMdPath = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    return { valid: false, errors: [`SKILL.md missing in ${skillDirName}`] };
  }

  const content = fs.readFileSync(skillMdPath, 'utf8');
  const { data: frontmatter, body, error: fmError } = parseFrontmatter(content);

  if (fmError) {
    errors.push(`Frontmatter error: ${fmError}`);
    return { valid: false, errors };
  }

  // 1. Validate name
  if (!frontmatter.name) {
    errors.push('Missing "name" in frontmatter');
  } else if (frontmatter.name !== skillDirName) {
    errors.push(`Frontmatter name "${frontmatter.name}" does not match folder "${skillDirName}"`);
  }

  // 2. Validate description
  if (!frontmatter.description || frontmatter.description.trim().length < 25) {
    errors.push('Frontmatter "description" is missing or too short (must be >= 25 chars)');
  }

  // 3. Validate Canonical 7-step Protocol
  const upperBody = body.toUpperCase();
  for (const step of REQUIRED_PROTOCOL_STEPS) {
    // Check for "1. CAPTURE", "Step 1: CAPTURE", "## 1. CAPTURE", etc.
    const regex = new RegExp(`(?:STEP\\s*${step.num}|\\b${step.num}[.):-]\\s*|###?\\s*\\d?[.):]?\\s*)${step.name}`, 'i');
    const simpleMatch = upperBody.includes(step.name);
    if (!regex.test(body) && !simpleMatch) {
      errors.push(`Missing Protocol Step ${step.num}: ${step.name}`);
    }
  }

  // 4. Validate Implementation Options (Option A & Option B)
  const hasOptionsSection = /implementation\s+options/i.test(body);
  const hasOptionA = /option\s+a[:\s-]/i.test(body) && (/vendor-neutral/i.test(body) || /manual/i.test(body));
  const hasOptionB = /option\s+b[:\s-]/i.test(body) && (/clicktrail/i.test(body) || /@vizuh\/clicktrail/i.test(body));

  if (!hasOptionsSection) {
    errors.push('Missing "Implementation Options" section');
  }
  if (!hasOptionA) {
    errors.push('Missing Option A (Vendor-Neutral / Manual Implementation)');
  }
  if (!hasOptionB) {
    errors.push('Missing Option B (Turnkey ClickTrail Implementation with @vizuh/clicktrail)');
  }

  // 5. Validate Failure Modes & Debugging
  const hasFailureModes = /failure\s+modes/i.test(body) || /debugging\s+checks/i.test(body) || /troubleshooting/i.test(body);
  if (!hasFailureModes) {
    errors.push('Missing "Failure Modes & Debugging Checks" section');
  }

  return {
    valid: errors.length === 0,
    skill: skillDirName,
    errors
  };
}

export function validateAllSkills(skillsBaseDir = DEFAULT_SKILLS_DIR) {
  const results = [];
  let allValid = true;

  for (const skillName of EXPECTED_SKILLS) {
    const res = validateSkill(skillName, skillsBaseDir);
    results.push(res);
    if (!res.valid) {
      allValid = false;
    }
  }

  return {
    valid: allValid,
    total: EXPECTED_SKILLS.length,
    results
  };
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Validating ClickTrail skills catalog...');
  const summary = validateAllSkills();
  let failCount = 0;

  for (const r of summary.results) {
    if (r.valid) {
      console.log(`  [PASS] ${r.skill}`);
    } else {
      failCount++;
      console.error(`  [FAIL] ${r.skill}:`);
      for (const err of r.errors) {
        console.error(`    - ${err}`);
      }
    }
  }

  if (!summary.valid) {
    console.error(`\nValidation failed: ${failCount} of ${summary.total} skills have issues.`);
    process.exit(1);
  } else {
    console.log(`\nAll ${summary.total} skills passed validation cleanly!`);
    process.exit(0);
  }
}
