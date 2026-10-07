import test from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets } from '../scripts/check-secrets.mjs';

test('release gate detects credential formats without returning credential values',()=>{
  for(const sample of ['sk-'+'A'.repeat(32),'ghp_'+'B'.repeat(36),'AIza'+'C'.repeat(35),'apiKey: "'+'D'.repeat(32)+'"']){
    const result=findSecrets(sample);assert.ok(result.length);assert.equal(JSON.stringify(result).includes(sample),false);
  }
});

test('release gate permits empty keys, explicit test fixtures and Actions token references',()=>{
  for(const sample of ['apiKey: ""','apiKey: "TEST_ONLY_KEY"','${{ secrets.GITHUB_TOKEN }}'])assert.deepEqual(findSecrets(sample),[]);
});
