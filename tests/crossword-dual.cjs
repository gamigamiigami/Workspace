const {chromium}=require('playwright'); const fs=require('fs'); const assert=require('node:assert/strict');
const path=require('node:path');
const fixtureCount=seed=>seed>=24?8:7;
const html=fs.readFileSync(path.join(__dirname,'../projects/crossword/dual.html'),'utf8');
(async()=>{const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
for(let seed=1;seed<=29;seed++){
 const page=await browser.newPage({viewport:{width:768,height:1024}});page.on('pageerror',e=>{throw e});
 await page.route('http://localhost:8123/**',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('http://localhost:8123/');
 const result=await page.evaluate(async({seed,fixture})=>{
  let randomSeed=seed;Math.random=()=>{randomSeed^=randomSeed<<13;randomSeed^=randomSeed>>>17;randomSeed^=randomSeed<<5;return (randomSeed>>>0)/4294967296;};
  docA.words=['こまき','こども','おうじ'].map((text,i)=>({text,id:'a'+i}));docB.words=['こまき','のえる','おうじ'].map((text,i)=>({text,id:'b'+i}));docA.keyword='こまでおれ';docB.keyword='';
  dual.mode=3;dual.commonSame=false;dual.commonPlacement='free';dual.sameMark=true;dual.wordCount={mode:'max',n:7};
  if(seed===11){[docA.words,docB.words]=[docB.words,docA.words];[docA.keyword,docB.keyword]=[docB.keyword,docA.keyword];}
  if(seed===12)docB.keyword='こうきのう';
  if(seed===13){dual.commonPlacement='different';dual.commonDifferent='all';}
  if(seed===14)dual.wordCount={mode:'exact',n:7};
  if(seed===15)docA.maxSize=docB.maxSize=7;
  if(seed>=16&&seed<=18){
    docA.words=['さくら','からす','すいか'].map((text,i)=>({text,id:'a'+i}));
    docB.words=['さくら','からす','すいか'].map((text,i)=>({text,id:'b'+i}));
    docA.keyword=docB.keyword='さくら';dual.commonSame=true;
    if(seed===17)dual.mode=1;if(seed===18)dual.mode=2;
  }
  if(seed===19)dual.wordCount={mode:'max',n:2};
  if(fixture)applyBoth(fixture);
  const inputs={a:ownWords(docA).map(w=>w.text),b:ownWords(docB).map(w=>w.text),ka:docA.keyword,kb:docB.keyword};
  const start=Date.now();if(!fixture)await buildDualImpl();
  const geometry=()=>JSON.stringify(docA.placed.map(p=>[p.r,p.c,p.dir,p.text.length]));
  const keywordFlow=[docB.keyword],flowBoards=[];
  let sameGeometry=true;
  if(seed===20){
    await buildDualImpl();keywordFlow.push(docB.keyword);
    flowBoards.push([structuredClone(docA),structuredClone(docB)]);
  }
  if(seed===21){
    docA.keyword='こま';inputs.ka='こま';docB.keyword='こう';docB.keywordAuto=true;applyDualMarks();
    keywordFlow[0]='こう';
  }
  if(seed===23){
    // A known generated shape with multiple feasible five-letter keywords.
    // The initial keyword is free, while all six registered words stay required.
    const slots=[[2,0,'across'],[2,2,'down'],[4,1,'across'],[1,0,'down'],[0,3,'down'],[0,3,'across'],[0,5,'down']];
    const boards=[['あわゆき','ゆどうふ','おうじ','であい','こまき','こども','もれ'],['まけこし','こごえる','のえる','こまき','おとし','おうじ','じこ']];
    [docA,docB].forEach((doc,s)=>{
      doc.placed=boards[s].map((text,i)=>({id:'fixture'+s+i,text,r:slots[i][0],c:slots[i][1],dir:slots[i][2]}));
      doc.words=doc.words.filter(w=>!w.auto);
      for(const text of boards[s])if(!doc.words.some(w=>w.text===text))doc.words.push({id:text,text,auto:true});
    });
    docB.keyword='おとこのこ';docB.keywordAuto=true;applyDualMarks();keywordFlow[0]=docB.keyword;
  }
  if(seed===21||seed===23){
    const shape=geometry();await refillDualShape();sameGeometry=shape===geometry();keywordFlow.push(docB.keyword);
  }
  if(seed===22){
    const input=document.querySelector('[data-fixed-keyword="B"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
    inputs.kb=docB.keyword;await buildDualImpl();keywordFlow.push(docB.keyword);
  }
  if(seed===24||seed===25||seed===27){
    if(seed===25)docA.words.find(w=>w.text==='わきん').fixed=true;
    const shape=geometry(),seen=new Set([JSON.stringify([docA.placed.map(p=>p.text),docB.placed.map(p=>p.text)])]);
    for(let attempt=0;attempt<(seed===25?1:3);attempt++){
      await refillDualShape();
      const signature=JSON.stringify([docA.placed.map(p=>p.text),docB.placed.map(p=>p.text)]);
      if(seen.has(signature))throw Error('repeated or unchanged fixed-keyword refill');seen.add(signature);
      if(shape!==geometry())throw Error('refill changed shape');
      if(docA.keyword!=='こまでおれ'||docB.keyword!==fixture.B.keyword)throw Error('fixed keywords changed');
      if(seed===25&&!docA.placed.some(p=>p.text==='わきん'))throw Error('confirmed helper removed');
      flowBoards.push([structuredClone(docA),structuredClone(docB)]);
    }
  }
  if(seed===26){
    const dictionary=dualDict(0),by=new Map();dictionary.forEach(d=>{if(!by.has(d.len))by.set(d.len,[]);by.get(d.len).push(d);});
    const boards=[docA.placed.map(p=>p.text),docB.placed.map(p=>p.text)];
    const found=await searchDualTemplates(by,0,wordCountBounds(),3000,null,{slots:docA.placed,rejectBoards:new Set([JSON.stringify(boards)]),preferredBoards:boards});
    if(!found)throw Error('joint solver missed fixed-keyword alternative');
    if(JSON.stringify(found.res.placed.map(p=>pairA(p.text)))===JSON.stringify(boards[0])&&JSON.stringify(found.res.placed.map(p=>pairB(p.text)))===JSON.stringify(boards[1]))throw Error('joint solver repeated original');
    if(found.plan.a!=='こまでおれ'||found.plan.b!=='ありがとう')throw Error('joint solver changed fixed keywords');
  }
  if(seed===28||seed===29){
    const slot=docA.placed.findIndex(p=>p.text==='いんこ');
    docA.placed[slot].text='ぶんこ';docA.words=docA.words.filter(w=>w.text!=='いんこ');docA.words.push({id:'bunko',text:'ぶんこ',auto:true});
    if(seed===29){
      docA.placed.find(p=>p.text==='わきん').text='れきし';
      docA.words=docA.words.filter(w=>w.text!=='わきん');docA.words.push({id:'rekishi',text:'れきし',auto:true});
    }
    [docA,docB].forEach(doc=>doc.words.forEach(w=>{if(w.auto&&w.text!=='ぶんこ')w.fixed=true;}));
    const boards=[docA.placed.map(p=>p.text),docB.placed.map(p=>p.text)];
    const diversity=refillDiversity('full-history-'+seed,boards);
    const validAlternatives=['ぱんこ','いんこ','はんこ','めんこ','どんこ'];
    for(const text of validAlternatives){const past=boards.map(list=>list.slice());past[0][slot]=text;diversity.remember(past);diversity.signatures.add(JSON.stringify(past));}
    const candidate=await findLocalDualRefill(docA.placed,docB.placed,diversity,3000);
    if(!candidate||!validAlternatives.includes(candidate.a[slot]))throw Error('history hid a valid word replacement');
    if(seed===29&&!candidate.a.includes('れきし'))throw Error('unrelated confirmed replacement changed');
    const simulated=[docA,docB].map((doc,side)=>({...structuredClone(doc),placed:doc.placed.map((p,i)=>({...p,text:(side?candidate.b:candidate.a)[i]})),marks:candidate.marks[side]}));
    flowBoards.push(simulated);
  }
  const a=structuredClone(docA),b=structuredClone(docB);
  // Independent geometry checks, without the production completion validator.
  const check=doc=>{
    const cells=new Map(),edges=[];const placed=doc.placed;
    for(let i=0;i<placed.length;i++){
      const p=placed[i];Array.from(p.text).forEach((ch,j)=>{
        const r=p.r+(p.dir==='down'?j:0),c=p.c+(p.dir==='across'?j:0),k=r+','+c;
        if(cells.has(k)&&cells.get(k).ch!==ch)throw Error('crossing mismatch');
        if(!cells.has(k))cells.set(k,{ch,words:[]});cells.get(k).words.push(i);
      });
    }
    for(const [k,cell] of cells){
      const [r,c]=k.split(',').map(Number);
      for(const next of [(r+1)+','+c,r+','+(c+1)])if(cells.has(next)&&!cell.words.some(i=>cells.get(next).words.includes(i)))throw Error('unintended adjacency');
      for(const i of cell.words)for(const j of cell.words)if(i!==j)edges.push([i,j]);
    }
    const reached=new Set([0]);for(let n=0;n<placed.length;n++)for(const [i,j]of edges)if(reached.has(i))reached.add(j);
    if(reached.size!==placed.length)throw Error('disconnected');
    return Object.entries(doc.marks).sort((x,y)=>x[1].localeCompare(y[1])).map(([k])=>cells.get(k)?.ch).join('');
  };
  for(const boards of flowBoards)for(const doc of boards)if(check(doc)!==doc.keyword)throw Error('intermediate keyword mismatch');
  return {keywordFlow,sameGeometry,inputB:document.querySelector('#keywordInputB').value,autoB:docB.keywordAuto,inputs,seed,ms:Date.now()-start,result:document.querySelector('#dualResult').textContent,a:a.placed,b:b.placed,ka:a.keyword,kb:b.keyword,marksA:a.marks,marksB:b.marks,readA:a.placed.length?check(a):'',readB:b.placed.length?check(b):'',realB:dualDict(0).some(d=>d.text===b.keyword)};
 },{seed,fixture:seed>=24?JSON.parse(fs.readFileSync(path.join(__dirname,seed===27?'fixtures/dual-return-favor.json':'fixtures/dual-thank-you.json'),'utf8')):null});
 console.log(JSON.stringify({seed,ms:result.ms,words:result.a.length,kb:result.kb}));
 if(seed===19){assert.equal(result.a.length,0);assert.equal(result.b.length,0);await page.close();continue;}
 if(seed===20||seed===21||seed===23){assert.notEqual(result.keywordFlow[0],result.keywordFlow[1]);assert(result.autoB);}
 if(seed===21||seed===23){assert(result.sameGeometry);assert.equal(result.inputB,result.kb);}
 if(seed===22){assert.equal(result.keywordFlow[0],result.keywordFlow[1]);assert.equal(result.autoB,false);}
 assert(result.a.length>=3&&result.a.length<=(fixtureCount(result.seed)),result.result);assert.equal(result.a.length,result.b.length);
 for(const w of result.inputs.a)assert(result.a.some(p=>p.text===w));for(const w of result.inputs.b)assert(result.b.some(p=>p.text===w));
 if(result.inputs.ka)assert.equal(result.ka,result.inputs.ka);if(result.inputs.kb)assert.equal(result.kb,result.inputs.kb);assert.equal(result.readA,result.ka);assert.equal(result.readB,result.kb);if(!result.inputs.kb)assert(result.realB);if(seed===14)assert.equal(result.a.length,7);
 if(seed===13)for(const text of ['こまき','おうじ']){const a=result.a.find(p=>p.text===text),b=result.b.find(p=>p.text===text);assert.notDeepEqual([a.r,a.c,a.dir],[b.r,b.c,b.dir]);}
 if(seed>=16&&seed<=18)for(const text of result.inputs.a){const a=result.a.find(p=>p.text===text),b=result.b.find(p=>p.text===text);assert.deepEqual([a.r,a.c,a.dir],[b.r,b.c,b.dir]);}assert.deepEqual(result.marksA,result.marksB);
 for(let i=0;i<result.a.length;i++){for(const k of ['r','c','dir'])assert.equal(result.a[i][k],result.b[i][k]);assert.equal(result.a[i].text.length,result.b[i].text.length)}
 if(seed===1&&process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
 await page.close();
}
await browser.close();})();
