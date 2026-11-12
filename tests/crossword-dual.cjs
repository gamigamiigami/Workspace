const {chromium}=require('playwright'); const fs=require('fs'); const assert=require('node:assert/strict');
const path=require('node:path');
const fixtureCount=seed=>seed>=24?8:7;
function equivalentShape(a,b){
 const cells=words=>{const set=new Set();for(const w of words)Array.from(w.text).forEach((_,i)=>set.add([w.r+(w.dir==='down'?i:0),w.c+(w.dir==='across'?i:0)].join(',')));return [...set].map(k=>k.split(',').map(Number));};
 const normalize=points=>{const top=Math.min(...points.map(p=>p[0])),left=Math.min(...points.map(p=>p[1]));return points.map(([r,c])=>[r-top,c-left].join(',')).sort().join(';');};
 const original=cells(a),target=normalize(cells(b));
 return [false,true].some(swap=>[-1,1].some(x=>[-1,1].some(y=>normalize(original.map(([r,c])=>swap?[c*x,r*y]:[r*x,c*y]))===target)));
}
const html=fs.readFileSync(path.join(__dirname,'../projects/crossword/dual.html'),'utf8');
(async()=>{const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
for(let seed=1;seed<=49;seed++){
 const page=await browser.newPage({viewport:{width:768,height:1024}});page.on('pageerror',e=>{throw e});
 await page.route('http://localhost:8123/**',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('http://localhost:8123/');
 const result=await page.evaluate(async({seed,fixture})=>{
  let randomSeed=seed;Math.random=()=>{randomSeed^=randomSeed<<13;randomSeed^=randomSeed>>>17;randomSeed^=randomSeed<<5;return (randomSeed>>>0)/4294967296;};
  docA.words=['こまき','こども','おうじ'].map((text,i)=>({text,id:'a'+i}));docB.words=['こまき','のえる','おうじ'].map((text,i)=>({text,id:'b'+i}));docA.keyword='こまでおれ';docB.keyword='';
  dual.mode=3;dual.commonSame=false;dual.commonPlacement='free';dual.sameMark=true;dual.wordCount={mode:'max',n:7};
  if(seed===11){[docA.words,docB.words]=[docB.words,docA.words];[docA.keyword,docB.keyword]=[docB.keyword,docA.keyword];}
  if(seed===12)docB.keyword='こうきのう';
  if(seed===34||seed===35){docB.keyword=seed===34?'おんがえし':'ありがとう';dual.wordCount={mode:'max',n:8};}
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
  if(seed===33){
    docA.words=['あり','りす'].map((text,i)=>({text,id:'a'+i}));
    docB.words=['あり','りす'].map((text,i)=>({text,id:'b'+i}));
    docA.keyword=docB.keyword='あり';dual.mode=1;dual.commonSame=true;dual.wordCount={mode:'max',n:2};
  }
  if(fixture)applyBoth(fixture);
  const inputs={a:ownWords(docA).map(w=>w.text),b:ownWords(docB).map(w=>w.text),ka:docA.keyword,kb:docB.keyword};
  const start=Date.now();if(!fixture)await buildDualImpl();
  let beforeShape=null;
  if(seed===30){
    const base=[{r:0,c:0,text:'あ',dir:'across'},{r:0,c:1,text:'い',dir:'across'},{r:1,c:0,text:'う',dir:'across'}];
    const shape=dualShapeKey(base);
    for(const swap of [false,true])for(const flip of [-1,1])for(const turn of [-1,1]){
      const moved=base.map(p=>({...p,r:20+flip*(swap?p.c:p.r),c:20+turn*(swap?p.r:p.c),text:'か'}));
      if(dualShapeKey(moved)!==shape)throw Error('shape key depends on position, orientation or letters');
    }
    if(dualShapeKey(base.map((p,i)=>({...p,r:0,c:i})))===shape)throw Error('different occupied shapes considered equal');
  }
  if(seed===31||seed===32||seed===33||seed===36||seed===37||seed===38){
    beforeShape=structuredClone(docA.placed);const before=JSON.stringify(serializeBoth());
    document.querySelector(seed===31||seed===36||seed===38?'#btnDualMore':'#btnRegenerate').click();
    while(dualBuilding)await tick();
    if(seed===33){
      if(JSON.stringify(serializeBoth())!==before)throw Error('failed different-shape search mutated the project');
      const message=document.querySelector('#dualResult').textContent;
      if(!message.includes('別の形が見つかりません')||!message.includes('変更していません'))throw Error('same shape reported as successful replacement');
    }
  }
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
  if(seed===39){
    const saved=loadDualTemplates();if(!saved.length)throw Error('imported geometry not learned');
    const data=localStorage.getItem(DUAL_TEMPLATES_KEY);
    if(data.includes('こまき')||data.includes('こまでおれ')||data.includes('おんがえし'))throw Error('shape bank stored answer text');
    localStorage.setItem(DUAL_TEMPLATES_KEY,'invalid json');
    if(loadDualTemplates().length)throw Error('corrupt shape cache accepted');
    localStorage.setItem(DUAL_TEMPLATES_KEY,JSON.stringify([null,[],[[0,0,100000,'across']]]));
    if(loadDualTemplates().length)throw Error('invalid shape cache accepted');
    localStorage.setItem(DUAL_TEMPLATES_KEY,data);
  }
  if(seed===40){
    const backup=serializeBoth(),original=tryLayout,tried=new Set();
    try{
      docA.keyword='12345';docB.keyword='67890';docA.keywordAuto=docB.keywordAuto=false;dual.wordCount={mode:'range',n:3,max:8};
      tryLayout=(items,...args)=>{tried.add(items.length);return original(items,...args);};
      const by=new Map();dualDict(0).forEach(d=>{if(!by.has(d.len))by.set(d.len,[]);by.get(d.len).push(d);});
      await searchDualTemplates(by,0,wordCountBounds(),2000);
      for(let n=3;n<=8;n++)if(!tried.has(n))throw Error('allowed word count never searched: '+n);
    }finally{tryLayout=original;applyBoth(backup);}
  }
  if(seed===41){
    if(normalizeDualTemplate([[0,0,3,'across'],[5,0,3,'across']]))throw Error('disconnected shape accepted');
    if(normalizeDualTemplate([[0,0,3,'across'],[0,1,3,'across']]))throw Error('overlapping shape accepted');
    const neighbours=mutateDualTemplates(docA.placed);
    if(!neighbours.length||!neighbours.every(normalizeDualTemplate))throw Error('invalid branch mutations');
  }
  if(seed===42){
    const backup=serializeBoth(),original=tryLayout;let randomCalls=0;
    try{
      rememberDualTemplate([{r:0,c:0,text:'あいうえおか',dir:'across'},{r:0,c:2,text:'うきく',dir:'down'}]);
      [docA,docB].forEach((doc,side)=>{doc.words=['あいうえおか','うきく'].map((text,i)=>({id:'learned'+side+i,text}));doc.placed=[];doc.keyword='あう';doc.keywordAuto=false;doc.marks={};});
      dual.mode=3;dual.commonSame=true;dual.commonPlacement='same';dual.wordCount={mode:'exact',n:2};
      tryLayout=(...args)=>{randomCalls++;return original(...args);};
      await buildDualImpl();
      if(docA.placed.length!==2||randomCalls!==0)throw Error('learned custom geometry was not reused as an empty template');
      flowBoards.push([structuredClone(docA),structuredClone(docB)]);
    }finally{tryLayout=original;applyBoth(backup);}
  }
  if(seed===43){
    const input=document.querySelector('#dualNgInput');input.value='パンコ、ぱんこ\nﾌﾞﾝｺ';document.querySelector('#btnDualNgAdd').click();
    if(JSON.stringify(dual.ngWords)!==JSON.stringify(['ぱんこ','ぶんこ']))throw Error('NG input did not normalize/deduplicate kana');
    if(!isNgWord('ﾊﾟﾝｺ')||isNgWord('ぱんこや'))throw Error('NG matching is not exact normalized word matching');
    if(dualDict(0).some(d=>['ぱんこ','ぶんこ'].includes(toHira(d.text))))throw Error('NG dictionary word was offered');
    docA.favDict.push({text:'パンコ',meta:'パン粉'});if(dualDict(0).some(d=>toHira(d.text)==='ぱんこ'))throw Error('favourite bypassed NG');
    document.querySelector('[data-ng-remove="ぱんこ"]').click();
    if(isNgWord('パンコ')||!dualDict(0).some(d=>toHira(d.text)==='ぱんこ'))throw Error('removing NG did not restore candidate');
    addNgWords(['わきん']);const paired=docA.placed.map((p,i)=>({...p,text:pairOf(p.text,docB.placed[i].text)}));
    if(!validateHardDualConditions(paired,null).includes('NG'))throw Error('final validator accepted banned word');
  }
  if(seed===44||seed===45||seed===47||seed===48){
    if(seed===44)document.querySelector('[data-ng-word="わきん"]').click();
    else addNgWords(seed===45?['ワキン','インコ','パンコ']:seed===47?['いんこ','わきん']:['ワキン']);
    if(seed===47){docA.placed=[];docB.placed=[];await buildDualImpl();}
    else if(seed===48){beforeShape=structuredClone(docA.placed);document.querySelector('#btnDualMore').click();while(dualBuilding)await tick();}
    else{
      const shape=geometry();for(let attempt=0;attempt<(seed===45?2:1);attempt++)await refillDualShape();
      if(shape!==geometry())throw Error('NG refill changed geometry');
    }
    if([docA,docB].some(doc=>doc.placed.some(p=>isNgWord(p.text))))throw Error('generated/refilled board retained NG word');
  }
  if(seed===46){
    addNgWords(['コマキ']);const before=JSON.stringify(serializeBoth());
    await buildDualImpl();if(!document.querySelector('#dualResult').textContent.includes('NGと登録'))throw Error('NG-required conflict not reported');
    await refillDualShape();if(!document.querySelector('#dualRefillMsg').textContent.includes('NGと登録'))throw Error('NG-required refill conflict not reported');
    if(JSON.stringify(serializeBoth())!==before)throw Error('NG conflict discarded required words or modified board');
  }
  if(seed===49){
    addNgWords(['パンコ','ワキン']);const saved=serializeBothFile(),payload=editableSharePayload();
    dual.ngWords=[];applyBoth(saved);if(JSON.stringify(dual.ngWords)!==JSON.stringify(['ぱんこ','わきん']))throw Error('NG lost on file round trip');
    dual.ngWords=[];applyBoth(validateEditableShare(payload));if(!isNgWord('ﾊﾟﾝｺ'))throw Error('NG lost on editable sharing');
    document.querySelector('[data-ng-remove="ぱんこ"]').click();if(isNgWord('ぱんこ'))throw Error('NG removal failed');
    undo();if(!isNgWord('ぱんこ'))throw Error('NG undo failed');
    const old=serializeBothFile();delete old.dualOpts.ngWords;applyBoth(old);if(dual.ngWords.length)throw Error('old project inherited unrelated NG');
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
  return {beforeShape,keywordFlow,sameGeometry,inputB:document.querySelector('#keywordInputB').value,autoB:docB.keywordAuto,inputs,seed,ms:Date.now()-start,result:document.querySelector('#dualResult').textContent,a:a.placed,b:b.placed,ka:a.keyword,kb:b.keyword,marksA:a.marks,marksB:b.marks,readA:a.placed.length?check(a):'',readB:b.placed.length?check(b):'',realB:dualDict(0).some(d=>d.text===b.keyword)};
 },{seed,fixture:((seed>=24&&seed<=29)||(seed>=36&&seed<=39)||seed===41||seed>=43)?JSON.parse(fs.readFileSync(path.join(__dirname,seed===36?'fixtures/dual-return-favor-seven.json':(seed===27||seed===37||seed===39)?'fixtures/dual-return-favor.json':'fixtures/dual-thank-you.json'),'utf8')):null});
 console.log(JSON.stringify({seed,ms:result.ms,words:result.a.length,kb:result.kb}));
 if(seed===19){assert.equal(result.a.length,0);assert.equal(result.b.length,0);await page.close();continue;}
 if(seed===31||seed===32||seed===36||seed===37||seed===38||seed===48)assert(!equivalentShape(result.beforeShape,result.a),'different-shape button returned the same cell geometry');
 if(seed===20||seed===21||seed===23){assert.notEqual(result.keywordFlow[0],result.keywordFlow[1]);assert(result.autoB);}
 if(seed===21||seed===23){assert(result.sameGeometry);assert.equal(result.inputB,result.kb);}
 if(seed===22){assert.equal(result.keywordFlow[0],result.keywordFlow[1]);assert.equal(result.autoB,false);}
 assert(result.a.length>=(seed===33?2:3)&&result.a.length<=(fixtureCount(result.seed)),result.result);assert.equal(result.a.length,result.b.length);
 for(const w of result.inputs.a)assert(result.a.some(p=>p.text===w));for(const w of result.inputs.b)assert(result.b.some(p=>p.text===w));
 if(result.inputs.ka)assert.equal(result.ka,result.inputs.ka);if(result.inputs.kb)assert.equal(result.kb,result.inputs.kb);assert.equal(result.readA,result.ka);assert.equal(result.readB,result.kb);if(!result.inputs.kb)assert(result.realB);if(seed===14)assert.equal(result.a.length,7);
 if(seed===13)for(const text of ['こまき','おうじ']){const a=result.a.find(p=>p.text===text),b=result.b.find(p=>p.text===text);assert.notDeepEqual([a.r,a.c,a.dir],[b.r,b.c,b.dir]);}
 if(seed>=16&&seed<=18)for(const text of result.inputs.a){const a=result.a.find(p=>p.text===text),b=result.b.find(p=>p.text===text);assert.deepEqual([a.r,a.c,a.dir],[b.r,b.c,b.dir]);}assert.deepEqual(result.marksA,result.marksB);
 for(let i=0;i<result.a.length;i++){for(const k of ['r','c','dir'])assert.equal(result.a[i][k],result.b[i][k]);assert.equal(result.a[i].text.length,result.b[i].text.length)}
 if(seed===1&&process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
 await page.close();
}
await browser.close();})();
