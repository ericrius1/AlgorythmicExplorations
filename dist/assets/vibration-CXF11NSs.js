import{i as R}from"./siteNav-B-J0B7W8.js";import{S as D,g as q,m as W}from"./demoShell-Btkj803W.js";import{g as I}from"./gpu-DBowy6aD.js";import{S as L}from"./shaderCanvas-B9soO7i5.js";import{s as O,G as F,m as N,O as P,f as V,u as A,c as z,g as X,X as Y,Y as j,n as B}from"./audio-C7YF5wtJ.js";const k=512,J=`
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${k-1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${k-1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let cycle = uf(4u);    // fraction of the view that one period occupies
  let on = uf(5u);
  var col = vec3f(0.0);

  // graph paper
  let gx = abs(fract(uv.x * 8.0) - 0.5);
  let gy = abs(fract(uv.y * 5.0) - 0.5);
  col += vec3f(0.05, 0.06, 0.10) * (glow(gx, 0.012) + glow(gy, 0.02)) * 0.5;
  col += vec3f(0.07, 0.08, 0.13) * glow(abs(uv.y - 0.5), 0.0025);

  // one-period brackets: the literal size of the repeating unit
  if (cycle > 0.015) {
    let m = fract(uv.x / cycle);
    let dm = min(m, 1.0 - m) * cycle;
    col += vec3f(0.45, 0.30, 0.10) * glow(dm, 0.0015) * smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y) * 0.6;
  }

  // the trace
  let y = 0.5 + sample(uv.x) * 0.34;
  let d = abs(uv.y - y);
  let c = mix(hsv(0.55, 0.5, 0.9), hsv(0.36, 0.6, 1.0), on);
  col += c * (glow(d, 0.0035) * 1.2 + halo(d, 0.005) * 0.4);

  return col * vignette(uv);
}
`;async function K(i){const w=await I(),a=new D(i,.5);if(!w)return q(i);const m=new L(w,a.canvas,J,k);O(i);let r=220,v="sine",d=!1;const x=new F(0).connect(N()),h=new P(r,"sine").connect(x),b=t=>{t!==d&&(d=t,t&&h.state!=="started"&&h.start(),x.gain.rampTo(t?.35:0,.1))},T=V(()=>{b(!1),u()});let C;const p=[],u=()=>{C.textContent=d?"■ stop":"▶ play";for(const[t,n]of p)n.style.borderColor=t===v?"var(--accent)":"var(--border)"};a.button("▶ play",()=>{A().then(()=>{b(!d),u()})}),C=a.controls.lastElementChild;for(const t of["sine","triangle","square","sawtooth"])a.button(t==="sawtooth"?"saw":t,()=>{v=t,h.type=t,u()}),p.push([t,a.controls.lastElementChild]);a.slider({label:"frequency",min:55,max:880,step:1,value:r,log:!0,format:t=>`${Math.round(t)} Hz`,onInput:t=>{r=t,h.frequency.rampTo(t,.03)}}),u(),a.setInfo(()=>`${z(r)} · period ${(1e3/r).toFixed(2)} ms · ${Math.round(r)} repeats per second`);const f=(t,n)=>{const s=n-Math.floor(n);switch(t){case"sine":return Math.sin(2*Math.PI*s);case"square":return s<.5?1:-1;case"sawtooth":return 2*s-1;case"triangle":return s<.5?4*s-1:3-4*s}};return{frame(){a.tick(),T.pulse();const t=X().sampleRate,n=k/t;if(m.uniforms[4]=1/r/n,m.uniforms[5]=d?1:0,d&&Y()){const s=j();let e=0;for(let o=1;o<s.length-k;o++)if(s[o-1]<=0&&s[o]>0){e=o;break}for(let o=0;o<k;o++)m.data[o]=s[Math.min(e+o,s.length-1)]*2}else{const s=r*n;for(let e=0;e<k;e++)m.data[e]=f(v,e/k*s)*.7}m.draw()},dispose(){b(!1)}}}const c=160,S=10,H=80,Q=`
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${c-1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${c-1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let grab = uf(4u);
  var col = vec3f(0.0);

  // anchor posts
  col += vec3f(0.18, 0.14, 0.10) * (glow(abs(uv.x - 0.04), 0.004) + glow(abs(uv.x - 0.96), 0.004))
       * smoothstep(0.18, 0.3, uv.y) * smoothstep(0.82, 0.7, uv.y);

  // first three mode shapes, ghosted, scaled by their live amplitudes
  let xs = clamp((uv.x - 0.04) / 0.92, 0.0, 1.0);
  for (var n = 1; n <= 3; n++) {
    let amp = D[${c}u + u32(n - 1)];
    let ym = 0.56 + sin(f32(n) * 3.14159265 * xs) * amp * 0.22 * sin(t * (1.0 + f32(n) * 0.3));
    col += hsv(0.6 + f32(n) * 0.07, 0.7, 0.8) * glow(abs(uv.y - ym), 0.002) * 0.25 * step(0.001, amp);
  }

  // the string itself
  if (uv.x > 0.03 && uv.x < 0.97) {
    let y = 0.56 + sample(xs) * 0.22;
    let d = abs(uv.y - y);
    let c = mix(hsv(0.09, 0.55, 1.0), hsv(0.13, 0.85, 1.0), grab);
    col += c * (glow(d, 0.0035) * 1.25 + halo(d, 0.005) * 0.4);
  }

  // modal recipe bars along the bottom
  for (var n = 0u; n < ${S}u; n++) {
    let amp = D[${c}u + n];
    let cx = 0.08 + (f32(n) + 0.5) * 0.05;
    let h = 0.02 + amp * 0.13;
    if (abs(uv.x - cx) < 0.016 && uv.y > 0.045 && uv.y < 0.045 + h) {
      col += hsv(0.6 + f32(n) * 0.055, 0.75, 0.9) * 0.8;
    }
    // harmonic number tick
    col += vec3f(0.1) * glow(length(uv - vec2f(cx, 0.035)), 0.0025);
  }

  return col * vignette(uv);
}
`;async function U(i){const w=await I(),a=new D(i,.52);if(!w)return q(i);const m=new L(w,a.canvas,Q,c+S);O(i,"drag the string, let go");let r=110;const v=[],d=[],x={t:-1},h=new Float32Array(S);for(let e=1;e<=S;e++){const o=new F(0).connect(N()),l=new P(r*e,"sine").connect(o);v.push(l),d.push(o)}const b=e=>3.2/(1+.45*(e-1)),T=()=>{for(const e of d)e.gain.cancelScheduledValues(B());for(const e of d)e.gain.rampTo(0,.1)},C=V(T),p=new Float32Array(c),u=new Float32Array(c);let f=-1;const t=()=>{let e=1e-6;for(let l=1;l<=S;l++){let g=0;for(let M=0;M<c;M++)g+=p[M]*Math.sin(l*Math.PI*M/(c-1));g=Math.abs(2*g/c),h[l-1]=g,e=Math.max(e,g)}const o=B();x.t=performance.now();for(let l=1;l<=S;l++){const g=d[l-1].gain,M=h[l-1]/e*.34/Math.sqrt(l);v[l-1].state!=="started"&&v[l-1].start(),g.cancelScheduledValues(o),g.setValueAtTime(Math.max(M,1e-4),o),g.exponentialRampToValueAtTime(1e-4,o+b(l)),g.linearRampToValueAtTime(0,o+b(l)+.05)}for(let l=0;l<S;l++)h[l]/=e},n=e=>Math.round((e-.04)/.92*(c-1));a.canvas.addEventListener("pointerdown",e=>{A(),e.preventDefault(),f=Math.max(2,Math.min(c-3,n(m.pointer.x)))});const s=()=>{f<0||(f=-1,t())};return a.canvas.addEventListener("pointerup",s),a.canvas.addEventListener("pointerleave",s),a.slider({label:"pitch",min:65,max:330,step:1,value:r,log:!0,format:e=>`${Math.round(e)} Hz`,onInput:e=>{r=e,v.forEach((o,l)=>o.frequency.rampTo(r*(l+1),.05))}}),a.button("pluck the middle",()=>{A();for(let e=0;e<c;e++)p[e]=.9*Math.min(e/(c/2),(c-1-e)/(c/2));u.fill(0),t()}),a.button("pluck near the bridge",()=>{A();const e=Math.floor(c*.92);for(let o=0;o<c;o++)p[o]=.9*(o<=e?o/e:(c-1-o)/(c-1-e));u.fill(0),t()}),a.setInfo(()=>`${z(r)} string · shown ${H}× slower than it sounds · drag it`),{frame(){a.tick(),C.pulse();const e=2*r/H,o=1/(c-1),l=.8*o/e,g=Math.max(1,Math.min(40,Math.round(1/60/l)));for(let E=0;E<g;E++){f>=0&&(p[f]=Math.max(-1,Math.min(1,(m.pointer.y-.56)/.22)),u[f]=0);const G=(e*l/o)**2;for(let y=1;y<c-1;y++)u[y]+=G*(p[y-1]-2*p[y]+p[y+1]),u[y]*=.99995;f>=0&&(u[f]=0);for(let y=1;y<c-1;y++)p[y]+=u[y]}m.data.set(p.subarray(0,c),0);const M=x.t<0?-1:(performance.now()-x.t)/1e3;for(let E=1;E<=S;E++)m.data[c+E-1]=M<0?0:h[E-1]*Math.exp(-3*M/b(E));m.uniforms[4]=f>=0?1:0,m.draw()},dispose(){T()}}}const $=8,Z=130.81,_=`
fn partial(n: f32, x: f32, t: f32) -> f32 {
  return sin(6.2831853 * n * (x * 2.0 - t * 0.22));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  var col = vec3f(0.0);
  col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - 0.5), 0.002);

  // the eight partials, faint, hue-coded by harmonic number
  var sum = 0.0;
  var norm = 0.05;
  for (var n = 0u; n < ${$}u; n++) {
    let a = D[n];
    norm += a;
  }
  for (var n = 0u; n < ${$}u; n++) {
    let a = D[n];
    let w = partial(f32(n + 1u), uv.x, t);
    sum += a * w;
    if (a > 0.01) {
      let yn = 0.5 + (a / norm) * w * 0.42;
      col += hsv(0.58 + f32(n) * 0.06, 0.8, 0.9) * glow(abs(uv.y - yn), 0.0016) * 0.45;
    }
  }

  // their sum: the waveform you hear
  let y = 0.5 + (sum / norm) * 0.42;
  let d = abs(uv.y - y);
  col += vec3f(1.0, 0.92, 0.75) * (glow(d, 0.0032) * 1.3 + halo(d, 0.0045) * 0.4);

  return col * vignette(uv);
}
`;async function tt(i){const w=await I(),a=new D(i,.5);if(!w)return q(i);const m=new L(w,a.canvas,_,$);O(i);const r=new Float32Array($);r[0]=1;const v=[],d=[];for(let t=1;t<=$;t++){const n=new F(0).connect(N());d.push(new P(Z*t,"sine").connect(n)),v.push(n)}let x=!1;const h=()=>{if(!x)return;let t=.05;for(let n=0;n<$;n++)t+=r[n];for(let n=0;n<$;n++)v[n].gain.rampTo(r[n]/t*.5,.06)},b=t=>{if(x=t,t){for(const n of d)n.state!=="started"&&n.start();h()}else for(const n of v)n.gain.rampTo(0,.12)},T=V(()=>{b(!1),p()});let C;const p=()=>{C.textContent=x?"■ stop":"▶ play C3"};a.button("▶ play C3",()=>{A().then(()=>{b(!x),p()})}),C=a.controls.lastElementChild;const u=[];for(let t=1;t<=$;t++){const n=a.slider({label:`h${t}${t===1?" (fundamental)":""}`,min:0,max:1,step:.01,value:r[t-1],onInput:s=>{r[t-1]=s,h()}});n.closest("label").classList.add("demo-slider-narrow"),u.push(n)}const f=(t,n)=>{a.button(t,()=>{for(let s=1;s<=$;s++)r[s-1]=n(s),u[s-1].value=String(r[s-1]),u[s-1].dispatchEvent(new Event("input"))})};return f("pure",t=>t===1?1:0),f("clarinet-ish (odd 1/n)",t=>t%2===1?1/t:0),f("sawtooth (1/n)",t=>1/t),f("mellow (1/n²)",t=>1/(t*t)),a.setInfo(()=>{const t=r.reduce((n,s)=>n+(s>.01?1:0),0);return`${t} partial${t===1?"":"s"} of C3 · same pitch, ${t===1?"no":"different"} flavour`}),{frame(){a.tick(),T.pulse(),m.data.set(r),m.draw()},dispose(){b(!1)}}}R();const et={oscillo:i=>K(i),string:i=>U(i),harmonics:i=>tt(i)};for(const i of document.querySelectorAll("[data-demo]")){const w=et[i.dataset.demo];w&&W(i,()=>w(i))}
