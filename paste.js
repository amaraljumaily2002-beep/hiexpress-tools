/* HX_OK */
(function () {
  'use strict';

  document.addEventListener('paste', function (e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) return;
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const file = new File([blob], 'image-' + Date.now() + '.' + ext, { type: blob.type });

        const active = document.activeElement;
        let input = null;
        if (active) {
          const box = active.closest('.MuiInputBase-root');
          if (box && box.parentElement) {
            input = box.parentElement.querySelector('input[type="file"]');
          }
        }
        if (!input) input = document.querySelector('input[type="file"][accept="image/*"]');
        if (!input) return;

        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        e.preventDefault();
        break;
      }
    }
  }, true);
})();
