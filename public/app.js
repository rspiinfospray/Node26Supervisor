const $ = selector => document.querySelector(selector);
let state = null;
let viewState = null;
let historyCycles = [];
let events = [];
let timer = null;

async function api(path, options = {}) {
  const response = await fetch(path, { headers:{'Content-Type':'application/json'}, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function loadWorlds() {
  const worlds = await api('/api/worlds');
  const finished = worlds.filter(world => world.status === 'FINISHED').sort((a,b) => b.sequenceNumber-a.sequenceNumber);
  $('#world').innerHTML = finished.map(world => `<option value="${world.id}">${escapeHtml(world.name)} · round ${world.currentRound}</option>`).join('') || '<option value="">Aucun monde terminé</option>';
  if (state?.activeWorldId && finished.some(world => world.id === state.activeWorldId)) $('#world').value=state.activeWorldId;
  $('#start').disabled = !finished.length || isRunning();
  await loadWorldHistory();
}

async function loadWorldHistory(renderAfter=true) {
  const worldId=$('#world').value;
  if(!worldId){ viewState=null; historyCycles=[]; if(renderAfter)render(); return; }
  const loops=await api(`/api/history?worldId=${encodeURIComponent(worldId)}`);
  viewState=loops[0] || {status:'idle',message:'Aucune boucle enregistrée pour ce monde',currentCycle:0,maximumCycles:0,startedAt:null,completedAt:null,preparationTasks:[],cycles:[]};
  historyCycles=loops.flatMap(loop => loop.cycles.map(cycle => ({...cycle,_loopId:loop.loopId,_loopStartedAt:loop.startedAt})))
    .filter(cycle => cycle.sourceWorldId===worldId || cycle.resultWorldId===worldId)
    .sort((left,right) => String(right._loopStartedAt).localeCompare(String(left._loopStartedAt)) || right.number-left.number);
  if(renderAfter)render();
}

function isRunning() { return state && !['idle','completed','failed','stopped'].includes(state.status); }
function escapeHtml(value) { const node=document.createElement('span'); node.textContent=String(value); return node.innerHTML; }
function formatDuration(start, end) { if(!start)return '—'; const seconds=Math.max(0,Math.floor((new Date(end||Date.now())-new Date(start))/1000)); return `${Math.floor(seconds/60)}m ${seconds%60}s`; }

function formatTime(value) { return value ? new Date(value).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : ''; }

function appendInlineMarkdown(parent, text) {
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[2]) { const strong=document.createElement('strong'); strong.textContent=match[2]; parent.append(strong); }
    else if (match[3]) { const code=document.createElement('code'); code.textContent=match[3]; parent.append(code); }
    else {
      const url=match[5];
      if (/^https?:\/\//i.test(url)) { const link=document.createElement('a'); link.textContent=match[4]; link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; parent.append(link); }
      else { const span=document.createElement('span'); span.textContent=`${match[4]} (${url})`; parent.append(span); }
    }
    cursor = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}

function tableCells(line) { return line.trim().replace(/^\||\|$/g,'').split('|').map(cell => cell.trim()); }
function renderMarkdown(markdown, container) {
  container.replaceChildren();
  const lines=String(markdown).replace(/\r/g,'').split('\n');
  let index=0;
  while(index < lines.length) {
    const line=lines[index];
    if (!line.trim()) { index++; continue; }
    if (line.startsWith('```')) {
      const language=line.slice(3).trim(); const content=[]; index++;
      while(index < lines.length && !lines[index].startsWith('```')) content.push(lines[index++]);
      index++; const pre=document.createElement('pre'); const code=document.createElement('code'); code.textContent=content.join('\n');
      if(language) code.dataset.language=language; pre.append(code); container.append(pre); continue;
    }
    const heading=line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const element=document.createElement(`h${heading[1].length}`); appendInlineMarkdown(element,heading[2]); container.append(element); index++; continue; }
    if (line.includes('|') && index+1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index+1])) {
      const headers=tableCells(line); index+=2; const table=document.createElement('table'); const thead=document.createElement('thead'); const headerRow=document.createElement('tr');
      headers.forEach(value => { const cell=document.createElement('th'); appendInlineMarkdown(cell,value); headerRow.append(cell); }); thead.append(headerRow); table.append(thead); const tbody=document.createElement('tbody');
      while(index < lines.length && lines[index].includes('|') && lines[index].trim()) { const row=document.createElement('tr'); tableCells(lines[index++]).forEach(value => { const cell=document.createElement('td'); appendInlineMarkdown(cell,value); row.append(cell); }); tbody.append(row); }
      table.append(tbody); const wrapper=document.createElement('div'); wrapper.className='markdown-table'; wrapper.append(table); container.append(wrapper); continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered=/^\s*\d+\.\s+/.test(line); const list=document.createElement(ordered?'ol':'ul'); const expression=ordered?/^\s*\d+\.\s+/:/^\s*[-*+]\s+/;
      while(index < lines.length && expression.test(lines[index])) { const item=document.createElement('li'); appendInlineMarkdown(item,lines[index++].replace(expression,'')); list.append(item); }
      container.append(list); continue;
    }
    if (/^>\s?/.test(line)) { const quote=document.createElement('blockquote'); const values=[]; while(index < lines.length && /^>\s?/.test(lines[index])) values.push(lines[index++].replace(/^>\s?/,'')); appendInlineMarkdown(quote,values.join(' ')); container.append(quote); continue; }
    const paragraph=[];
    while(index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^```|^\s*[-*+]\s+|^\s*\d+\.\s+|^>\s?/.test(lines[index]) && !(lines[index].includes('|') && index+1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index+1]))) paragraph.push(lines[index++].trim());
    const element=document.createElement('p'); appendInlineMarkdown(element,paragraph.join(' ')); container.append(element);
  }
}

function renderCurrentCycle(shown) {
  const cycle = shown.cycles.find(item => item.number === shown.currentCycle) || shown.cycles.at(-1);
  const isPreparation = !cycle && (shown.preparationTasks?.length || shown.status === 'preparing');
  const preparationTasks = (shown.preparationTasks || []).map(task => ({...task,phase:'Préparation'}));
  const cycleTasks = (cycle?.tasks || []).filter(task => task.id !== 'reporting').map(task => ({...task,phase:`Cycle ${cycle.number}`}));
  const tasks = [...preparationTasks,...cycleTasks];
  const completed = tasks.filter(task => task.status === 'completed').length;
  const displayedStatus = cycle?.status || (isPreparation ? shown.status : 'pending');
  $('#cycleState').textContent = ({preparing:'En cours',running:'En cours',completed:'Terminé',failed:'Échec',stopped:'Arrêté',pending:'En attente'})[displayedStatus] || displayedStatus;
  $('#cycleState').className = `pill status-${displayedStatus}`;
  $('#cycleElapsed').textContent = cycle ? formatDuration(cycle.startedAt,cycle.completedAt) : isPreparation ? formatDuration(shown.startedAt,shown.completedAt) : '—';
  $('#taskProgress i').style.width = `${tasks.length ? completed/tasks.length*100 : 0}%`;
  $('#currentTasks').innerHTML = tasks.length ? tasks.map((task,index) => {
    const timing = task.status === 'running' ? `Depuis ${formatTime(task.startedAt)} · ${formatDuration(task.startedAt)}` : task.completedAt ? `${formatTime(task.startedAt)} → ${formatTime(task.completedAt)} · ${formatDuration(task.startedAt,task.completedAt)}` : 'En attente';
    return `<div class="task ${escapeHtml(task.status)}"><div class="task-rail"><span>${task.status === 'completed' ? '✓' : task.status === 'failed' ? '!' : index+1}</span>${index < tasks.length-1 ? '<i></i>' : ''}</div><div class="task-body"><small class="task-phase">${escapeHtml(task.phase)}</small><div class="task-heading"><b>${escapeHtml(task.label)}</b><span>${escapeHtml(timing)}</span></div><p>${escapeHtml(task.detail || task.description)}</p>${task.status === 'running' ? '<div class="activity"><i></i><i></i><i></i></div>' : ''}</div></div>`;
  }).join('') : '<p class="muted">Lancez une boucle pour suivre ses sous-tâches.</p>';
  $('#currentTasks').classList.toggle('preparation', Boolean(isPreparation));
}

function render() {
  if (!state) return;
  const shown=viewState || state;
  const cycles=historyCycles.length ? historyCycles : shown.cycles;
  $('#status').textContent = ({idle:'Prêt',preparing:'Préparation',correcting:'Correction Codex',testing:'Tests',deploying:'Déploiement',simulating:'Simulation',evaluating:'Évaluation',reporting:'Rapport OpenAI',completed:'Terminée',failed:'Échec',stopped:'Arrêtée'})[shown.status] || shown.status;
  $('#message').textContent = shown.message;
  $('#cycle').textContent = shown.currentCycle === 0 && shown.preparationTasks?.length ? 'Préparation' : `${shown.currentCycle} / ${shown.maximumCycles}`;
  renderCurrentCycle(shown);
  $('#progress').style.width = `${shown.maximumCycles ? shown.currentCycle/shown.maximumCycles*100 : 0}%`;
  $('#start').disabled = isRunning() || !$('#world').value;
  $('#resume').disabled = state.status !== 'failed' || !state.cycles.some(cycle => cycle.tasks?.some(task => task.status === 'failed'));
  $('#stop').disabled = !isRunning();
  const last = cycles.find(cycle => cycle.evaluation);
  $('#score').textContent = last ? `${last.evaluation.score} %` : '—';
  $('#verdict').textContent = last?.evaluation.verdict || '—';
  $('#duration').textContent = formatDuration(shown.startedAt,shown.completedAt);
  $('#cycleList').innerHTML = cycles.length ? cycles.map(cycle => { const loopId=cycle._loopId || shown.loopId; return `<div class="cycle-item"><div class="cycle-top"><div><span class="pill">${escapeHtml(cycle.status)}</span> <b>Cycle ${cycle.number}</b></div><strong class="score">${cycle.evaluation ? cycle.evaluation.score+' %' : '—'}</strong></div><p class="muted">${escapeHtml(cycle.evaluation?.summary || cycle.error || 'Traitement en cours…')}</p><p class="files">${cycle.changedFiles.map(escapeHtml).join(' · ') || 'Aucun fichier recensé'}</p><div class="cycle-actions">${cycle.correctionAvailable ? `<button class="small document-button" data-document="correction" data-loop="${loopId}" data-cycle="${cycle.number}" type="button">Voir les corrections</button>` : ''}${cycle.reportAvailable ? `<button class="small document-button" data-document="report" data-loop="${loopId}" data-cycle="${cycle.number}" type="button">Rapport utilisé par Codex</button>` : ''}${cycle.controlReportAvailable ? `<button class="small document-button" data-document="control-report" data-loop="${loopId}" data-cycle="${cycle.number}" type="button">Rapport du monde de contrôle</button>` : ''}</div></div>`; }).join('') : '<p class="muted">Aucun cycle associé à ce monde.</p>';
}

function renderEvents() {
  $('#events').innerHTML = [...events].reverse().map(event => `<div class="event ${event.level}"><time>${new Date(event.timestamp).toLocaleTimeString('fr-FR')}</time><div><b>${escapeHtml(event.type)}</b><span>${escapeHtml(event.message)}</span></div></div>`).join('');
}

async function refresh() { const payload=await api('/api/state'); state=payload.state; events=payload.events; if($('#world').value)await loadWorldHistory(false); render(); renderEvents(); }
$('#start').addEventListener('click', async () => { try { state=await api('/api/loops',{method:'POST',body:JSON.stringify({worldId:$('#world').value,maximumCycles:Number($('#cycles').value)})}); viewState=state; historyCycles=state.cycles; render(); } catch(error){alert(error.message);} });
$('#stop').addEventListener('click', async () => { try { state=await api('/api/loops/stop',{method:'POST'}); render(); } catch(error){alert(error.message);} });
$('#resume').addEventListener('click', async () => { try { state=await api('/api/loops/resume',{method:'POST'}); render(); } catch(error){alert(error.message);} });
$('#clear').addEventListener('click', () => { events=[]; renderEvents(); });
$('#world').addEventListener('change', () => loadWorldHistory().catch(error => alert(error.message)));
$('#cycleList').addEventListener('click', async event => {
  const button = event.target.closest('.document-button');
  if (!button) return;
  const loopId=button.dataset.loop;
  const cycleNumber = Number(button.dataset.cycle);
  const documentType = button.dataset.document;
  $('#reportTitle').textContent = documentType === 'correction' ? `Corrections apportées au cycle ${cycleNumber}` : documentType === 'control-report' ? `Rapport du monde de contrôle · cycle ${cycleNumber}` : `Rapport utilisé par Codex · cycle ${cycleNumber}`;
  $('#reportContent').textContent = 'Chargement…';
  $('#reportDialog').showModal();
  try {
    const response = await fetch(`/api/loops/${encodeURIComponent(loopId)}/cycles/${cycleNumber}/${documentType}`);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    renderMarkdown(await response.text(), $('#reportContent'));
  } catch (error) { $('#reportContent').textContent = `Impossible de charger le rapport : ${error.message}`; }
});
$('#closeReport').addEventListener('click', () => $('#reportDialog').close());
$('#reportDialog').addEventListener('click', event => { if (event.target === $('#reportDialog')) $('#reportDialog').close(); });

const source = new EventSource('/api/events');
source.addEventListener('open', () => { $('#connection').textContent='Connecté'; $('#connection').classList.add('ok'); });
source.addEventListener('error', () => { $('#connection').textContent='Reconnexion…'; $('#connection').classList.remove('ok'); });
source.addEventListener('supervisor-event', async event => { events.push(JSON.parse(event.data)); if(events.length>500)events.shift(); renderEvents(); await refresh(); });

await refresh();
await loadWorlds();
timer=setInterval(() => { render(); },1000);
