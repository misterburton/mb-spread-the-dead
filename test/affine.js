// Minimal affine-material repro with GL-level interception: wraps the canvas
// getContext so we capture every shaderSource/compile/link/validate and dump
// the failing program's shaders.
const shaderSrc = new Map();   // WebGLShader -> {type, src}
const progShaders = new Map(); // WebGLProgram -> [shaders]
const origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attrs) {
  const gl = origGetContext.call(this, type, attrs);
  if (!gl || (type !== 'webgl2' && type !== 'webgl')) return gl;
  if (gl.__wrapped) return gl;
  gl.__wrapped = true;

  const origShaderSource = gl.shaderSource.bind(gl);
  gl.shaderSource = (sh, src) => {
    const rec = shaderSrc.get(sh) || {};
    rec.src = src;
    shaderSrc.set(sh, rec);
    return origShaderSource(sh, src);
  };
  const origCompile = gl.compileShader.bind(gl);
  gl.compileShader = (sh) => {
    origCompile(sh);
    const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
    const rec = shaderSrc.get(sh) || {};
    rec.ok = ok;
    rec.log = gl.getShaderInfoLog(sh);
    rec.type = gl.getShaderParameter(sh, gl.SHADER_TYPE);
    shaderSrc.set(sh, rec);
    if (!ok) console.info('[gl] COMPILE FAIL: ' + JSON.stringify({ log: rec.log, src: (rec.src ?? '').slice(0, 3500) }));
  };
  const origAttach = gl.attachShader.bind(gl);
  gl.attachShader = (prog, sh) => {
    if (!progShaders.has(prog)) progShaders.set(prog, []);
    progShaders.get(prog).push(sh);
    return origAttach(prog, sh);
  };
  const origLink = gl.linkProgram.bind(gl);
  gl.linkProgram = (prog) => {
    origLink(prog);
    const ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
    if (!ok) console.info('[gl] LINK FAIL: ' + gl.getProgramInfoLog(prog));
  };
  const origValidate = gl.validateProgram.bind(gl);
  gl.validateProgram = (prog) => {
    origValidate(prog);
    const ok = gl.getProgramParameter(prog, gl.VALIDATE_STATUS);
    if (!ok) {
      console.info('[gl] VALIDATE FAIL. programLog: "' + gl.getProgramInfoLog(prog) + '"');
      for (const sh of progShaders.get(prog) ?? []) {
        const rec = shaderSrc.get(sh) ?? {};
        const t = rec.type === 35633 ? 'VERT' : 'FRAG';
        console.info(`[gl] === ${t} (compile=${rec.ok}) ===\n` + (rec.src ?? '?'));
      }
    }
  };
  return gl;
};

const { mount } = await import('/test/affine-app.js');
mount();
