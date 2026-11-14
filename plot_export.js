// Plot: saving exported files from the web app (PDF / PNG of a sheet).
(function () {
  // zlib (RFC 1950) compression with the browser's native stream, as PDF's
  // FlateDecode expects. Falls back to null (the app then stores raw data).
  window.plotDeflate = async function (bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  };

  // Hands a file to the person: the share sheet on iPad / iPhone (Save to
  // Files, Mail, AirDrop…), otherwise a normal download. Must run inside a
  // tap. Resolves to 'shared', 'downloaded' or 'cancelled'.
  window.plotSaveFile = async function (bytes, name, mime) {
    const file = new File([bytes], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // Not allowed here (e.g. no user gesture): fall through to download.
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    return 'downloaded';
  };
})();
