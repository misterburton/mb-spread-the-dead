// Run flow: intro card, win/lose overlay, restart. Era-styled DOM, no assets.
export function createFlow(root, gameState) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 40; display: none;
    background: rgba(4,5,4,0.86); color: #b8b0a0;
    font-family: 'Courier New', monospace; text-align: center;
    padding-top: 28vh; letter-spacing: 2px;
  `;
  root.appendChild(overlay);

  const intro = document.createElement('div');
  intro.style.cssText = overlay.style.cssText;
  intro.style.display = 'block';
  intro.innerHTML = `
    <div style="font-size:26px;letter-spacing:8px;color:#9a9484;">SPREAD THE DEAD</div>
    <div style="margin-top:18px;font-size:13px;color:#7a7466;line-height:2;">
      they buried you in the north field.<br>
      you remember who lowered you.<br><br>
      women are lineage. men are calories.<br>
      leave no evidence, or the town wakes.
    </div>
    <div style="margin-top:30px;font-size:12px;color:#5a5648;">touch / click to rise</div>
  `;
  root.appendChild(intro);

  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    intro.style.display = 'none';
  };
  window.addEventListener('pointerdown', begin, { once: false });
  window.addEventListener('keydown', begin);

  let overShown = false;
  gameState.onChange((what, s) => {
    if (what !== 'over' || overShown) return;
    overShown = true;
    const win = s.over === 'win';
    overlay.innerHTML = `
      <div style="font-size:24px;letter-spacing:6px;color:${win ? '#8aa87a' : '#a87a6a'};">
        ${win ? 'THE LINEAGE IS COMPLETE' : s.over === 'cordon' ? 'THE CORDON CLOSED' : 'YOU ROT AWAY'}
      </div>
      <div style="margin-top:16px;font-size:13px;color:#7a7466;">
        ${win
          ? 'every woman in town walks with you now.'
          : s.over === 'cordon'
            ? 'the town burned the field, and you with it.'
            : 'hunger is patient. rot is patient-er.'}
      </div>
      <div style="margin-top:26px;font-size:12px;color:#5a5648;">refresh to run it back</div>
    `;
    overlay.style.display = 'block';
  });

  return { get started() { return started; } };
}
