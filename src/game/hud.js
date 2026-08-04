// HUD: hunger / rot / evidence bars + stage name + horde count. DOM-based, era-styled.
import { CFG, STAGES } from '../config.js';

export function createHUD(root, gameState) {
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; left: 14px; bottom: 12px; z-index: 30;
    font-family: 'Courier New', monospace; color: #9aa39a;
    text-shadow: 0 1px 0 #000; pointer-events: none;
    image-rendering: pixelated; letter-spacing: 1px;
  `;
  root.appendChild(el);

  const bar = (label, color) => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:4px;font-size:11px;';
    const lab = document.createElement('span');
    lab.textContent = label;
    lab.style.cssText = 'display:inline-block;width:64px;opacity:0.8;';
    const outer = document.createElement('span');
    outer.style.cssText = `display:inline-block;width:120px;height:9px;border:1px solid #3a403a;background:#0c0e0c;vertical-align:middle;`;
    const fill = document.createElement('span');
    fill.style.cssText = `display:block;height:100%;width:50%;background:${color};`;
    outer.appendChild(fill);
    row.appendChild(lab); row.appendChild(outer);
    el.appendChild(row);
    return fill;
  };

  const hungerFill = bar('HUNGER', '#7a3b2e');
  const rotFill = bar('ROT', '#5a6b4a');
  const evFill = bar('EVIDENCE', '#6b5a7a');

  const stageEl = document.createElement('div');
  stageEl.style.cssText = 'margin-top:7px;font-size:12px;color:#8a8474;';
  el.appendChild(stageEl);

  const hordeEl = document.createElement('div');
  hordeEl.style.cssText = 'font-size:11px;color:#7a8a7a;';
  el.appendChild(hordeEl);

  function update() {
    const s = gameState.state;
    hungerFill.style.width = `${(s.hunger / CFG.hunger.max) * 100}%`;
    rotFill.style.width = `${(s.rot / CFG.rot.max) * 100}%`;
    const maxEv = CFG.escalation.thresholds[CFG.escalation.thresholds.length - 1];
    evFill.style.width = `${Math.min(1, s.evidence / maxEv) * 100}%`;
    stageEl.textContent = STAGES[s.stage].toUpperCase();
    hordeEl.textContent = `HORDE ${s.hordeSize} · WOMEN ${s.womenConverted}/${s.womenTotal}`;
    if (s.over) {
      stageEl.textContent = s.over === 'win' ? 'THE LINEAGE IS COMPLETE' :
        s.over === 'cordon' ? 'THE CORDON CLOSED' : 'YOU ROT AWAY';
      stageEl.style.color = s.over === 'win' ? '#9aba8a' : '#ba8a8a';
      stageEl.style.fontSize = '16px';
    }
  }

  gameState.onChange(update);
  update();
  return { update };
}
