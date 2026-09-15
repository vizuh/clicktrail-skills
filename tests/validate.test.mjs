import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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

  it('should pass complete suite validation with zero errors across all skills', () => {
    const summary = validateAllSkills(SKILLS_DIR);
    assert.strictEqual(summary.valid, true, `Suite failed: ${JSON.stringify(summary.results.filter(r => !r.valid))}`);
    assert.strictEqual(summary.total, 14);
    for (const res of summary.results) {
      assert.strictEqual(res.valid, true, `Skill ${res.skill} has errors: ${res.errors.join(', ')}`);
    }
  });
});
