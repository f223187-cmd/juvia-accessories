const CHAT_SUGGESTIONS = ['A gift for her under $200', 'Classic everyday watch', 'Gold ring with a stone', 'Something with an emerald'];
let chatReady = false;
function initChat() {
  if (chatReady) return; chatReady = true;
  $('chatSuggest').innerHTML = CHAT_SUGGESTIONS.map(s => `<button class="chip" onclick="chat(this.textContent)">${esc(s)}</button>`).join('');
  addBubble('bot', `Hi${user ? ' ' + esc(user.name.split(' ')[0]) : ''}! I'm your Juvia stylist. Tell me the occasion, style or budget and I'll pick pieces you can try on live.`);
}
function addBubble(who, html) {
  const el = document.createElement('div'); el.className = 'bubble ' + who; el.innerHTML = html;
  $('chatlog').appendChild(el); $('chatlog').scrollTop = $('chatlog').scrollHeight; window.Motion?.pop(el); return el;
}
function pickCard(p) {
  return `<div class="pick"><div class="media">${productMedia(p)}</div><div class="b"><b>${esc(p.name)}</b><span class="price" style="font-size:14px">${money(p.price)}</span>
    <div style="display:flex;gap:6px"><button class="btn ghost sm" onclick="location.hash='shop';setTimeout(()=>openProduct(${p.id}),60)">View</button>${p.has_3d_asset ? `<button class="btn soft sm" onclick="chooseVtoProduct(${p.id},'${p.category}')">${icon('camera')}Try on</button>` : ''}</div></div></div>`;
}
async function chat(text) {
  const v = (text ?? $('chatinput').value).trim(); if (!v) return; $('chatinput').value = '';
  addBubble('me', esc(v)); const typing = addBubble('bot typing', 'Finding pieces…');
  try {
    const d = await api('/chat', { method: 'POST', body: { message: v } });
    if (d.products?.length && !shopRows.length) shopRows = await api('/products').catch(() => []);
    const products = (d.products || []).map(p => ({ ...p, ...(shopRows.find(r => r.id === p.id) || {}) }));
    typing.classList.remove('typing');
    typing.innerHTML = esc(d.answer) + (products.length ? `<div class="picks">${products.map(pickCard).join('')}</div>` : '');
    window.Motion?.stagger(typing.querySelectorAll('.pick'), { y: 12, each: .07 });
    $('chatlog').scrollTop = $('chatlog').scrollHeight;
  } catch (e) { typing.classList.remove('typing'); typing.textContent = 'Sorry, I could not reach the stylist. ' + e.message; }
}
