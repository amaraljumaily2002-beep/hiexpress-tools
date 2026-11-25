// ocr.js - قراءة النص من الصور (Alt+Q)
(function (Tesseract, GM_setClipboard, GM_xmlhttpRequest) {
  'use strict';

  const ENABLED = true;   // غيّرها إلى false لإيقاف السكربت على كل الأجهزة
  if (!ENABLED) return;

  const HOTKEY = e => e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyQ';
  let mouseX = 0, mouseY = 0, worker = null, busy = false;

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
        onerror: reject
      });
    });
  }

  async function preprocess(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = bmp.width < 1200 ? 2 : 1;
    const c = document.createElement('canvas');
    c.width = bmp.width * scale;
    c.height = bmp.height * scale;
    const ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.2)';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  async function run() {
    if (busy) return;
    const img = imageUnderCursor();
    if (!img) return toast('لم أجد صورة تحت المؤشر');
    busy = true;
    try {
      toast('جاري قراءة النص...', 0);
      if (!worker) worker = await Tesseract.createWorker('ara+eng');
      const blob = await preprocess(await getBlob(img.src));
      const { data } = await worker.recognize(blob);
      const text = (data.text || '').trim();
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
})
