(() => {
  'use strict';
  const canvas = document.getElementById('cityCanvas');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('canvasWrap');
  const cols = 18, rows = 15, tileW = 54, tileH = 28;
  const costs = { road: 80, house: 450, shop: 700, park: 500, clinic: 1200, school: 1500 };
  const capPer = { house: 12 };
  const jobPer = { shop: 10, clinic: 8, school: 12 };
  const buildings = {
    house: { name: 'Rumah', emoji: '🏠' }, shop: { name: 'Toko', emoji: '🏪' },
    park: { name: 'Taman', emoji: '🌳' }, clinic: { name: 'Klinik', emoji: '🏥' },
    school: { name: 'Sekolah', emoji: '🏫' }
  };
  const tips = [
    'Rumah yang berdekatan dengan jalan akan menarik lebih banyak warga.',
    'Toko menciptakan lapangan kerja dan menambah pemasukan harian kota.',
    'Taman membuat warga lebih bahagia. Kota hijau adalah kota yang sehat!',
    'Klinik dan sekolah membantu menjaga kualitas hidup warga seiring kota membesar.',
    'Klik petak kosong di dekat jalan untuk mulai membangun.'
  ];
  let city = { name: 'Desa Harmoni', cash: 12000, population: 12, happiness: 76, day: 1, paused: false, zoom: 1, missionDone: false, intro: true, sound: true, tip: 0, tiles: [] };
  let hover = null, activeTool = 'inspect', toastTimer, lastTick = Date.now(), canvasW = 0, canvasH = 0, scale = 1, ox = 0, oy = 0, dpr = 1;
  const get = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('id-ID');
  const popCount = () => city.tiles.filter(t => t.type === 'house').length;
  const count = type => city.tiles.filter(t => t.type === type).length;
  const cap = () => Math.max(12, popCount() * 12);
  const jobs = () => 8 + city.tiles.reduce((n, t) => n + (jobPer[t.type] || 0), 0);
  const income = () => 35 + city.population * 7 + count('shop') * 48;
  const expense = () => 35 + count('clinic') * 32 + count('school') * 24 + count('park') * 4;
  const happiness = () => Math.max(20, Math.min(100, 68 + count('park') * 8 + count('clinic') * 5 + count('school') * 4 - Math.max(0, city.population - jobs()) * 1.2));
  const newTile = (x, y, type) => ({ x, y, type });

  function seedCity() {
    city.tiles = [];
    for (let x = 4; x <= 13; x++) city.tiles.push(newTile(x, 8, 'road'));
    for (let y = 4; y <= 11; y++) if (y !== 8) city.tiles.push(newTile(9, y, 'road'));
    city.tiles.push(newTile(7, 7, 'house'), newTile(10, 7, 'house'));
    city.tiles.push(newTile(6, 9, 'park'));
  }
  seedCity();
  function save() {
    try { localStorage.setItem('kota-kita-save', JSON.stringify(city)); } catch (_) { /* storage may be unavailable */ }
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem('kota-kita-save'));
      if (saved && Array.isArray(saved.tiles) && saved.tiles.length) city = { ...city, ...saved };
    } catch (_) { /* start fresh */ }
    if (!Array.isArray(city.tiles)) seedCity();
  }
  load();
  function resize() {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasW = rect.width; canvasH = rect.height;
    canvas.width = Math.round(canvasW * dpr); canvas.height = Math.round(canvasH * dpr);
    canvas.style.width = `${canvasW}px`; canvas.style.height = `${canvasH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = Math.min((canvasW - 20) / ((cols + rows) * tileW / 2), (canvasH - 10) / ((cols + rows) * tileH / 2 + 72));
    scale = Math.max(.54, Math.min(1.38, fit * city.zoom));
    const tw = tileW * scale, th = tileH * scale;
    ox = (canvasW - (cols + rows) * tw / 2) / 2 + rows * tw / 2;
    oy = Math.max(14, (canvasH - (cols + rows) * th / 2) / 2 + 4);
    get('zoomLabel').textContent = `${Math.round(city.zoom * 100)}%`;
    draw();
  }
  const hash = (x, y) => (Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
  function polygon(points, fill, stroke, lineWidth = 1) {
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }
  function tileCenter(x, y) { const tw = tileW * scale, th = tileH * scale; return [ox + (x - y) * tw / 2, oy + (x + y) * th / 2]; }
  function drawGround(x, y) {
    const [cx, cy] = tileCenter(x, y), tw = tileW * scale, th = tileH * scale;
    const v = Math.abs(hash(x, y));
    const greens = ['#9fc89c', '#9bc497', '#a5cb9e', '#97be92'];
    polygon([[cx, cy], [cx + tw/2, cy + th/2], [cx, cy + th], [cx - tw/2, cy + th/2]], greens[Math.floor(v * greens.length)], '#6d9c7d55', .7);
    if (v > .78) {
      ctx.fillStyle = '#d7df9d88'; ctx.beginPath(); ctx.ellipse(cx + (hash(x+2,y)*13-5)*scale, cy+th*.52, 1.8*scale, .8*scale, -.4, 0, Math.PI*2); ctx.fill();
    }
  }
  function drawTree(x, y, variant = 0) {
    const [cx, cy] = tileCenter(x, y), s = scale * (variant ? .8 : 1);
    const baseY = cy + tileH * scale * .53;
    ctx.fillStyle = '#456f52'; ctx.fillRect(cx - 2*s, baseY - 5*s, 4*s, 7*s);
    const shade = variant % 2 ? '#57936a' : '#4d8b63';
    ctx.fillStyle = '#3e7456'; ctx.beginPath(); ctx.arc(cx + 1*s, baseY - 13*s, 8*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = shade; ctx.beginPath(); ctx.arc(cx - 3*s, baseY - 15*s, 7*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#79ad70'; ctx.beginPath(); ctx.arc(cx + 2*s, baseY - 19*s, 4*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffffff22'; ctx.beginPath(); ctx.arc(cx - 4*s, baseY - 16*s, 2*s, 0, Math.PI*2); ctx.fill();
  }
  function drawRoad(x, y) {
    const [cx, cy] = tileCenter(x, y), tw = tileW*scale, th = tileH*scale;
    polygon([[cx,cy],[cx+tw/2,cy+th/2],[cx,cy+th],[cx-tw/2,cy+th/2]], '#697675', '#83918b', .8);
    polygon([[cx,cy+th*.09],[cx+tw*.38,cy+th/2],[cx,cy+th*.91],[cx-tw*.38,cy+th/2]], '#687472');
    const ns = [[x,y-1],[x+1,y],[x,y+1],[x-1,y]].filter(([a,b]) => city.tiles.some(t => t.x===a && t.y===b && t.type==='road'));
    // subtle dashed center markings follow connected road direction
    ctx.save(); ctx.strokeStyle='#e7d89a99';ctx.lineWidth=Math.max(.7,scale);ctx.setLineDash([3*scale,4*scale]);
    if (ns.some(([a,b])=>a!==x)) {ctx.beginPath();ctx.moveTo(cx-tw*.27,cy+th*.5);ctx.lineTo(cx+tw*.27,cy+th*.5);ctx.stroke();}
    if (ns.some(([a,b])=>b!==y)) {ctx.beginPath();ctx.moveTo(cx,cy+th*.22);ctx.lineTo(cx,cy+th*.78);ctx.stroke();}
    ctx.restore();
  }
  function drawHouse(cx, cy, kind='house') {
    const s=scale, base=cy+tileH*s*.49, w=29*s, d=17*s;
    const wall=kind==='house'?'#ead9b5':kind==='shop'?'#e7d1a2':kind==='clinic'?'#e6e5d6':'#e3d8b5';
    // soft footprint
    ctx.fillStyle='#324a3a33';ctx.beginPath();ctx.ellipse(cx,base+2*s,20*s,6*s,0,0,Math.PI*2);ctx.fill();
    polygon([[cx-w/2,base-d/2],[cx,base],[cx,base+17*s],[cx-w/2,base+8*s]],kind==='shop'?'#b66d50':'#ad9d7c');
    polygon([[cx,base],[cx+w/2,base-d/2],[cx+w/2,base+8*s],[cx,base+17*s]],kind==='shop'?'#cf8764':'#c6b692');
    const roof=kind==='shop'?'#d47559':kind==='clinic'?'#c9635c':kind==='school'?'#bd795d':'#bf765a';
    polygon([[cx-w/2,base-d/2],[cx,base-d/2-13*s],[cx+w/2,base-d/2],[cx,base+1*s]],roof,'#8e5c4c',.7*s);
    polygon([[cx-w/2,base-d/2],[cx,base+1*s],[cx,base-d/2+5*s],[cx-w/2+4*s,base-d/2-4*s]],'#df9a75aa');
    ctx.fillStyle='#6d9b9d';
    for (let i=0;i<2;i++) {ctx.fillRect(cx-w*.33+i*9*s,base+1*s,4*s,5*s);ctx.fillRect(cx+5*s+i*7*s,base+2*s,4*s,5*s);}
    ctx.fillStyle='#735b46';ctx.fillRect(cx-2*s,base+8*s,5*s,9*s);
    if (kind==='clinic') {ctx.fillStyle='#fff';ctx.fillRect(cx-2*s,base-d/2-10*s,4*s,9*s);ctx.fillRect(cx-5*s,base-d/2-7*s,10*s,3*s);}
    if (kind==='school') {ctx.fillStyle='#e9cf79';ctx.beginPath();ctx.moveTo(cx,base-d/2-21*s);ctx.lineTo(cx+7*s,base-d/2-16*s);ctx.lineTo(cx,base-d/2-12*s);ctx.closePath();ctx.fill();}
    if (kind==='shop') {ctx.fillStyle='#f1d98c';ctx.fillRect(cx-w*.45,base-d/2+4*s,w*.9,4*s);ctx.fillStyle='#765a49';ctx.fillRect(cx-5*s,base+5*s,10*s,5*s);}
  }
  function drawPark(cx,cy) {
    const s=scale, base=cy+tileH*s*.48;
    polygon([[cx-12*s,base-3*s],[cx,base-10*s],[cx+13*s,base-3*s],[cx,base+4*s]],'#79b676','#6c9d6c',.7);
    drawTreeAt(cx-2*s,base-5*s,.65); drawTreeAt(cx+7*s,base-2*s,.52);
    ctx.strokeStyle='#e2d39a';ctx.lineWidth=2*s;ctx.beginPath();ctx.moveTo(cx-9*s,base+1*s);ctx.lineTo(cx-3*s,base-1*s);ctx.stroke();
  }
  function drawTreeAt(cx, base, size) {
    const s=scale*size;
    ctx.fillStyle='#795e43';ctx.fillRect(cx-1.6*s,base-7*s,3.2*s,8*s);
    ctx.fillStyle='#40845b';ctx.beginPath();ctx.arc(cx,base-10*s,6*s,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#6eaa6c';ctx.beginPath();ctx.arc(cx-2*s,base-13*s,4*s,0,Math.PI*2);ctx.fill();
  }
  function drawTileBuilding(tile) {
    const [cx, cy] = tileCenter(tile.x,tile.y);
    if (tile.type==='road') drawRoad(tile.x,tile.y);
    else if (tile.type==='park') drawPark(cx,cy);
    else drawHouse(cx,cy,tile.type);
  }
  function draw() {
    if (!canvasW || !canvasH) return;
    ctx.clearRect(0,0,canvasW,canvasH);
    // distant soft hills and atmospheric details
    const bg=ctx.createLinearGradient(0,0,0,canvasH);bg.addColorStop(0,'#a9cbb9');bg.addColorStop(.55,'#99c194');bg.addColorStop(1,'#82ad7e');ctx.fillStyle=bg;ctx.fillRect(0,0,canvasW,canvasH);
    ctx.fillStyle='#d5e0bb45';ctx.beginPath();ctx.ellipse(canvasW*.18,canvasH*.15,canvasW*.3,canvasH*.16,0,0,Math.PI*2);ctx.fill();
    const occupied=new Set(city.tiles.map(t=>`${t.x},${t.y}`));
    // grass first, then small decorative trees around the outskirts
    for(let d=0;d<cols+rows-1;d++) for(let x=0;x<cols;x++){const y=d-x;if(y>=0&&y<rows)drawGround(x,y);}
    for(let x=0;x<cols;x++)for(let y=0;y<rows;y++){
      const v=Math.abs(hash(x+10,y-12));
      if(!occupied.has(`${x},${y}`)&&v>.90&&(x<4||x>13||y<3||y>11))drawTree(x,y,Math.floor(v*4));
      if(!occupied.has(`${x},${y}`)&&v>.965&&x>2&&x<15&&y>2&&y<12)drawTree(x,y,1);
    }
    for(let d=0;d<cols+rows-1;d++) for(let x=0;x<cols;x++){
      const y=d-x;if(y<0||y>=rows)continue;
      const tile=city.tiles.find(t=>t.x===x&&t.y===y);if(tile)drawTileBuilding(tile);
    }
    // hover outline / placement preview
    if(hover && inside(hover.x,hover.y)) {
      const [cx,cy]=tileCenter(hover.x,hover.y),tw=tileW*scale,th=tileH*scale;
      const existing=city.tiles.find(t=>t.x===hover.x&&t.y===hover.y);
      const valid=activeTool==='inspect'?!!existing:(activeTool==='bulldoze'?!!existing:!existing&&(activeTool==='road'||nearRoad(hover.x,hover.y)));
      const color=valid?'#fff3a7':'#f28172';
      polygon([[cx,cy],[cx+tw/2,cy+th/2],[cx,cy+th],[cx-tw/2,cy+th/2]],valid?'#fff8b322':'#ff655322',color,1.5);
      if(!existing&&activeTool!=='inspect'&&activeTool!=='bulldoze'){
        ctx.save();ctx.globalAlpha=.48;
        if(activeTool==='road')drawRoad(hover.x,hover.y);else if(activeTool==='park')drawPark(cx,cy);else if(activeTool==='house'||activeTool==='shop'||activeTool==='clinic'||activeTool==='school')drawHouse(cx,cy,activeTool);
        ctx.restore();
      }
    }
  }
  function inside(x,y){return x>=0&&x<cols&&y>=0&&y<rows}
  function nearRoad(x,y){return [[x+1,y],[x-1,y],[x,y+1],[x,y-1]].some(([a,b])=>city.tiles.some(t=>t.x===a&&t.y===b&&t.type==='road'))}
  function getTileAt(px,py){
    const tw=tileW*scale,th=tileH*scale,dx=(px-ox)*2/tw,dy=(py-oy)*2/th;
    const x=Math.round((dx+dy)/2),y=Math.round((dy-dx)/2);
    if(!inside(x,y))return null;
    const [cx,cy]=tileCenter(x,y);
    if(Math.abs(px-cx)/(tw/2)+Math.abs(py-(cy+th/2))/(th/2)>1.18)return null;
    return {x,y};
  }
  function showToast(message){const el=get('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2300)}
  function setTool(tool){activeTool=tool;document.querySelectorAll('.tool-card').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));canvas.style.cursor=tool==='inspect'?'pointer':tool==='bulldoze'?'not-allowed':'crosshair';draw()}
  function place(tile){
    const existing=city.tiles.find(t=>t.x===tile.x&&t.y===tile.y);
    if(activeTool==='inspect'){
      if(existing){if(existing.type==='road')showToast('Jalan kota — menghubungkan lingkungan.');else showToast(`${buildings[existing.type]?.name||'Bangunan'} kota • klik alat bangun untuk menambah.`);}
      else showToast('Pilih bangunan, lalu tempatkan di petak kosong dekat jalan.');return;
    }
    if(activeTool==='bulldoze'){
      if(!existing){showToast('Tidak ada yang bisa diratakan di sini.');return;}
      if(existing.type!=='road')city.cash+=Math.floor((costs[existing.type]||0)*.35);
      city.tiles=city.tiles.filter(t=>t!==existing);showToast('Bangunan diratakan. Sebagian biaya dikembalikan.');updateUI();draw();save();return;
    }
    if(existing){showToast('Petak ini sudah terpakai. Pilih petak kosong.');return;}
    if(activeTool!=='road'&&!nearRoad(tile.x,tile.y)){showToast('Bangunan harus terhubung ke jalan.');return;}
    const cost=costs[activeTool]||0;if(city.cash<cost){showToast('Kas kota belum cukup untuk pembangunan ini.');return;}
    city.cash-=cost;city.tiles.push(newTile(tile.x,tile.y,activeTool));
    if(activeTool==='house')city.happiness=Math.min(100,city.happiness+1);
    checkMission();updateUI();draw();save();
    const name=buildings[activeTool]?.name||'Jalan';showToast(`${name} berhasil dibangun! ${cost?`−¤ ${fmt(cost)}`:''}`);
    if(city.sound)beep();
  }
  function checkMission(){
    if(!city.missionDone&&count('house')>=4){city.missionDone=true;city.cash+=800;showToast('Misi selesai! +¤ 800 masuk ke kas kota.');}
    const countNow=Math.max(0,count('house')-2);
    get('missionFill').style.width=`${Math.min(100,countNow/2*100)}%`;
    get('missionCount').textContent=`${Math.min(countNow,2)} / 2 selesai`;
    if(city.missionDone){get('missionTitle').textContent='Kampung mulai tumbuh!';get('missionText').textContent='Warga baru sudah punya tempat tinggal. Terus kembangkan kotamu!';get('missionCount').textContent='Misi selesai ✓';}
  }
  function updateUI(){
    get('cashValue').textContent=fmt(city.cash);get('populationValue').textContent=fmt(city.population);get('capacityValue').textContent=fmt(cap());
    get('happinessValue').textContent=Math.round(happiness());get('jobsValue').textContent=fmt(jobs());
    get('incomeValue').textContent=`+¤ ${fmt(income())}`;get('expenseValue').textContent=`−¤ ${fmt(expense())}`;
    get('popMeter').style.width=`${Math.min(100,city.population/cap()*100)}%`;get('happyMeter').style.width=`${happiness()}%`;
    get('moodLabel').textContent=happiness()>82?'Bahagia':happiness()>64?'Senang':happiness()>44?'Biasa':'Gelisah';
    get('popChange').textContent=city.population<cap()?'+2':'penuh';get('budgetFill').style.width=`${Math.max(4,Math.min(100,city.cash/20000*100))}%`;
    get('cashTrend').textContent=income()-expense()>=0?'↗ surplus':'↘ defisit';
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];get('dateLabel').textContent=`${days[(city.day+0)%7]} · ${city.day}`;
    get('pauseBtn').classList.toggle('is-paused',city.paused);get('pauseIcon').textContent=city.paused?'▶':'Ⅱ';get('pauseText').textContent=city.paused?'Lanjut':'Jeda';
    checkMission();
  }
  function tick(){
    if(city.paused)return;
    city.day++;
    const net=income()-expense();city.cash+=net;
    if(city.population<cap()&&city.happiness>45)city.population=Math.min(cap(),city.population+2);
    if(city.population>jobs()+4)city.happiness=Math.max(20,happiness()-2);else city.happiness=Math.min(100,happiness()+1);
    if(city.cash<0)city.happiness=Math.max(20,city.happiness-3);
    updateUI();save();
    if(city.day%5===0)showToast(city.population<cap()?'Warga baru mulai berdatangan ke kotamu!':`Hari ${city.day}: kota terus berjalan. Pemasukan bersih ¤ ${fmt(net)}.`);
  }
  function beep(){try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;const ac=new AC(),osc=ac.createOscillator(),gain=ac.createGain();osc.type='sine';osc.frequency.value=640;gain.gain.setValueAtTime(.035,ac.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.12);osc.connect(gain);gain.connect(ac.destination);osc.start();osc.stop(ac.currentTime+.12);osc.onended=()=>ac.close();}catch(_){}}
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();hover=getTileAt(e.clientX-r.left,e.clientY-r.top);draw()});
  canvas.addEventListener('pointerleave',()=>{hover=null;draw()});
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=canvas.getBoundingClientRect(),tile=getTileAt(e.clientX-r.left,e.clientY-r.top);if(tile)place(tile)});
  document.querySelectorAll('.tool-card').forEach(btn=>btn.addEventListener('click',()=>setTool(btn.dataset.tool)));
  get('pauseBtn').addEventListener('click',()=>{city.paused=!city.paused;updateUI();showToast(city.paused?'Waktu kota dijeda.':'Kota kembali berjalan!');save()});
  get('soundBtn').addEventListener('click',()=>{city.sound=!city.sound;get('soundBtn').style.color=city.sound?'#9daead':'#e69b87';showToast(city.sound?'Suara pembangunan aktif.':'Suara dimatikan.');save()});
  get('zoomIn').addEventListener('click',()=>{city.zoom=Math.min(1.4,city.zoom+.12);resize()});get('zoomOut').addEventListener('click',()=>{city.zoom=Math.max(.72,city.zoom-.12);resize()});
  get('centerBtn').addEventListener('click',()=>{city.zoom=1;resize();showToast('Peta kota dipusatkan.')});
  get('startBuild').addEventListener('click',()=>{get('introCard').style.display='none';setTool('house');city.intro=false;save()});
  get('introClose').addEventListener('click',()=>{get('introCard').style.display='none';city.intro=false;save()});
  get('nextTip').addEventListener('click',()=>{city.tip=(city.tip+1)%tips.length;get('tipText').textContent=tips[city.tip]});
  get('renameBtn').addEventListener('click',()=>{const name=prompt('Beri nama baru untuk kotamu:',city.name);if(name&&name.trim()){city.name=name.trim().slice(0,24);get('cityName').textContent=city.name;save()}});
  get('statsInfo').addEventListener('click',()=>{get('modalText').textContent=`Kota memiliki ${city.population} penduduk, ${jobs()} lowongan kerja, dan tingkat kebahagiaan ${Math.round(happiness())}/100. Bangun rumah agar kapasitas bertambah, lalu lengkapi kota dengan fasilitas.`;get('modalBackdrop').classList.add('open');get('modalBackdrop').setAttribute('aria-hidden','false')});
  const closeModal=()=>{get('modalBackdrop').classList.remove('open');get('modalBackdrop').setAttribute('aria-hidden','true')};get('modalClose').addEventListener('click',closeModal);get('modalOk').addEventListener('click',closeModal);get('modalBackdrop').addEventListener('click',e=>{if(e.target===get('modalBackdrop'))closeModal()});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){setTool('inspect');closeModal()}if(e.code==='Space'&&document.activeElement.tagName!=='BUTTON'){e.preventDefault();city.paused=!city.paused;updateUI()}});
  window.addEventListener('resize',resize);
  get('cityName').textContent=city.name;
  if(!city.intro)get('introCard').style.display='none';
  if(!city.sound)get('soundBtn').style.color='#e69b87';
  checkMission();updateUI();resize();
  setInterval(()=>{if(!city.paused)tick()},10000);
})();
