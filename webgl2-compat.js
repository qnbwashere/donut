// Polyfill WebGL 2.0 context → WebGL 1.0 + extensions
// Eaglercraft 1.5.2 only uses: createVertexArray, bindVertexArray (OES_vertex_array_object)
// and drawBuffers (WEBGL_draw_buffers) — all available as WebGL 1.0 extensions.
(function () {
  var c = document.createElement('canvas');
  if (c.getContext('webgl2')) return; // WebGL 2 is natively supported, nothing to do

  var nativeGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    if (type !== 'webgl2') {
      return nativeGetContext.call(this, type, opts);
    }

    // Try to get WebGL 1 context
    var gl = nativeGetContext.call(this, 'webgl', opts)
          || nativeGetContext.call(this, 'experimental-webgl', opts);
    if (!gl) return null;

    // ── OES_vertex_array_object ──────────────────────────────────────────
    var vao = gl.getExtension('OES_vertex_array_object');
    if (vao) {
      gl.createVertexArray  = function ()    { return vao.createVertexArrayOES(); };
      gl.deleteVertexArray  = function (v)   { vao.deleteVertexArrayOES(v); };
      gl.bindVertexArray    = function (v)   { vao.bindVertexArrayOES(v); };
      gl.isVertexArray      = function (v)   { return vao.isVertexArrayOES(v); };
    } else {
      // Fallback no-ops so code doesn't crash
      gl.createVertexArray  = function ()    { return {}; };
      gl.deleteVertexArray  = function ()    {};
      gl.bindVertexArray    = function ()    {};
      gl.isVertexArray      = function ()    { return false; };
    }

    // ── WEBGL_draw_buffers ───────────────────────────────────────────────
    var db = gl.getExtension('WEBGL_draw_buffers');
    if (db) {
      gl.drawBuffers = function (bufs) { db.drawBuffersWEBGL(bufs); };
      // Expose extension constants on the context
      for (var k in db) {
        if (typeof db[k] === 'number' && !(k in gl)) {
          // Strip the _WEBGL suffix to match WebGL 2 names
          var wgl2name = k.replace(/_WEBGL$/, '');
          gl[wgl2name] = db[k];
          gl[k] = db[k];
        }
      }
    } else {
      gl.drawBuffers = function () {};
    }

    // ── WebGL 2 constants not available on WebGL 1 context object ────────
    if (!gl.READ_FRAMEBUFFER)         gl.READ_FRAMEBUFFER          = 0x8CA8;
    if (!gl.DRAW_FRAMEBUFFER)         gl.DRAW_FRAMEBUFFER          = 0x8CA9;
    if (!gl.RGBA8)                    gl.RGBA8                     = 0x8058;
    if (!gl.DEPTH24_STENCIL8)         gl.DEPTH24_STENCIL8          = 0x88F0;
    if (!gl.HALF_FLOAT)               gl.HALF_FLOAT                = 0x8D61;
    if (!gl.RG)                       gl.RG                        = 0x8227;
    if (!gl.RG8)                      gl.RG8                       = 0x822B;
    if (!gl.UNSIGNED_INT_24_8)        gl.UNSIGNED_INT_24_8         = 0x84FA;
    if (!gl.DEPTH_STENCIL_ATTACHMENT) gl.DEPTH_STENCIL_ATTACHMENT  = 0x821A;

    return gl;
  };
})();
