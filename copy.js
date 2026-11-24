/* HX_OK */
(function () {
  'use strict';

  const W = unsafeWindow;
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const log = (...a) => console.log('[HX]', ...a);
  const TTL = 2 * 60 * 1000;

  let AUTH = null;
  const idMap = {};

  function scan(o, depth) {
    depth = depth || 0;
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o)) { o.forEach(x => scan(x, depth + 1)); return; }
    if (o.order_identifier) {
      if (o.id && String(o.id).length >= 5) idMap[o.order_identifier] = o.id;
      if (o.order_id) idMap[o.order_identifier] = o.order_id;
    }
    for (const k in o) scan(o[k], depth + 1);
  }

  const XP = W.XMLHttpRequest.prototype;
  const _open = XP.open, _setH = XP.setRequestHeader;
  XP.open = function (m, u) {
    this._hxUrl = String(u || '');
    this.addEventListener('load', () => {
      try {
        if (/api\.hi-express\.co/.test(this._hxUrl) && this.responseType !== 'blob' && this.responseType !== 'arraybuffer') {
          const t = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          scan(t);
        }
      } catch (e) {}
    });
    return _open.apply(this, arguments);
  };
  XP.setRequestHeader = function (k, v) {
    if (/^authorization$/i.test(k) && v) AUTH = v;
    return _setH.apply(this, arguments);
  };

  const _fetch = W.fetch;
  W.fetch = function (input, init) {
    try {
      const h = (init && init.headers) || (input && input.headers);
      if (h) {
        const a = typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization);
        if (a) AUTH = a;
      }
    } catch (e) {}
    const p = _fetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/api\.hi-express\.co/.test(url)) p.then(r => r.clone().json().then(scan).catch(() => {})).catch(() => {});
    } catch (e) {}
    return p;
  };

  function findToken() {
    if (AUTH) return AUTH;
    try {
      for (const store of [W.localStorage, W.sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const v = store.getItem(store.key(i)) || '';
          const m = v.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
          if (m) return 'Bearer ' + m[0];
          if (/token/i.test(store.key(i)) && v.length > 20 && v.length < 3000) {
            return 'Bearer ' + v.replace(/^"|"$/g, '');
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function getValue(root, label) {
    const els = root.querySelectorAll('p, span, div, td, th, label');
    for (const el of els) {
      if (el.children.length === 0 && clean(el.textContent).replace(/[:：]$/, '') === label) {
        let sib = el.nextElementSibling;
        if (!sib && el.parentElement) sib = el.parentElement.nextElementSibling;
        if (sib) return clean(sib.textContent);
      }
    }
    return '';
  }

  function currentBtn(dialog) {
    return [...dialog.querySelectorAll('button')]
      .find(b => /^[A-Z0-9]{3}\d{10,}$/.test(clean(b.textContent)));
  }

  function getBgh(dialog) {
    const b = currentBtn(dialog);
    return b ? clean(b.textContent) : '';
  }

  function getReason(dialog) {
    return getValue(dialog, 'السبب') || getValue(dialog, 'الحالة المبلغ عنها');
  }

  function fiberOrderId(dialog) {
    const btn = currentBtn(dialog);
    if (!btn) return null;
    const key = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
    let f = key && btn[key], d = 0;
    while (f && d < 40) {
      const p = f.memoizedProps || {};
      for (const k in p) {
        const v = p[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if (v.order_id) return String(v.order_id);
          if (v.order && v.order.id) return String(v.order.id);
        }
      }
      if (p.orderId) return String(p.orderId);
      if (p.order_id) return String(p.order_id);
      f = f.return; d++;
    }
    return null;
  }

  function currentImg(dialog) {
    const imgs = [...dialog.querySelectorAll('img')];
    return imgs.find(i => /amazonaws\.com/.test(i.src)) ||
      imgs.sort((a, b) => b.naturalWidth - a.naturalWidth)[0] || null;
  }

  function snapshot(dialog) {
    const img = currentImg(dialog);
    return { bgh: getBgh(dialog), reason: getReason(dialog), src: img ? img.src : '' };
  }

  function gmGetJson(url, token) {
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = token;
      GM_xmlhttpRequest({
        method: 'GET', url, headers, withCredentials: true,
        onload: r => {
          if (r.status !== 200) return reject(new Error('HTTP' + r.status));
          try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(new Error('JSON')); }
        },
        onerror: () => reject(new Error('NET'))
      });
    });
  }

  async function fetchOrder(id) {
    const j = await gmGetJson('https://api.hi-express.co/api/v2/order/' + id, findToken());
    return j && j.data && j.data[0];
  }

  const fmtMoney = n => Number(n || 0).toLocaleString('en-US') + ' د.ع';

  function formatOrder(o) {
    const L = [];
    if (o.order_identifier)  L.push(o.order_identifier);
    if (o.client_identifier) L.push(o.client_identifier);
    L.push('');
    L.push('الزبــــــــــون :');
    if (o.customer_name)   L.push(o.customer_name);
    if (o.customer_phone1) L.push(o.customer_phone1);
    if (o.customer_phone2) L.push(o.customer_phone2);
    L.push('');
    L.push('معلومات التوصيل');
    if (o.center_name) L.push('المركز: ' + o.center_name);
    const area = [o.governance_name, o.city_name].filter(Boolean).join(' / ');
    if (area) L.push('العنوان: ' + area);
    if (o.delivery_address) L.push(o.delivery_address);
    L.push('');
    L.push('قيمة الطلب: ' + fmtMoney(o.order_value));
    return L.join('\n');
  }

  function gmFetchBlob(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob',
        onload: r => (r.status === 200 ? resolve(r.response) : reject(new Error('HTTP ' + r.status))),
        onerror: reject
      });
    });
  }

  function blobToPng(blob) {
    return new Promise((resolve, reject) => {
      const u = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        c.toBlob(b => { URL.revokeObjectURL(u); b ? resolve(b) : reject(new Error('toBlob')); }, 'image/png');
      };
      img.onerror = () => reject(new Error('img load'));
      img.src = u;
    });
  }

  const textCache = {};
  const imgCache = {};

  function getCached(cache, key) {
    const e = cache[key];
    if (e && Date.now() - e.t < TTL) return e.p;
    delete cache[key];
    return null;
  }
  function setCached(cache, key, p) {
    const keys = Object.keys(cache);
    if (keys.length > 60) keys.slice(0, 30).forEach(k => delete cache[k]);
    cache[key] = { p, t: Date.now() };
    p.catch(() => { if (cache[key] && cache[key].p === p) delete cache[key]; });
    return p;
  }

  function prepText(dialog, snap) {
    const bgh = snap.bgh;
    if (!bgh) return null;
    const c = getCached(textCache, bgh);
    if (c) return c;
    return setCached(textCache, bgh, (async () => {
      const id = idMap[bgh] || fiberOrderId(dialog);
      if (!id) throw new Error('NOID');
      let o = await fetchOrder(id);
      if (!o) throw new Error('NODATA');
      if (o.order_identifier !== bgh) {
        delete idMap[bgh];
        const id2 = fiberOrderId(dialog);
        o = id2 && String(id2) !== String(id) ? await fetchOrder(id2) : null;
        if (!o || o.order_identifier !== bgh) throw new Error('MISMATCH');
      }
      return formatOrder(o);
    })());
  }

  function prepImage(snap) {
    if (!snap.src) return null;
    const c = getCached(imgCache, snap.src);
    if (c) return c;
    return setCached(imgCache, snap.src, gmFetchBlob(snap.src).then(blobToPng));
  }

  function prepare(dialog) {
    const s = snapshot(dialog);
    const a = prepText(dialog, s); if (a) a.catch(() => {});
    const b = prepImage(s); if (b) b.catch(() => {});
  }

  function assertSame(dialog, snap) {
    if (getBgh(dialog) !== snap.bgh) throw new Error('CHANGED');
  }

  async function getText(dialog, snap) {
    snap = snap || snapshot(dialog);
    let base;
    try { base = await prepText(dialog, snap); }
    catch (e) {
      if (e.message === 'CHANGED') throw e;
      await new Promise(r => setTimeout(r, 250));
      base = await prepText(dialog, snap);
    }
    assertSame(dialog, snap);
    return snap.reason ? base + '\n\n' + snap.reason : base;
  }

  async function getImage(dialog, snap) {
    snap = snap || snapshot(dialog);
    let p = prepImage(snap);
    if (!p) return null;
    let blob;
    try { blob = await p; }
    catch (e) { log('فشل الصورة:', e.message); p = prepImage(snap); blob = p ? await p : null; }
    assertSame(dialog, snap);
    return blob;
  }

  function toast(msg, ok = true) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:999999;' +
      'padding:10px 20px;border-radius:8px;color:#fff;font:14px sans-serif;max-width:90%;text-align:center;' +
      'background:' + (ok ? '#25a37b' : '#d9534f');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function errMsg(e) {
    const m = (e && e.message) || String(e);
    if (m === 'NOID') return 'لم أجد معرّف الطلب';
    if (m === 'NODATA') return 'فشل جلب بيانات الطلب';
    if (m === 'MISMATCH') return 'البيانات لا تطابق الطلب الظاهر، أعد الضغط';
    if (m === 'CHANGED') return 'تغيّر الطلب الظاهر، أعد الضغط';
    if (/^HTTP/.test(m)) return 'رفض الخادم (' + m + ')';
    return 'خطأ: ' + m;
  }

  async function writeText(text) {
    try { await navigator.clipboard.writeText(text); return; } catch (e) { log('writeText:', e.message); }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('clipboard');
  }

  async function copyTextOnly(dialog) {
    try {
      const snap = snapshot(dialog);
      await writeText(await getText(dialog, snap));
      toast('تم نسخ النص — ' + snap.bgh);
    } catch (e) { log(e); toast(errMsg(e), false); }
  }

  async function copyImageOnly(dialog) {
    try {
      const snap = snapshot(dialog);
      const blob = await getImage(dialog, snap);
      if (!blob) return toast('لا توجد صورة', false);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('تم نسخ الصورة — ' + snap.bgh);
    } catch (e) { log(e); toast(errMsg(e), false); }
  }

  async function copyBoth(dialog, btn) {
    const cur = getBgh(dialog);
    if (btn.dataset.step === '2' && btn.dataset.bgh !== cur) {
      btn.dataset.step = '';
      btn.textContent = '📋 صورة ثم نص';
    }
    if (btn.dataset.step === '2') {
      await copyTextOnly(dialog);
      btn.dataset.step = '';
      btn.textContent = '📋 صورة ثم نص';
      return;
    }
    try {
      const snap = snapshot(dialog);
      const blob = await getImage(dialog, snap);
      if (!blob) return toast('لا توجد صورة', false);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.dataset.step = '2';
      btn.dataset.bgh = snap.bgh;
      btn.textContent = '② انسخ النص الآن';
      toast('تم نسخ الصورة. الصقها ثم اضغط الزر للنص');
    } catch (e) { log(e); toast(errMsg(e), false); }
  }

  function makeBtn(text, color, handler) {
    const b = document.createElement('button');
    b.textContent = text; b.type = 'button';
    b.style.cssText =
      'margin:6px 4px;padding:8px 14px;border:0;border-radius:6px;cursor:pointer;' +
      'color:#fff;font-size:14px;background:' + color;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); handler(b); });
    return b;
  }

  function inject() {
    if (!document.body) return;
    document.querySelectorAll('[role="dialog"]').forEach(dialog => {
      if (dialog.dataset.hxCopy) return;
      if (!dialog.textContent.includes('مراجعة الحالة')) return;
      dialog.dataset.hxCopy = '1';

      const bar = document.createElement('div');
      bar.style.cssText = 'padding:4px 16px;text-align:center;';
      bar.appendChild(makeBtn('📋 صورة ثم نص', '#0b7285', b => copyBoth(dialog, b)));
      bar.appendChild(makeBtn('📝 نص فقط', '#2f9e44', () => copyTextOnly(dialog)));
      bar.appendChild(makeBtn('🖼 صورة فقط', '#6741d9', () => copyImageOnly(dialog)));

      const content = dialog.querySelector('.MuiDialogContent-root, [class*="DialogContent"]');
      if (content) content.prepend(bar);
      else dialog.firstElementChild?.appendChild(bar);

      let t2, last = '';
      new MutationObserver(() => {
        clearTimeout(t2);
        t2 = setTimeout(() => {
          const s = snapshot(dialog);
          const sig = s.bgh + '|' + s.src;
          if (sig !== last) { last = sig; prepare(dialog); }
        }, 60);
      }).observe(dialog, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
      prepare(dialog);
    });
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(inject, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
