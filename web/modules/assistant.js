async function chat() {
  const v=$('chatinput').value.trim(); if(!v)return; $('chatinput').value=''; $('chatlog').innerHTML+=`<div class="msg"><b>You:</b> ${esc(v)}</div>`;
  try { const d=await api('/chat',{method:'POST',body:{message:v}}); $('chatlog').innerHTML+=`<div class="msg"><b>Juvia:</b> ${esc(d.answer)}</div>`; $('chatlog').scrollTop=$('chatlog').scrollHeight; } catch(e) { msg(e.message); }
}
