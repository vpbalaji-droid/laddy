const fs = require("fs");

// ---- Load app.js pure logic into a sandbox (strip the boot IIFE + SW) ----
let src = fs.readFileSync("app.js", "utf8").replace(/\(function boot\(\)[\s\S]*$/, "");

// browser stubs
function mockCtx(){const rec=()=>()=>{};return {scale:rec(),fillRect:rec(),strokeRect:rec(),fillText:rec(),beginPath:rec(),moveTo:rec(),arcTo:rec(),closePath:rec(),fill:rec(),stroke:rec(),createLinearGradient:()=>({addColorStop:rec()}),measureText:t=>({width:(t||"").length*9}),set fillStyle(v){},set font(v){},set textBaseline(v){},set textAlign(v){},set strokeStyle(v){},set lineWidth(v){}};}
let lastCv;
const stubEl=(tag)=>{if(tag==="canvas"){lastCv={width:0,height:0,getContext:()=>mockCtx(),toBlob:cb=>cb({size:1,type:"image/png"})};return lastCv;}return {style:{},set onclick(v){},set onchange(v){},set oninput(v){},set onkeydown(v){},set onload(v){},click(){},focus(){},appendChild(){},remove(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},contentWindow:{document:{open(){},write(){},close(){}},focus(){},print(){}}};};
const _ls={};
global.document={createElement:stubEl,getElementById:()=>stubEl(),querySelector:()=>null,querySelectorAll:()=>[],body:{appendChild(){},classList:{add(){}}}};
global.localStorage={getItem:k=>_ls[k]??null,setItem:(k,v)=>{_ls[k]=v;},removeItem:k=>{delete _ls[k];}};
global.navigator={}; global.window={};

const X = new Function(src + "\n;return this;").call({
  // expose what we test
});
// Re-eval to capture symbols (Function scope) — use a return manifest
const M = new Function(src + `
;return {SCHEDULES,GROUP_LABELS,parseNames,computeTotals,rankings,num,scheduleFor,sittersFor,
  buildGroupsFromAssign,courtCounts,unassignedPlayers,pruneAssign,assignValidity,autoFill,
  playersKey,assignKey,buildPayload,buildResultsImage,printableHtml,state};`)();

// ---- tiny assert harness ----
let pass=0, fail=0; const fails=[];
function eq(name, got, want){ const g=JSON.stringify(got),w=JSON.stringify(want);
  if(g===w){pass++;} else {fail++; fails.push(`${name}\n   got:  ${g}\n   want: ${w}`);} }
function ok(name, cond){ if(cond){pass++;} else {fail++; fails.push(name);} }

const S = M.state;
function reset(players, courts, assign){ S.players=players; S.courts=courts; S.assign=assign||{}; S.groups=null; S.title="T"; S.date="Jun 27, 2026"; }

/* ===== 1. SCHEDULES: balanced, valid ===== */
for(const n of [4,5,6]){
  const sch=M.SCHEDULES[n]; const appear={};
  let valid=true;
  sch.forEach(g=>{ if(new Set(g).size!==4)valid=false; g.forEach(s=>{if(s<1||s>n)valid=false; appear[s]=(appear[s]||0)+1;});});
  ok(`schedule n=${n} valid`, valid);
  const counts=Array.from({length:n},(_,i)=>appear[i+1]||0);
  ok(`schedule n=${n} balanced (${counts})`, new Set(counts).size===1);
}
eq("schedule game counts", [M.SCHEDULES[4].length,M.SCHEDULES[5].length,M.SCHEDULES[6].length], [3,5,6]);

/* ===== 2. parseNames ===== */
const oneLine="Confirmed Attendees: 1. Gaurav 2. Jordan Hart 3. Pari Sundarkanth 4. Pradeep 5. Ganesh 6. Balaji Purushothaman 7. Baljinder 8. Alagirisingam 9. Rajesh 10. Giri 11. Bhairav 12. Visu 13. Manish Reddy 14. Ronak 15. Ted 16. Alex 17. Kasi 18. Ashes";
const parsed=M.parseNames(oneLine);
eq("parse single-line count", parsed.length, 18);
eq("parse name[7] trimmed", parsed[7], "Alagirisingam");
eq("parse dedup re-paste", M.parseNames(oneLine, parsed).length, 0);
eq("parse comma fmt", M.parseNames("Tom, Dick , Harry"), ["Tom","Dick","Harry"]);

/* ===== 3. scoring + rankings ===== */
reset([{id:"a",name:"Gaurav"},{id:"b",name:"P2"},{id:"c",name:"P3"},{id:"d",name:"P4"}],1,{a:0,b:0,c:0,d:0});
M.buildGroupsFromAssign();
S.groups[0].scores={0:{A:21,B:15},1:{A:18,B:21},2:{A:21,B:10}};
const tot=M.computeTotals(S.groups[0]);
eq("totals [P1..P4]", tot, [60,52,57,43]);
eq("rankings", M.rankings(tot), [1,3,2,4]);
eq("ranking ties share", M.rankings([30,30,20,10]), [1,1,3,4]);
eq("num blank->0", M.num(""), 0);
eq("num parse", M.num("21"), 21);

/* ===== 4. group sizing / validity ===== */
function names(k){return Array.from({length:k},(_,i)=>({id:"p"+i,name:"P"+i}));}
function even(k,courts){const a={};for(let i=0;i<k;i++)a["p"+i]=i%courts;return a;}
reset(names(12),3,even(12,3)); M.buildGroupsFromAssign();
eq("12/3 court sizes", M.courtCounts(), [4,4,4]);
ok("12/3 valid", M.assignValidity().ok);
reset(names(18),3,even(18,3));
eq("18/3 court sizes", M.courtCounts(), [6,6,6]);
reset(names(7),1,even(7,1));
ok("7 on 1 court invalid (>6)", !M.assignValidity().ok);
reset(names(3),1,even(3,1));
ok("3 players invalid (<4)", !M.assignValidity().ok);
reset(names(10),3,{}); // none assigned
ok("unassigned invalid", !M.assignValidity().ok);

/* ===== 5. court count + prune (the bug we just fixed) ===== */
reset(names(3),1,{p0:0,p1:0,p2:0, z9:0,z8:0,z7:0,z6:0,z5:0,z4:0}); // 6 orphans
eq("courtCounts ignores orphans", M.courtCounts(), [3]);
eq("unassigned ignores orphans", M.unassignedPlayers().length, 0);
M.pruneAssign();
eq("pruneAssign removes orphans", Object.keys(S.assign).sort(), ["p0","p1","p2"]);

/* ===== 6. autoFill spreads evenly ===== */
reset(names(11),3,{}); M.autoFill();
eq("autoFill 11/3 spread", M.courtCounts(), [4,4,3]);

/* ===== 7. sync change-detect: order-insensitive ===== */
eq("assignKey order-insensitive", M.assignKey({a:0,b:1})===M.assignKey({b:1,a:0}), true);
ok("assignKey detects real change", M.assignKey({a:0})!==M.assignKey({a:1}));
ok("playersKey stable", M.playersKey([{id:"a",name:"X"}])===M.playersKey([{id:"a",name:"X"}]));

/* ===== 8. buildGroupsFromAssign preserves scores on identical lineup ===== */
reset(names(8),2,even(8,2)); M.buildGroupsFromAssign();
S.groups[0].scores={0:{A:21,B:9}};
M.buildGroupsFromAssign();
eq("scores preserved on identical rebuild", S.groups[0].scores, {0:{A:21,B:9}});

/* ===== 9. payload + image + pdf generate ===== */
reset(names(12),2,even(12,2)); M.buildGroupsFromAssign();
S.groups.forEach(g=>{g.scores={0:{A:21,B:15},1:{A:18,B:21},2:{A:21,B:10}};});
const pay=M.buildPayload();
eq("payload group count", pay.groups.length, 2);
ok("payload has games+players", pay.groups[0].games.length>0 && pay.groups[0].players.length===6);
const pdf=M.printableHtml(pay);
ok("pdf has color-adjust", /print-color-adjust: exact/.test(pdf));
ok("pdf has medals", pdf.includes("🏆"));
let imgErr=null;
M.buildResultsImage().then(b=>{ ok("image blob generated", !!b); finish(); })
  .catch(e=>{ imgErr=e; ok("image generation", false); finish(); });

function finish(){
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if(fails.length){ console.log("\nFAILURES:"); fails.forEach(f=>console.log(" ✗ "+f)); }
  console.log("=".repeat(50));
  process.exit(fail?1:0);
}
