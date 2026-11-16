// HUD: every DOM readout in one place. The game calls set* methods; this
// module never reads game state on its own. Overlays are plain panels the
// game shows and hides by name.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hp: $('hp-value'), hpBar: $('hp-bar'), armor: $('armor-value'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    timer: $('timer-value'), round: $('round-value'),
    money: $('money-value'), team: $('team-value'),
    scoreA: $('score-a'), scoreD: $('score-d'),
    feed: $('feed'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    vignette: $('vignette'), banner: $('banner'), bannerText: $('banner-text'),
    bomb: $('bomb-status'), bombText: $('bomb-text'), bombBar: $('bomb-bar'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'), play: $('play'),
    buy: $('buy'), buyMoney: $('buy-money'), buyList: $('buy-list'),
    progress: $('progress'), progressLabel: $('progress-label'), progressBar: $('progress-bar'),
    noise: $('noise'), squad: $('squad-line'),
  };
  let feedCount = 0;

  function showOverlay(name, title, copy, button) {
    el.overlay.hidden = false;
    el.overlay.dataset.state = name;
    el.overlayTitle.textContent = title;
    el.overlayCopy.textContent = copy;
    el.play.textContent = button;
  }

  return {
    setHealth(hp, armor) {
      el.hp.textContent = Math.max(0, Math.ceil(hp));
      el.hpBar.style.width = `${Math.max(0, hp)}%`;
      el.hpBar.style.background = hp > 50 ? '#7dd87d' : hp > 25 ? '#ffb020' : '#ff4d3d';
      el.armor.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, reserve, reloading) {
      el.ammoMag.textContent = mag;
      el.ammoReserve.textContent = `/ ${reserve}${reloading ? ' — reloading' : ''}`;
      el.ammo.classList.toggle('empty', mag === 0);
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      el.timer.style.color = s <= 10 ? '#ff4d3d' : '';
    },
    setRound(round, scoreA, scoreD) {
      el.round.textContent = `ROUND ${round}`;
      el.scoreA.textContent = scoreA;
      el.scoreD.textContent = scoreD;
    },
    setMoney(money) {
      el.money.textContent = `$${money}`;
    },
    setTeam(aliveA, aliveD) {
      el.team.textContent = `VIPERS ${aliveA} · ${aliveD} JACKALS`;
    },
    setCrosshairSpread(px) {
      el.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(kill) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', kill);
      setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), 110);
    },
    damageFlash() {
      el.vignette.classList.add('on');
      setTimeout(() => el.vignette.classList.remove('on'), 180);
    },
    feed(text, good) {
      const line = document.createElement('div');
      line.textContent = text;
      if (good) line.style.color = '#7dd87d';
      el.feed.prepend(line);
      feedCount += 1;
      while (el.feed.children.length > 5) el.feed.lastChild.remove();
    },
    banner(text, ms = 2200) {
      el.bannerText.textContent = text;
      el.banner.hidden = false;
      setTimeout(() => { el.banner.hidden = true; }, ms);
    },
    setBomb(text, frac) {
      if (!text) {
        el.bomb.hidden = true;
        return;
      }
      el.bomb.hidden = false;
      el.bombText.textContent = text;
      el.bombBar.style.width = `${Math.round(frac * 100)}%`;
    },
    // Noise indicator: tells the player whether they are loud (running) or
    // silent (walking / crouching) — the tradeoff the AI hears.
    setNoise(stance) {
      if (stance === 'run') {
        el.noise.textContent = '● LOUD — running';
        el.noise.style.color = '#ff4d3d';
      } else if (stance === 'walk') {
        el.noise.textContent = '○ SILENT — walking';
        el.noise.style.color = '#7dd87d';
      } else if (stance === 'crouch') {
        el.noise.textContent = '○ SILENT — crouched';
        el.noise.style.color = '#7dd87d';
      } else {
        el.noise.textContent = '';
      }
    },
    // Squad line: a teammate's acknowledgement or callout, shown briefly.
    squadLine(text) {
      el.squad.textContent = text;
      el.squad.hidden = false;
      setTimeout(() => { el.squad.hidden = true; }, 2600);
    },
    showProgress(label, frac) {
      el.progress.hidden = false;
      el.progressLabel.textContent = label;
      el.progressBar.style.width = `${Math.round(frac * 100)}%`;
    },
    hideProgress() {
      el.progress.hidden = true;
    },
    showOverlay,
    hideOverlay() {
      el.overlay.hidden = true;
    },
    overlayState() {
      return el.overlay.hidden ? null : el.overlay.dataset.state;
    },
    onPlay(fn) {
      el.play.addEventListener('click', fn);
    },
    showBuy(money, items) {
      el.buy.hidden = false;
      el.buyMoney.textContent = `$${money}`;
      el.buyList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.id = item.id;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.label}</span><span class="buy-note">${item.note}</span><span class="buy-price">$${item.price}</span>`;
        el.buyList.appendChild(row);
      }
    },
    hideBuy() {
      el.buy.hidden = true;
    },
    onBuy(fn) {
      el.buyList.addEventListener('click', (event) => {
        const row = event.target.closest('.buy-row');
        if (row) fn(row.dataset.id);
      });
    },
  };
}
