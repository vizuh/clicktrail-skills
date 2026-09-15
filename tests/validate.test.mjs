import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_SKILLS,
  REQUIRED_PROTOCOL_STEPS,
  validateSkill,
  validateAllSkills,
  parseFrontmatter
} from '../scripts/validate-skills.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIR = path.resolve(__dirname, '../skills');

describe('ClickTrail Problem-Oriented Skills Suite', () => {
  it('should define all expected problem skills in the catalog', () => {
    assert.strictEqual(EXPECTED_SKILLS.length, 14);
    const expected = [
      'google-ads-offline-conversions',
      'meta-capi-deduplication',
      'preserve-click-ids',
      'cross-domain-attribution',
      'lead-to-sale-attribution',
      'crm-revenue-attribution',
      'attribution-debugging',
      'conversion-reconciliation',
      'click-tracking-audit',
      'click-id-debugging',
      'click-to-crm-attribution',
      'google-ads-click-tracking',
      'utm-and-click-id-persistence',
      'offline-conversion-tracking'
    ];
    assert.deepStrictEqual([...EXPECTED_SKILLS].sort(), [...expected].sort());
  });

  it('should validate parser on sample frontmatter', () => {
    const raw = '---\nname: sample-skill\ndescription: Test description\n---\nContent body';
    const parsed = parseFrontmatter(raw);
    assert.strictEqual(parsed.data.name, 'sample-skill');
    assert.strictEqual(parsed.data.description, 'Test description');
    assert.strictEqual(parsed.body.trim(), 'Content body');
  });

  describe('Individual Skill File Validations', () => {
    for (const skillName of EXPECTED_SKILLS) {
      it(`validates skill: ${skillName}`, () => {
        const result = validateSkill(skillName, SKILLS_DIR);
        if (!result.valid) {
          assert.fail(`Validation failed for "${skillName}":\n  ${result.errors.join('\n  ')}`);
        }
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.errors.length, 0);
      });
    }
  });

  it('keeps high-intent routing distinct and links audit resources', () => {
    const readDescription = (name) => parseFrontmatter(fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')).data.description;
    assert.match(readDescription('click-id-debugging'), /provider-neutral/);
    assert.match(readDescription('click-id-debugging'), /google-ads-click-tracking/);
    assert.match(readDescription('preserve-click-ids'), /existing browser implementation loses/);
    assert.match(readDescription('google-ads-click-tracking'), /specifically concerns Google Ads/);
    assert.match(readDescription('click-id-debugging'), /Do not use for storage-policy design/);
    assert.match(readDescription('preserve-click-ids'), /do not use for greenfield storage-policy design/);
    assert.match(readDescription('utm-and-click-id-persistence'), /do not use for a browser-specific implementation repair/);
    const audit = fs.readFileSync(path.join(SKILLS_DIR, 'click-tracking-audit', 'SKILL.md'), 'utf8');
    assert.match(audit, /Load every resource that matches/);
    assert.match(audit, /skip unrelated resources/);
    for (const resource of ['rules/capture-click-ids.md', 'rules/consent-boundary.md', 'rules/data-layer.md', 'rules/deduplication.md', 'rules/verification.md', 'references/google-ads.md', 'references/meta.md', 'examples/nextjs.md', 'examples/wordpress.md', 'examples/shopify.md']) {
      assert.match(audit, new RegExp(resource.replace(/[./]/g, '\\$&')));
    }
  });

  it('should pass complete suite validation with zero errors across all skills', () => {
    const summary = validateAllSkills(SKILLS_DIR);
    assert.strictEqual(summary.valid, true, `Suite failed: ${JSON.stringify(summary.results.filter(r => !r.valid))}`);
    assert.strictEqual(summary.total, 14);
    for (const res of summary.results) {
      assert.strictEqual(res.valid, true, `Skill ${res.skill} has errors: ${res.errors.join(', ')}`);
    }
  });
});
