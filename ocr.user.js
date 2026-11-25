// ==UserScript==
// @name         Image OCR Copy (Alt+Q)
// @namespace    hiexpress-tools
// @version      2.0
// @description  ضع الماوس على أي صورة واضغط Alt+Q لنسخ النص منها
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      api.ocr.space
// @connect      *
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/amaraljumaily2002-beep/hiexpress-tools/main/ocr.user.js
// @downloadURL  https://raw.githubusercontent.com/amaraljumaily2002-beep/hiexpress-tools/main/ocr.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ENABLED  = true;          // false = إيقاف السكربت
  const API_KEY  = 'helloworld';  // استبدله بمفتاح مجاني من https://ocr.space/ocrapi/freekey
  const LANGUAGE = 'ara';         // ara = عربي (يقرأ الأرقام والإنجليزي أيضاً)
  const ENGINE   = '1';
  const HOTKEY   = e => e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyQ';

  if (!ENABLED) return;

  let mouseX = 0, mouseY = 0, busy = false;
  document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; }, true);

  function toast(msg, ms = 3000) {
    let t = document.getElementById('ocr-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ocr-toast';
      t.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;max-width:420px;' +
        'background:#222;color:#fff;padding:10px 14px;border-radius:8px;font:14px Tahoma,Arial;' +
        'direction:rtl;white-space:pre-wrap;box-shadow:0 2px 10px #0007;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._h);
    if (ms) t._h = setTimeout(() => (t.style.display = 'none'), ms);
  }

  function imageUnderCursor() {
    return document.elementsFromPoint(mouseX, mouseY).find(el => el.tagName === 'IMG' && el.src) || null;
  }

  function getBlob(src) {
    if (src.startsWith('blob:') || src.startsWith('data:')) return fetch(src).then(r => r.blob());
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: src, responseType: 'blob',
        onload: r => resolve(r.response),
        onerror: () => reject(new Error('تعذر تحميل الصورة'))
      });
    });
  }

  // تصغير وضغط الصورة لتصير أقل من 1MB (حد الخدمة المجانية)
  async function compress(blob) {
    const bmp = await createImageBitmap(blob);
    const maxSide = 2000;
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    let q = 0.9, out;
    do {
      out = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
      q -= 0.15;
    } while (out.size > 950 * 1024 && q > 0.3);
    return out;
  }

  function toDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  function ocr(dataUrl) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('apikey', API_KEY);
      fd.append('language', LANGUAGE);
      fd.append('OCREngine', ENGINE);
      fd.append('scale', 'true');
      fd.append('detectOrientation', 'true');
      fd.append('base64Image', dataUrl);
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.ocr.space/parse/image',
        data: fd,
        timeout: 40000,
        onload: r => {
          try {
            const j = JSON.parse(r.responseText);
            if (j.IsErroredOnProcessing) {
              const m = Array.isArray(j.ErrorMessage) ? j.ErrorMessage.join(' ') : j.ErrorMessage;
              return reject(new Error(m || 'خطأ من الخدمة'));
            }
            resolve(((j.ParsedResults || [])[0] || {}).ParsedText || '');
          } catch (e) { reject(new Error('رد غير مفهوم من الخدمة')); }
        },
        onerror: () => reject(new Error('فشل الاتصال بالخدمة')),
        ontimeout: () => reject(new Error('انتهت المهلة'))
      });
    });
  }

  async function run() {
    if (busy) return;
    const img = imageUnderCursor();
    if (!img) return toast('لم أجد صورة تحت المؤشر');
    busy = true;
    try {
      toast('جاري قراءة النص...', 0);
      const small = await compress(await getBlob(img.src));
      const text = (await ocr(await toDataURL(small))).trim();
      if (!text) return toast('لم يتم العثور على نص');
      GM_setClipboard(text, 'text');
      toast('تم النسخ ✅\n' + text.slice(0, 200) + (text.length > 200 ? '...' : ''), 4000);
    } catch (err) {
      console.error('[OCR]', err);
      toast('فشل: ' + (err.message || err), 5000);
    } finally {
      busy = false;
    }
  }

  window.addEventListener('keydown', e => {
    if (HOTKEY(e)) { e.preventDefault(); run(); }
  }, true);
})();
