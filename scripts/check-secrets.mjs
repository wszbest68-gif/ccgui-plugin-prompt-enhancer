import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const patterns = [
  ['provider-key', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['google-key', /\bAIza[A-Za-z0-9_-]{30,}/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g],
  ['literal-credential', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)["']?\s*[:=]\s*["']([A-Za-z0-9_./+=:-]{20,})["']/gi]
];

export function findSecrets(text) {
  return patterns.filter(([,pattern]) => { pattern.lastIndex=0;return pattern.test(text); }).map(([name])=>name);
}

function git(args) {
  const result=spawnSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
  if(result.status!==0)throw new Error('Git inventory failed; scan aborted.');
  return result.stdout;
}

function main() {
  const findings=[];
  const inspect=(name,text)=>{
    for(const rule of findSecrets(text))findings.push({file:name,rule});
  };
  const files=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  for(const file of files){
    if (/(?:^|\/)(?:\.env(?:\..*)?|app\.db|plugins\.json|credentials(?:\..*)?|secrets(?:\..*)?)$/i.test(file))findings.push({file,rule:'private-config-file'});
    inspect(file,readFileSync(file,'utf8'));
  }
  let historyBlobs=0;
  if(process.argv.includes('--history')){
    const seen=new Set();
    for(const line of git(['rev-list','--objects','--all']).split('\n')){
      const [sha,...parts]=line.split(' ');if(!sha||seen.has(sha))continue;seen.add(sha);
      if(git(['cat-file','-t',sha]).trim()!=='blob')continue;
      historyBlobs++;inspect(`history:${sha.slice(0,12)}:${parts.join(' ')}`,git(['cat-file','blob',sha]));
    }
  }
  // Never print matched values, snippets, headers or credential fingerprints.
  console.log(JSON.stringify({ok:findings.length===0,files:files.length,historyBlobs,findings},null,2));
  if(findings.length)process.exitCode=1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch{console.error('Credential scan could not complete.');process.exitCode=2;}
}
