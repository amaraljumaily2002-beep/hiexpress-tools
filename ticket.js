/* HX_OK */
(function () {
  'use strict';

  // ===== إعدادات =====
  const DRY_RUN = false;
  const DRIVER_PRIVATE = '1';
  const POLL_MS = 400;
  const FALLBACK_AFTER_REVIEW = 1200;
  const FALLBACK_AFTER_CLICK = 3000;
  const WAIT_MS = 2 * 60 * 1000;

  // ===== إعدادات زر "حالة مرفوضة" =====
  const REJ_TITLE = 'حالة خاطئة';
  const REJ_CATEGORY_ID = '11';       // مشكلة طلب
  const REJ_IS_PRIVATE = '1';         // التعليق خاص
  const REJ_DRIVER_PRIVATE = '0';     // 0 = ظاهر للمندوب، 1 = مخفي عن المندوب
  const DONE_STATUS_ID = 3;           // تم الإنجاز
  const REJ_MSG = [
    'كابتن من فضلك عند رفع اي حالة بالطلب < لا يرد - رفض - تأجيل ... ألخ > يرجى تثبيت الحالة بـ رسالة نصية داخل محادثة الزبون ليتم الموافقة على الحالة',
    ' مثال : { تم الوصول الى الزبون ورفض استلام الطلب }',
    ' تكون داخل محادثة الزبون على الواتساب او رسالة نصية ان لم يتوفر واتساب ليتم الموافقة على الحالة من قبلنا حسب تعليمات الشركة',
    'شاكرين تعاونكم معنا'
  ].join('\n');

  const API = 'https://api.hi-express.co/api/v2';
  const W = unsafeWindow;
  const log = (...a) => console.log('[HX3]', ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const toEn = s => (s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const norm = s => clean(toEn(s)).replace(/[أإآ]/g, 'ا').replace(/ـ/g, '').replace(/[:：]\s*$/, '').trim();
  const normC = s => norm(s).replace(/[\s\-–—]+$/, '');

  let AUTH = null;
  const idMap = {};

  function scan(o, depth) {
    depth = depth || 0;
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o)) { o.forEach(x => scan(x, depth + 1)); return; }
    if (o.order_identifier) {
      if (o.order_id) idMap[o.order_identifier] = o.order_id;
      else if (o.id && String(o.id).length >= 5) idMap[o.order_identifier] = o.id;
    }
    for (const k in o) scan(o[k], depth + 1);
  }

  const jobs = {};

  function markReviewDone() {
    Object.values(jobs).forEach(j => { if (j.state === 'waiting' && !j.reviewDoneAt) j.reviewDoneAt = Date.now(); });
  }

  const XP = W.XMLHttpRequest.prototype;
  const _open = XP.open, _setH = XP.setRequestHeader;
  XP.open = function (m, u) {
    this._hxUrl = String(u || '');
    this._hxM = String(m || '').toUpperCase();
    this.addEventListener('load', () => {
      try {
        if (/api\.hi-express\.co/.test(this._hxUrl)) {
          if (this._hxM === 'PUT' && /review/i.test(this._hxUrl) && this.status >= 200 && this.status < 300) markReviewDone();
          if (this.responseType !== 'blob' && this.responseType !== 'arraybuffer') {
            scan(this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
          }
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
    let method = 'GET', url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
      method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const h = (init && init.headers) || (input && input.headers);
      if (h) {
        const a = typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization);
        if (a) AUTH = a;
      }
    } catch (e) {}
    const p = _fetch.apply(this, arguments);
    try {
      if (/api\.hi-express\.co/.test(url)) {
        p.then(r => {
          if (method === 'PUT' && /review/i.test(url) && r.ok) markReviewDone();
          return r.clone().json().then(scan).catch(() => {});
        }).catch(() => {});
      }
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
          if (/token/i.test(store.key(i)) && v.length > 20 && v.length < 3000) return 'Bearer ' + v.replace(/^"|"$/g, '');
        }
      }
    } catch (e) {}
    return null;
  }

  function gm(method, url, opts) {
    opts = opts || {};
    const tok = findToken();
    if (!tok) return Promise.reject(new Error('NOTOKEN'));
    const headers = { Accept: 'application/json', Authorization: tok };
    let body;
    if (opts.json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
    if (opts.form) body = opts.form;
    return _fetch.call(W, url, { method, headers, body }).then(async r => {
      const txt = await r.text();
      if (!r.ok) throw new Error('HTTP' + r.status + ' ' + txt.slice(0, 200));
      let j = null;
      try { j = JSON.parse(txt); } catch (e) {}
      if (j && j.status === false) throw new Error('API: ' + (j.message || ''));
      return j;
    }).catch(e => {
      if (/^(HTTP|API|NOTOKEN)/.test(e.message)) throw e;
      throw new Error('NET: ' + e.message);
    });
  }

  function gmBlob(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob',
        onload: r => (r.status === 200 ? resolve(r.response) : reject(new Error('IMG HTTP ' + r.status))),
        onerror: () => reject(new Error('IMG NET'))
      });
    });
  }

  async function listTickets(orderId) {
    const j = await gm('GET', API + '/tickets/order/' + orderId);
    const d = j && j.data;
    return Array.isArray(d) ? d : (d ? [d] : []);
  }

  function toast(msg, ok = true, ms = 5000) {
    if (!document.body) return;
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:999999;' +
      'padding:10px 20px;border-radius:8px;color:#fff;font:14px sans-serif;max-width:90%;text-align:center;white-space:pre-line;' +
      'background:' + (ok ? '#25a37b' : '#d9534f');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function errMsg(e) {
    const m = (e && e.message) || String(e);
    if (m === 'NOTOKEN') return 'لم ألتقط توكن النظام. حدّث الصفحة (F5)';
    if (m === 'MISMATCH') return 'تذاكر الطلب لا تطابق الطلب الظاهر';
    if (m === 'MISMATCH_ORDER') return 'معرّف الطلب الداخلي لا يطابق الطلب الظاهر. انتظر تحميل القائمة وأعد الضغط';
    if (m === 'NOID') return 'لم أجد معرّف الطلب الداخلي. انتظر تحميل القائمة وأعد الضغط';
    return m;
  }

  function getValue(root, label) {
    const L = norm(label);
    for (const el of root.querySelectorAll('p, span, div, td, th, label, h6')) {
      if (el.children.length === 0 && norm(el.textContent) === L) {
        let sib = el.nextElementSibling;
        if (!sib && el.parentElement) sib = el.parentElement.nextElementSibling;
        if (sib) return clean(sib.textContent);
      }
    }
    return '';
  }
  const visibleDialogs = () =>
    [...document.querySelectorAll('[role="dialog"]')].filter(d => !d.closest('[aria-hidden="true"]'));
  const reviewDialog = () => visibleDialogs().find(d => d.textContent.includes('مراجعة الحالة'));

  function currentBtn(dialog) {
    return [...dialog.querySelectorAll('button')].find(b => /^[A-Z0-9]{3}\d{10,}$/.test(clean(b.textContent)));
  }
  function getBgh(dialog) { const b = currentBtn(dialog); return b ? clean(b.textContent) : ''; }
  function getReason(dialog) { return getValue(dialog, 'السبب') || getValue(dialog, 'الحالة المبلغ عنها'); }
  function getImgSrc(dialog) {
    const imgs = [...dialog.querySelectorAll('img')];
    const i = imgs.find(x => /amazonaws\.com/.test(x.src)) || imgs.sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
    return i ? i.src : '';
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

  const prep = {};
  function prefetch(dialog) {
    if (!HX.on()) return;
    const bgh = getBgh(dialog);
    if (!bgh || prep[bgh]) return;
    const orderId = idMap[bgh] || fiberOrderId(dialog);
    if (!orderId) return;
    const keys = Object.keys(prep);
    if (keys.length > 40) keys.slice(0, 20).forEach(k => delete prep[k]);
    const e = { orderId: String(orderId), ids: null };
    e.p = listTickets(orderId).then(list => {
      e.ids = list.map(t => t.id);
      e.identifier = list[0] && list[0].order_identifier;
      return e.ids;
    });
    e.p.catch(() => { if (prep[bgh] === e) delete prep[bgh]; });
    prep[bgh] = e;
  }

  let chain = Promise.resolve();
  const queue = fn => { chain = chain.then(fn).catch(e => log(e)); };

  function finish(job) {
    if (jobs[job.bgh] === job) delete jobs[job.bgh];
    renderPanel();
  }
  function cancelJob(bgh) {
    const j = jobs[bgh];
    if (j && j.state !== 'running') { j.cancelled = true; delete jobs[bgh]; renderPanel(); refreshAll(); }
  }

  const hasComment = (t, reason) =>
    (t.comments || []).some(c => !c.is_private && normC(c.comment) === normC(reason));

  function onToggle(dialog) {
    if (!HX.on()) return toast('هذه الأداة موقوفة من الإدارة', false);
    const bgh = getBgh(dialog);
    if (!bgh) return toast('لم أجد رقم الطلب', false);
    const cur = jobs[bgh];
    if (cur) {
      if (cur.state === 'running') return toast('جاري التنفيذ الآن', false);
      cancelJob(bgh);
      return;
    }
    const reason = getReason(dialog);
    if (!reason) return toast('لم أجد سبب الحالة', false);
    prefetch(dialog);
    const pe = prep[bgh];
    const orderId = (pe && pe.orderId) || idMap[bgh] || fiberOrderId(dialog);
    if (!orderId) return toast('لم أجد معرّف الطلب الداخلي. انتظر تحميل القائمة', false);
    const src = getImgSrc(dialog);

    const job = { bgh, orderId: String(orderId), reason, src, before: pe && pe.ids ? pe.ids : null, state: 'armed', ts: Date.now() };
    job.beforeP = (pe ? pe.p : listTickets(orderId).then(l => l.map(t => t.id)))
      .then(ids => { job.before = ids; })
      .catch(e => { job.beforeErr = e; });
    job.blobP = src ? gmBlob(src).then(b => ({ b }), e => ({ e })) : Promise.resolve({ b: null });
    jobs[bgh] = job;
    refreshAll();
    renderPanel();
  }

  function approveJob(bgh) {
    const job = jobs[bgh];
    if (!job || job.state !== 'armed') return;
    if (!HX.on()) { cancelJob(bgh); return toast('هذه الأداة موقوفة من الإدارة', false); }
    job.state = 'waiting';
    job.approvedAt = Date.now();
    refreshAll();
    renderPanel();
    watch(job);
  }

  async function watch(job) {
    await job.beforeP;
    if (job.beforeErr || !job.before) {
      toast('تعذر قراءة تذاكر الطلب ' + job.bgh + ': ' + errMsg(job.beforeErr) + '\nلم يُنفَّذ شيء', false, 10000);
      return finish(job);
    }
    const end = Date.now() + WAIT_MS;
    let fails = 0;
    while (Date.now() < end && !job.cancelled) {
      let list;
      try { list = await listTickets(job.orderId); fails = 0; }
      catch (e) {
        if (++fails >= 3) { toast('فشل فحص التذاكر: ' + errMsg(e), false, 10000); return finish(job); }
        await sleep(POLL_MS);
        continue;
      }
      if (job.cancelled) return;
      const fresh = list.filter(t => !job.before.includes(t.id));
      if (fresh.length) { queue(() => handle(job, fresh, false)); return; }
      const now = Date.now();
      const late = job.reviewDoneAt ? now - job.reviewDoneAt >= FALLBACK_AFTER_REVIEW
                                    : now - job.approvedAt >= FALLBACK_AFTER_CLICK;
      if (list.length && late) {
        const latest = list.slice().sort((a, b) => b.id - a.id)[0];
        queue(() => handle(job, [latest], true));
        return;
      }
      await sleep(POLL_MS);
    }
    if (!job.cancelled) {
      finish(job);
      toast('لا توجد أي تذكرة للطلب ' + job.bgh, false, 8000);
    }
  }

  async function handle(job, fresh, usedExisting) {
    if (job.cancelled) return;
    if (!HX.on()) { toast('هذه الأداة موقوفة من الإدارة. لم يُنفَّذ شيء', false); return finish(job); }
    job.state = 'running';
    renderPanel(); refreshAll();
    const doneSteps = [];
    let step = 'اختيار التذكرة';
    try {
      fresh.sort((a, b) => b.id - a.id);
      let t = null;
      for (const c of fresh) {
        if (c.order_identifier && c.order_identifier !== job.bgh) continue;
        if (fresh.length === 1 || confirm('ظهرت أكثر من تذكرة جديدة للطلب ' + job.bgh +
          '\n\nهل هذه هي التذكرة المقصودة؟\n#' + c.id + ' — ' + (c.title || '') +
          '\nأنشأها: ' + (c.created_by || '') + ' (' + (c.created_at || '') + ')')) { t = c; break; }
      }
      if (!t) throw new Error('لم تُحدَّد تذكرة');

      const need = {
        assign: !t.for_client,
        status: norm(t.ticket_status) !== norm('جديد'),
        comment: !hasComment(t, job.reason)
      };
      if (!need.assign && !need.status && !need.comment) {
        toast('التذكرة #' + t.id + ' مكتملة أصلاً. لم يُنفَّذ شيء');
        return;
      }

      if (DRY_RUN) {
        const plan = [];
        if (need.assign) plan.push('• تعيين للعميل');
        if (need.status) plan.push('• تغيير الحالة إلى جديد');
        if (need.comment) plan.push('• تعليق: "' + job.reason + '"' + (job.src ? ' مع الصورة' : ''));
        if (!confirm('تذكرة #' + t.id + ' — ' + (t.title || '') + '\nللطلب: ' + job.bgh +
          (usedExisting ? '\n(أحدث تذكرة موجودة)' : '') + '\n\n' + plan.join('\n') + '\n\nموافق؟')) {
          toast('أُلغي التنفيذ. لم يتغير شيء', false); return;
        }
      }

      let blob = null;
      if (need.comment && job.src) {
        step = 'جلب الصورة';
        const r = await job.blobP;
        if (r.e) throw r.e;
        blob = r.b;
      }

      if (need.assign) {
        step = 'تعيين للعميل';
        await gm('PUT', API + '/tickets/transfer/' + t.id,
          { json: { id: t.id, department_id: null, tagged_user_id: null, reminder_time: null, comment: '' } });
        doneSteps.push('التعيين للعميل');
      }
      if (need.status) {
        step = 'تغيير الحالة';
        await gm('PUT', API + '/tickets/status/' + t.id, { json: { ticket_status_id: 1 } });
        doneSteps.push('الحالة جديد');
      }
      if (need.comment) {
        step = 'إرسال التعليق';
        const fd = new FormData();
        fd.append('comment', job.reason);
        if (blob) {
          const m = (job.src.match(/\.(png|jpe?g|webp)/i) || [])[1];
          const ext = (m || 'png').toLowerCase().replace('jpeg', 'jpg');
          fd.append('attachment', blob, 'status.' + ext);
        }
        fd.append('ticket_id', String(t.id));
        fd.append('is_private', '0');
        fd.append('is_driver_private', DRIVER_PRIVATE);
        fd.append('is_send_to_jenni', '0');
        await gm('POST', API + '/comments', { form: fd });
        doneSteps.push('التعليق');
      }

      step = 'التحقق النهائي';
      const t2 = (await listTickets(job.orderId)).find(x => x.id === t.id);
      const bad = [];
      if (!t2) bad.push('تعذر قراءة التذكرة');
      else {
        if (!t2.for_client) bad.push('لم يتأكد التعيين للعميل');
        if (norm(t2.ticket_status) !== norm('جديد')) bad.push('الحالة ليست جديد');
        if (!hasComment(t2, job.reason)) bad.push('التعليق غير ظاهر');
      }
      if (bad.length) toast('⚠️ تذكرة #' + t.id + ' نُفِّذ: ' + doneSteps.join('، ') + '\nلكن: ' + bad.join('، ') + '\nراجعها يدوياً', false, 15000);
      else toast('✅ #' + t.id + ' — ' + doneSteps.join('، '), true, 4000);
    } catch (e) {
      log(e);
      toast('توقف عند: ' + step + ' — ' + errMsg(e) +
        (doneSteps.length ? '\nنُفِّذ قبل التوقف: ' + doneSteps.join('، ') : '\nلم يتغير شيء'), false, 15000);
    } finally {
      finish(job);
      refreshAll();
    }
  }

  // ===== زر "حالة مرفوضة": تذكرة جديدة دائماً + تعليق خاص ظاهر للمندوب + تم الإنجاز =====
  const rej = {};

  async function verifyOrderId(dialog, bgh) {
    const cands = [];
    if (idMap[bgh]) cands.push(String(idMap[bgh]));
    const f = fiberOrderId(dialog);
    if (f && !cands.includes(String(f))) cands.push(String(f));
    if (!cands.length) throw new Error('NOID');
    for (const id of cands) {
      const j = await gm('GET', API + '/order/' + id);
      const o = j && j.data && j.data[0];
      if (o && o.order_identifier === bgh) return id;
    }
    throw new Error('MISMATCH_ORDER');
  }

  async function onReject(dialog) {
    if (!HX.on()) return toast('هذه الأداة موقوفة من الإدارة', false);
    const bgh = getBgh(dialog);
    if (!bgh) return toast('لم أجد رقم الطلب', false);
    if (rej[bgh]) return toast('جاري التنفيذ الآن', false);
    rej[bgh] = true;
    refreshAll();
    const done = [];
    let step = 'التحقق من الطلب';
    try {
      const orderId = await verifyOrderId(dialog, bgh);

      step = 'إنشاء التذكرة';
      const fd = new FormData();
      fd.append('title', REJ_TITLE);
      fd.append('department_id', '');
      fd.append('tagged_user_id', '');
      fd.append('description', REJ_MSG);
      fd.append('order_id', orderId);
      fd.append('is_private', '1');
      fd.append('ticket_category_id', REJ_CATEGORY_ID);
      fd.append('problemable_type', '');
      fd.append('problemable_id', '');
      fd.append('client_id', '');
      fd.append('attachments', '');
      const j = await gm('POST', API + '/tickets', { form: fd });
      const t = j && j.data && j.data[0];
      if (!t || !t.id) throw new Error('لم أستلم رقم التذكرة من الخادم');
      done.push('إنشاء التذكرة #' + t.id);

      step = 'إضافة التعليق';
      const cf = new FormData();
      cf.append('comment', REJ_MSG);
      cf.append('ticket_id', String(t.id));
      cf.append('is_private', REJ_IS_PRIVATE);
      cf.append('is_driver_private', REJ_DRIVER_PRIVATE);
      cf.append('is_send_to_jenni', '0');
      await gm('POST', API + '/comments', { form: cf });
      done.push('التعليق');

      step = 'تحويل الحالة إلى تم الإنجاز';
      await gm('PUT', API + '/tickets/status/' + t.id, { json: { ticket_status_id: DONE_STATUS_ID } });
      done.push('تم الإنجاز');

      toast('✅ ' + bgh + ' — #' + t.id + ': ' + done.slice(1).join('، '), true, 4000);
    } catch (e) {
      log(e);
      toast('توقف عند: ' + step + ' — ' + errMsg(e) +
        (done.length ? '\nنُفِّذ قبل التوقف: ' + done.join('، ') + '\nراجع التذكرة يدوياً' : '\nلم يتغير شيء'), false, 15000);
    } finally {
      delete rej[bgh];
      refreshAll();
    }
  }

  // ===== الشريط المشترك بين copy.js و ticket.js =====
  // ترتيب الأزرار (من اليمين): 1 توجيه للعميل، 2 نص فقط، 3 صورة فقط، 4 حالة مرفوضة
  function getBar(dialog) {
    let bar = dialog.querySelector('[data-hx-bar]');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.setAttribute('data-hx-bar', '1');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:4px 16px;direction:rtl;';
    const content = dialog.querySelector('.MuiDialogContent-root, [class*="DialogContent"]');
    if (content) content.prepend(bar);
    else if (dialog.firstElementChild) dialog.firstElementChild.appendChild(bar);
    else return null;
    return bar;
  }

  function refreshBtn(dialog, b) {
    const j = jobs[getBgh(dialog)];
    let txt = '📨 توجيه للعميل', bg = '#e8590c';
    if (j) {
      if (j.state === 'armed') { txt = '✅ التوجيه مفعّل (اضغط للإلغاء)'; bg = '#2b8a3e'; }
      else if (j.state === 'waiting') { txt = '⏳ جاري التنفيذ...'; bg = '#1c7ed6'; }
      else { txt = '⚙️ جاري التنفيذ...'; bg = '#7048e8'; }
    }
    if (b.textContent !== txt) b.textContent = txt;
    if (b.style.background !== bg) b.style.background = bg;
  }

  function refreshRej(dialog, b) {
    const running = !!rej[getBgh(dialog)];
    const txt = running ? '⚙️ جاري الإرسال...' : '⛔ حالة مرفوضة';
    const bg = running ? '#7048e8' : '#c92a2a';
    if (b.textContent !== txt) b.textContent = txt;
    if (b.style.background !== bg) b.style.background = bg;
    b.disabled = running;
    b.style.opacity = running ? '0.7' : '1';
  }

  const BTN_CSS = 'margin:4px 0;padding:8px 14px;border:0;border-radius:6px;cursor:pointer;color:#fff;font-size:14px;';

  function makeBtn(dialog) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-hx3', '1');
    b.style.cssText = BTN_CSS;
    b.style.order = '1';
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onToggle(dialog); });
    return b;
  }

  function makeRejBtn(dialog) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-hx4', '1');
    b.style.cssText = BTN_CSS;
    b.style.order = '4';
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onReject(dialog); });
    return b;
  }

  function refreshAll() {
    document.querySelectorAll('[role="dialog"] button[data-hx3]').forEach(b => {
      const d = b.closest('[role="dialog"]');
      if (d) refreshBtn(d, b);
    });
    document.querySelectorAll('[role="dialog"] button[data-hx4]').forEach(b => {
      const d = b.closest('[role="dialog"]');
      if (d) refreshRej(d, b);
    });
  }

  function removeOwn() {
    document.querySelectorAll('button[data-hx3], button[data-hx4]').forEach(b => b.remove());
    document.querySelectorAll('[data-hx-bar]').forEach(bar => { if (!bar.children.length) bar.remove(); });
  }

  function inject() {
    if (!HX.on()) { removeOwn(); return; }
    document.querySelectorAll('[role="dialog"]').forEach(dialog => {
      if (!dialog.textContent.includes('مراجعة الحالة')) return;
      const bar = getBar(dialog);
      if (!bar) return;
      let b = bar.querySelector('button[data-hx3]');
      if (!b) { b = makeBtn(dialog); bar.appendChild(b); }
      let r = bar.querySelector('button[data-hx4]');
      if (!r) { r = makeRejBtn(dialog); bar.appendChild(r); }
      refreshBtn(dialog, b);
      refreshRej(dialog, r);
      prefetch(dialog);
    });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button');
    const dlg = b && b.closest('[role="dialog"]');
    if (!dlg || !dlg.textContent.includes('مراجعة الحالة')) return;
    const t = norm(b.textContent);
    if (t.startsWith('رفض')) cancelJob(getBgh(dlg));
    else if (t.startsWith('قبول')) approveJob(getBgh(dlg));
  }, true);
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName) || (e.target && e.target.isContentEditable)) return;
    const dlg = reviewDialog();
    if (!dlg) return;
    if (/^[rR]$/.test(e.key)) cancelJob(getBgh(dlg));
    else if (/^[aA]$/.test(e.key)) approveJob(getBgh(dlg));
  }, true);

  let panelSig = '';
  function renderPanel() {
    if (!document.body) return;
    const list = Object.values(jobs);
    let p = document.getElementById('hx3-panel');
    const sig = list.map(j => j.bgh + ':' + j.state).join('|');
    if (!list.length) { if (p) p.remove(); panelSig = ''; return; }
    if (p && sig === panelSig) return;
    panelSig = sig;
    if (!p) {
      p = document.createElement('div');
      p.id = 'hx3-panel';
      p.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:99998;background:#fff;border:2px solid #e8590c;' +
        'border-radius:10px;padding:8px 12px;font:13px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:340px;direction:rtl;';
      document.body.appendChild(p);
    }
    p.textContent = '';
    const h = document.createElement('div');
    h.style.cssText = 'font-weight:bold;margin-bottom:4px';
    h.textContent = '📨 توجيه للعميل';
    p.appendChild(h);
    const names = { armed: 'بانتظار قبولك', waiting: 'جاري التنفيذ', running: 'جاري التنفيذ' };
    list.forEach(j => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:3px 0;';
      const lb = document.createElement('span');
      lb.style.flex = '1';
      lb.textContent = j.bgh + ' — ' + names[j.state];
      row.appendChild(lb);
      if (j.state === 'armed') {
        const x = document.createElement('button');
        x.textContent = '×';
        x.style.cssText = 'border:0;background:#eee;border-radius:5px;padding:2px 8px;cursor:pointer;';
        x.onclick = () => cancelJob(j.bgh);
        row.appendChild(x);
      }
      p.appendChild(row);
    });
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; try { inject(); } catch (e) { log(e); } });
  }
  function start() {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
