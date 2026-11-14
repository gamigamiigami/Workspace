const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../projects/crossword/index.html'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(let seed=1;seed<=13;seed++){
  const page=await browser.newPage({viewport:{width:768,height:1024}});
  page.on('pageerror',e=>{throw e});
  await page.route('http://localhost:8123/**',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://localhost:8123/');
  const result=await page.evaluate(async seed=>{
   let random=seed;Math.random=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)/4294967296;};
   applyData({words:[{id:'a',text:'あり'},{id:'b',text:'りす',required:false},{id:'c',text:'すいか',required:false}],placed:[{id:'a',text:'あり',r:0,c:0,dir:'across'},{id:'b',text:'りす',r:0,c:1,dir:'down'},{id:'c',text:'すいか',r:1,c:1,dir:'across'}],keyword:'',wordCount:{mode:'exact',n:3}});
   const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
   const shape=()=>state.placed.map(p=>[p.r,p.c,p.dir,p.text.length]);
   const start=Date.now();
   if(seed===1){
    const input=document.querySelector('#normalNgInput');input.value='リス、りす\nｽｲｶ';document.querySelector('#btnNormalNgAdd').click();
    if(!same(state.ngWords,['りす','すいか'])||!isNgWord('ﾘｽ')||isNgWord('りすざる'))throw Error('NG normalization or exact matching failed');
    if(normalDictionary().some(d=>isNgWord(d.r)))throw Error('banned word in dictionary');
    state.favDict.push({text:'リス',meta:'栗鼠'});state.used.push({text:'りす',meta:'栗鼠'});
    document.querySelector('#findKw').checked=document.querySelector('#findCross').checked=false;
    document.querySelector('#findText').value='りす';findWords();
    if([...document.querySelectorAll('#findResult [data-text]')].some(e=>isNgWord(e.dataset.text)))throw Error('banned favourite/used word suggested');
    document.querySelector('[data-ng-remove="りす"]').click();if(isNgWord('リス')||!normalDictionary().some(d=>toHira(d.r)==='りす'))throw Error('NG removal did not restore word');
   }
   if(seed===2||seed===3){
    if(seed===2)document.querySelector('[data-ng-word="りす"]').click();else addNgWords(['リス','スイカ']);
    const before=shape();document.querySelector('#btnRefill').click();while(refillBusy)await tick();
    if(!same(shape(),before)||state.placed.some(p=>isNgWord(p.text))||!state.placed.some(p=>p.text==='あり'))throw Error('NG refill failed or changed shape/registration');
   }
   if(seed===4){
    addNgWords(['アリ']);const before=JSON.stringify(serialize());
    for(const action of [()=>autoBuild(),()=>buildWithRequired(),()=>collectWordsToFit(),()=>buildFromKeyword(),()=>runGenerateLegacy(),()=>refillCurrentShape()])await action();
    if(JSON.stringify(serialize())!==before||!document.querySelector('#refillMsg').textContent.includes('NGと登録'))throw Error('required conflict mutated project or missing message');
   }
   if(seed===5){
    addNgWords(['リス','スイカ']);const saved=serializeFile(),shared=editableSharePayload();
    state.ngWords=[];applyData(saved);if(!same(state.ngWords,['りす','すいか']))throw Error('file lost NG');
    state.ngWords=[];applyData(validateEditableShare(shared));if(!isNgWord('リス'))throw Error('editable share lost NG');
    document.querySelector('[data-ng-remove="りす"]').click();undo();if(!isNgWord('りす'))throw Error('undo lost NG');
    const legacy=serializeFile();delete legacy.ngWords;applyData(legacy);if(state.ngWords.length)throw Error('old file inherited NG');
   }
   if(seed===6){
    addNgWords(['りす']);confirmDiscard=async()=>true;await newWork();if(state.ngWords.length||state.words.length||state.placed.length)throw Error('new project inherited NG');
   }
   if(seed===7){
    addNgWords(['りす','すいか']);document.querySelector('#btnGenerate').click();while(normalBuilding)await tick();
    if(state.placed.length!==3||state.placed.some(p=>isNgWord(p.text))||!state.placed.some(p=>p.text==='あり'))throw Error('NG generation failed');
    document.querySelector('#btnRegenerate').click();while(normalBuilding)await tick();
    if(state.placed.some(p=>isNgWord(p.text)))throw Error('NG appeared on regenerate');
   }
   if(seed===8){
    applyData({words:[],placed:[],keyword:'さくら',ngWords:['さくら','りす'],wordCount:{mode:'none',n:3}});
    await autoBuild();if(!state.placed.length||state.placed.some(p=>isNgWord(p.text)))throw Error('keyword-only generation failed');
   }
   if(seed===9){
    applyData({words:[],placed:[],ngWords:['りす','あり'],maxSize:5});await autoBuild();
    if(!state.placed.length||state.placed.some(p=>isNgWord(p.text)))throw Error('size-only generation failed');
   }
   if(seed===10){
    addNgWords(['りす']);const before=JSON.stringify(serialize());
    if(!rejectNgResult(state.placed,document.querySelector('#genResult'))||JSON.stringify(serialize())!==before)throw Error('final NG guard failed');
    normalBuilding=true;renderRefillLocks();
    if(!document.querySelector('#normalNgInput').disabled||!document.querySelector('#btnNormalNgAdd').disabled||[...document.querySelectorAll('[data-ng-word],[data-ng-remove]')].some(b=>!b.disabled))throw Error('NG editing enabled during generation');
    normalBuilding=false;renderRefillLocks();
   }
   if(seed===11){
    state.words.find(w=>w.text==='りす').fixed=true;addNgWords(['りす']);
    const before=JSON.stringify(serialize());await refillCurrentShape();if(JSON.stringify(serialize())!==before||!ngRequiredConflict())throw Error('confirmed NG was silently dropped');
    state.words.find(w=>w.text==='りす').fixed=false;refresh();await refillCurrentShape();if(state.placed.some(p=>isNgWord(p.text)))throw Error('NG still present after unconfirming');
   }
   if(seed===12){
    applyData({words:[],placed:[],ngWords:['りす']});markSaved();if(hasUnsavedChanges())throw Error('fresh saved NG dirty');addNgWords(['すいか']);if(!hasUnsavedChanges())throw Error('NG-only edit not dirty');
   }
   const link=seed===13?(addNgWords(['リス','スイカ']),await makeEditableShareLink()):null;
   return{link,keyword:state.keyword,marks:state.marks,seed,ms:Date.now()-start,words:state.placed,required:state.words.filter(w=>w.required!==false||w.fixed).map(w=>w.text),ng:state.ngWords};
  },seed);
  if([2,3,7,8,9,11].includes(seed)){
   const cells=new Map(),owners=new Map();
   result.words.forEach((p,i)=>{assert(!result.ng.includes(p.text));[...p.text].forEach((ch,j)=>{const k=[p.r+(p.dir==='down'?j:0),p.c+(p.dir==='across'?j:0)].join(',');assert(!cells.has(k)||cells.get(k)===ch);cells.set(k,ch);if(!owners.has(k))owners.set(k,new Set());owners.get(k).add(i);});});
   for(const w of result.required)assert(result.words.some(p=>p.text===w));
   for(const[k,ids]of owners){const[r,c]=k.split(',').map(Number);for(const next of [[r+1,c],[r,c+1]].map(x=>x.join(',')))if(owners.has(next))assert([...ids].some(id=>owners.get(next).has(id)));}
   if(result.keyword)assert.equal(Object.entries(result.marks).sort((a,b)=>a[1].localeCompare(b[1])).map(([k])=>cells.get(k)).join(''),result.keyword);
   const reached=new Set([0]);for(let j=0;j<result.words.length;j++)for(const ids of owners.values())if([...ids].some(id=>reached.has(id)))for(const id of ids)reached.add(id);assert.equal(reached.size,result.words.length);
  }
  if(seed===13){
   await page.reload();await page.waitForFunction(()=>isNgWord('リス')&&isNgWord('スイカ'));
   await page.goto(result.link);await page.waitForFunction(()=>isNgWord('リス')&&isNgWord('スイカ')&&state.placed.length===3);
   assert.deepEqual(await page.evaluate(()=>state.ngWords),['りす','すいか']);
  }
  if(seed===1&&process.env.SCREENSHOT_PATH){await page.evaluate(()=>showTab('build'));await page.locator('#normalNgPanel').screenshot({path:process.env.SCREENSHOT_PATH});}
  console.log(JSON.stringify({seed,ms:result.ms,words:result.words.length}));await page.close();
 }
 await browser.close();
})();
