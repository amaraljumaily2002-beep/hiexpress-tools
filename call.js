/* HX_OK */
(function () {
  'use strict';

  const PREFIX = ''; // بادئة الخروج في السنترال إن وجدت
  const phoneRegex = /^(\+?964|0)?7[3-9]\d{8}$/;

  function normalize(text) {
    let n = text.replace(/[\s\-().]/g, '');
    n = n.replace(/^\+?964/, '0');
    if (/^7\d{9}$/.test(n)) n = '0' + n;
    return n;
  }

  function isPhoneElement(el) {
    if (el.children.length > 0) return false;
    if (el.dataset.callReady) return false;
    const t = (el.textContent || '').trim().replace(/[\s\-().]/g, '');
    return phoneRegex.test(t);
  }

  function enhance(root) {
    root.querySelectorAll('span, p, div, td').forEach(el => {
      if (!isPhoneElement(el)) return;
      el.dataset.callReady = '1';
      const num = normalize(el.textContent);

      if (el.textContent.trim() !== num) el.textContent = num;

      el.style.cursor = 'pointer';
      el.style.color = '#0a7';
      el.style.textDecoration = 'underline';
      el.title = 'اضغط للاتصال بـ ' + num;
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = 'sip:' + PREFIX + num;
      });
    });
  }

  function start() {
    if (!document.body) return;
    enhance(document.body);
    let timer;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => enhance(document.body), 300);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
