// Plot — importing files in the browser (picker and PDF pages).
// Plain JavaScript so the file dialog opens synchronously inside the tap
// (Safari on iPad only opens it during the user's gesture).
(function () {
  'use strict';

  // Opens the system file dialog. Resolves to {name, type, bytes} or null.
  window.plotPickFile = function (accept) {
    return new Promise(function (resolve, reject) {
      var old = document.getElementById('plot-file-input');
      if (old) old.remove();
      var input = document.createElement('input');
      input.type = 'file';
      input.id = 'plot-file-input';
      if (accept) input.accept = accept;
      // Kept in the page (not display:none): iPadOS needs a live element.
      input.style.cssText =
        'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(input);
      var settled = false;
      input.addEventListener('change', function () {
        if (settled) return;
        settled = true;
        var f = input.files && input.files[0];
        if (!f) { resolve(null); return; }
        var reader = new FileReader();
        reader.onload = function () {
          resolve({ name: f.name || '', type: f.type || '', bytes: new Uint8Array(reader.result) });
        };
        reader.onerror = function () { reject(new Error('read failed: ' + (reader.error && reader.error.message))); };
        reader.readAsArrayBuffer(f);
      });
      input.addEventListener('cancel', function () {
        if (!settled) { settled = true; resolve(null); }
      });
      input.click();
    });
  };

  var pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return Promise.resolve(pdfLib);
    return new Promise(function (resolve, reject) {
      var base = document.baseURI.replace(/[^/]*$/, '');
      var s = document.createElement('script');
      s.src = base + 'pdfjs/pdf.min.js';
      s.onload = function () {
        var lib = window.pdfjsLib;
        if (!lib) { reject(new Error('pdf.js missing')); return; }
        lib.GlobalWorkerOptions.workerSrc = base + 'pdfjs/pdf.worker.min.js';
        pdfLib = lib;
        resolve(lib);
      };
      s.onerror = function () { reject(new Error('pdf.js could not load')); };
      document.head.appendChild(s);
    });
  }

  var currentDoc = null;

  // Opens a PDF; resolves to its number of pages.
  window.plotPdfOpen = function (bytes) {
    return loadPdfJs().then(function (lib) {
      // pdf.js takes ownership of the buffer: give it a copy.
      return lib.getDocument({ data: bytes.slice(0) }).promise;
    }).then(function (doc) {
      if (currentDoc) currentDoc.destroy();
      currentDoc = doc;
      return doc.numPages;
    });
  };

  // Renders page n (1-based) on white; resolves to
  // {png, widthPt, heightPt, widthPx, heightPx}. maxSide bounds the
  // picture, and the area stays under iPadOS's canvas limit.
  window.plotPdfRender = function (n, maxSide) {
    if (!currentDoc) return Promise.reject(new Error('no PDF open'));
    return currentDoc.getPage(n).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      var scale = Math.min(
        maxSide / Math.max(vp1.width, vp1.height),
        Math.sqrt(16000000 / (vp1.width * vp1.height))
      );
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('page too large to draw')); return; }
            blob.arrayBuffer().then(function (buf) {
              var out = {
                png: new Uint8Array(buf),
                widthPt: vp1.width,
                heightPt: vp1.height,
                widthPx: canvas.width,
                heightPx: canvas.height
              };
              canvas.width = canvas.height = 0; // free memory on iPad
              resolve(out);
            }, reject);
          }, 'image/png');
        });
      });
    });
  };
})();
