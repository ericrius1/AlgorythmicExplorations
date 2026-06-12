import{i as L}from"./siteNav-B-J0B7W8.js";import{S as j,g as D,m as G}from"./demoShell-Btkj803W.js";import{g as F}from"./gpu-DBowy6aD.js";import{S as C}from"./shaderCanvas-B9soO7i5.js";import{s as T,G as q,m as B,O as M,f as z,u as P,e as H,t as R,p as O}from"./audio-C7YF5wtJ.js";const x=220,U=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let delta = uf(4u);   // true detune in Hz
  let beatPhase = uf(5u);
  var col = vec3f(0.0);
  col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - 0.5), 0.002);

  // draw at a visual scale: ~6 cycles of tone A across the screen.
  // The spatial interference pattern is exact; the throb pulses at the
  // *true* beat rate via beatPhase.
  let cyc = 6.0;
  let ratio = (f32(${x}) + delta) / f32(${x});
  let ph = t * 0.35;
  let wA = sin(6.2831853 * (cyc * uv.x - ph));
  let wB = sin(6.2831853 * (cyc * ratio * uv.x - ph * ratio) + beatPhase);
  let sum = (wA + wB) * 0.5;

  let yA = 0.5 + wA * 0.10;
  let yB = 0.5 + wB * 0.10;
  col += hsv(0.58, 0.7, 0.8) * glow(abs(uv.y - yA), 0.0016) * 0.4;
  col += hsv(0.08, 0.7, 0.8) * glow(abs(uv.y - yB), 0.0016) * 0.4;

  let y = 0.5 + sum * 0.34;
  let pulse = 0.75 + 0.25 * cos(beatPhase);
  col += vec3f(1.0, 0.95, 0.8) * (glow(abs(uv.y - y), 0.003) * 1.2 + halo(abs(uv.y - y), 0.0045) * 0.35) * pulse;

  // envelope: |cos| of half the difference, the skin the sum lives inside
  let env = abs(cos(3.14159265 * (ratio - 1.0) * cyc * uv.x * 0.5 + beatPhase * 0.5)) * 0.34 + 0.001;
  col += hsv(0.13, 0.9, 0.9) * (glow(abs(uv.y - (0.5 + env)), 0.0014) + glow(abs(uv.y - (0.5 - env)), 0.0014)) * 0.5;

  return col * vignette(uv);
}
`;async function V(l){const g=await F(),r=new j(l,.5);if(!g)return D(l);const u=new C(g,r.canvas,U,4);T(l);let n=3,h=!1;const o=new q(0).connect(B()),m=new M(x,"sine").connect(o),d=new M(x+n,"sine").connect(o),p=s=>{h=s,s?(m.state!=="started"&&(m.start(),d.start()),o.gain.rampTo(.3,.15)):o.gain.rampTo(0,.15)},$=z(()=>{p(!1),b()});let w;const b=()=>{w.textContent=h?"■ stop":"▶ play both"};r.button("▶ play both",()=>{P().then(()=>{p(!h),b()})}),w=r.controls.lastElementChild,r.slider({label:"detune",min:-40,max:40,step:.1,value:n,format:s=>`${s>=0?"+":""}${s.toFixed(1)} Hz`,onInput:s=>{n=s,d.frequency.rampTo(x+n,.03)}}),r.setInfo(()=>{const s=Math.abs(n),a=Math.abs(H((x+n)/x)).toFixed(0),e=s<.2?"unison — one steady tone":s<8?`beating ${s.toFixed(1)}× per second`:s<25?"too fast to count — roughness":"splitting into two notes";return`220 Hz + ${(x+n).toFixed(1)} Hz (${a}¢ apart) · ${e}`});let E=0,y=performance.now();return{frame(){r.tick(),$.pulse();const s=performance.now();E+=2*Math.PI*n*((s-y)/1e3),y=s,u.uniforms[4]=n,u.uniforms[5]=E%(2*Math.PI*1e3),u.draw()},dispose(){p(!1)}}}const A=480,I=220,X=8,v=[{r:1,label:"1:1",name:"unison"},{r:9/8,label:"9:8",name:"major second"},{r:6/5,label:"6:5",name:"minor third"},{r:5/4,label:"5:4",name:"major third"},{r:4/3,label:"4:3",name:"perfect fourth"},{r:3/2,label:"3:2",name:"perfect fifth"},{r:5/3,label:"5:3",name:"major sixth"},{r:2,label:"2:1",name:"octave"}],J=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.5;

  // frame: the unit square the figure lives in
  let fr = max(abs(q.x), abs(q.y));
  col += vec3f(0.05, 0.06, 0.11) * glow(abs(fr - 1.04), 0.006);

  var d = 1e9;
  var hueAt = 0.0;
  for (var i = 0u; i < ${A-1}u; i++) {
    let a = vec2f(D[i * 2u], D[i * 2u + 1u]);
    let b = vec2f(D[i * 2u + 2u], D[i * 2u + 3u]);
    let di = sdSeg(q, a, b);
    if (di < d) {
      d = di;
      hueAt = f32(i) / f32(${A});
    }
  }
  let hue = 0.52 + hueAt * 0.35;
  col += hsv(hue, 0.65, 1.0) * (glow(d, 0.006) * 1.15 + halo(d, 0.008) * 0.45);

  // the moving dot — "now"
  let headI = u32(fract(t * 0.21) * f32(${A-1})) * 2u;
  let head = vec2f(D[headI], D[headI + 1u]);
  col += vec3f(1.0, 0.95, 0.85) * glow(length(q - head), 0.018) * 1.4;

  return col * vignette(uv);
}
`;async function Q(l,g={}){const r=g.mode==="hero",u=await F(),n=new j(l,r?.42:.62);if(!u)return D(l);const h=new C(u,n.canvas,J,A*2);T(l,r?"tap to hear the interval":"tap for sound");let o=3/2,m=o,d=!1;const p=new q(0).connect(B()),$=new M(I,"sine").connect(p),w=new M(I*o,"sine").connect(p),b=a=>{d=a,a?($.state!=="started"&&($.start(),w.start()),p.gain.rampTo(.28,.2)):p.gain.rampTo(0,.2)},E=z(()=>b(!1)),y=a=>{o=a,w.frequency.rampTo(I*a,.05)};if(r){n.canvas.addEventListener("pointerdown",()=>{P().then(()=>b(!d))});let a=5;window.setInterval(()=>{a=(a+1)%v.length,y(v[a].r)},7e3)}else{n.button("▶ play interval",()=>{P().then(()=>b(!d))});const a=n.controls.lastElementChild;window.setInterval(()=>a.textContent=d?"■ stop":"▶ play interval",300);let e;e=n.slider({label:"frequency ratio",min:1,max:2.05,step:5e-4,value:o,format:t=>t.toFixed(4),onInput:t=>y(t)});for(const t of v)n.button(t.label,()=>{y(t.r),e.value=String(t.r),e.dispatchEvent(new Event("input"))})}n.setInfo(()=>{const a=v.find(t=>Math.abs(H(o/t.r))<4),e=a?`${a.label} — ${a.name}, the figure closes`:`${o.toFixed(4)} — irrational territory, the figure precesses`;return`${I} Hz × ${(I*o).toFixed(1)} Hz · ${e}`});let s=0;return{frame(){n.tick(),E.pulse(),s+=.0035,m+=(o-m)*.08;for(let a=0;a<A;a++){const e=a/(A-1)*X;h.data[a*2]=Math.sin(2*Math.PI*e+s)*.96,h.data[a*2+1]=Math.sin(2*Math.PI*m*e)*.96}h.draw()},dispose(){b(!1)}}}const f=165,i=8,c=256,S=2.05,Y=4.4,_=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let marker = uf(4u);
  let rough = uf(5u);
  var col = vec3f(0.0);

  // ---- bottom: the dissonance landscape (y in 0 .. 0.42) ----
  if (uv.y < 0.46) {
    let yy = uv.y / 0.42;
    let f = clamp(uv.x, 0.0, 1.0) * f32(${c-1});
    let i = u32(floor(f));
    let curve = mix(D[i], D[min(i + 1u, ${c-1}u)], fract(f));
    // filled mountain
    if (yy < curve) {
      col += mix(vec3f(0.05, 0.04, 0.10), vec3f(0.45, 0.08, 0.12), yy / max(curve, 0.01)) * 0.8;
    }
    col += hsv(0.02, 0.85, 1.0) * glow(abs(yy - curve) * 0.42, 0.004) * 0.9;
    // just-interval guides: the valleys have names
    for (var k = 0u; k < 8u; k++) {
      let gx = D[${c+2*i}u + k];
      col += vec3f(0.25, 0.5, 0.9) * glow(abs(uv.x - gx), 0.0012) * smoothstep(0.46, 0.0, uv.y) * 0.5;
    }
    // current position
    col += vec3f(1.0, 0.8, 0.4) * glow(abs(uv.x - marker), 0.002) * smoothstep(0.46, 0.0, uv.y);
  }

  // ---- top: the two harmonic combs (y in 0.5 .. 1.0) ----
  if (uv.y > 0.48) {
    let mid = 0.74;
    col += vec3f(0.06, 0.07, 0.12) * glow(abs(uv.y - mid), 0.0018);
    // tone A teeth point up, tone B teeth point down
    for (var k = 0u; k < ${i}u; k++) {
      let amp = 1.0 / f32(k + 1u);
      let ax = D[${c}u + k];
      let bx = D[${c+i}u + k];
      let alen = 0.05 + amp * 0.16;
      let blen = 0.05 + amp * 0.16;
      if (uv.y > mid && uv.y < mid + alen) {
        col += hsv(0.58, 0.75, 1.0) * glow(abs(uv.x - ax), 0.0018) * (0.4 + amp);
      }
      if (uv.y < mid && uv.y > mid - blen) {
        col += hsv(0.09, 0.8, 1.0) * glow(abs(uv.x - bx), 0.0018) * (0.4 + amp);
      }
    }
    // pairwise verdicts on the centre line: fusion flares, fights pulse
    for (var i = 0u; i < ${i}u; i++) {
      for (var j = 0u; j < ${i}u; j++) {
        let ax = D[${c}u + i];
        let bx = D[${c+i}u + j];
        let sep = abs(ax - bx);
        if (sep < 0.022) {
          let amp = 1.0 / f32(i + 1u) * 1.0 / f32(j + 1u);
          let x = (ax + bx) * 0.5;
          let d = length(vec2f((uv.x - x) * uf(1u), (uv.y - mid)));
          let fuse = smoothstep(0.004, 0.0, sep);   // dead-on: white star
          let fight = smoothstep(0.0, 0.004, sep) * smoothstep(0.022, 0.008, sep); // near miss: red throb
          col += vec3f(1.0, 0.97, 0.9) * glow(d, 0.012) * fuse * amp * 2.2;
          col += vec3f(1.0, 0.15, 0.1) * glow(d, 0.014) * fight * amp * (1.6 + 1.2 * sin(t * 9.0)) * 1.4;
        }
      }
    }
  }

  // roughness meter tint: the whole frame blushes when it hurts
  col += vec3f(0.10, 0.0, 0.02) * rough * (0.5 + 0.5 * sin(t * 7.0));
  return col * vignette(uv);
}
`;async function K(l){const g=await F(),r=new j(l,.6);if(!g)return D(l);const u=new C(g,r.canvas,_,c+2*i+8);T(l);let n=1e-9;const h=new Float32Array(c);for(let e=0;e<c;e++){const t=1+e/(c-1)*(S-1);h[e]=R(f,f*t,i),n=Math.max(n,h[e])}for(let e=0;e<c;e++)u.data[e]=h[e]/n*.92+.04;for(let e=0;e<8;e++)u.data[c+2*i+e]=(v[e].r-1)/(S-1);let o=3/2,m=!1;const d=new q(0).connect(B()),p=e=>{const t=new M(e,"sine").connect(d);return t.partials=Array.from({length:i},(k,N)=>1/(N+1)),t},$=p(f),w=p(f*o),b=e=>{m=e,e?($.state!=="started"&&($.start(),w.start()),d.gain.rampTo(.22,.15)):d.gain.rampTo(0,.15)},E=z(()=>b(!1));r.button("▶ play",()=>{P().then(()=>b(!m))});const y=r.controls.lastElementChild;window.setInterval(()=>y.textContent=m?"■ stop":"▶ play",300);const s=r.slider({label:"interval (ratio)",min:1,max:S,step:5e-4,value:o,format:e=>e.toFixed(4),onInput:e=>{o=e,w.frequency.rampTo(f*o,.04)}});for(const e of[v[0],v[2],v[3],v[4],v[5],v[7]])r.button(e.label,()=>{s.value=String(e.r),s.dispatchEvent(new Event("input"))});r.button("tritone-ish",()=>{s.value=String(Math.SQRT2),s.dispatchEvent(new Event("input"))}),r.setInfo(()=>{const e=R(f,f*o,i)/n,t=v.find(k=>Math.abs(H(o/k.r))<5);return`${t?`${t.label} ${t.name}`:`ratio ${o.toFixed(3)}`} · roughness ${(e*100).toFixed(0)}%`});const a=e=>Math.log2(e/f)/Y+.02;return{frame(){r.tick(),E.pulse();for(let t=0;t<i;t++)u.data[c+t]=a(f*(t+1)),u.data[c+i+t]=a(f*o*(t+1));u.uniforms[4]=(o-1)/(S-1);let e=0;for(let t=1;t<=i;t++)for(let k=1;k<=i;k++)e+=O(f*t,1/t,f*o*k,1/k);u.uniforms[5]=m?Math.min(e/n*.9,1):0,u.draw()},dispose(){b(!1)}}}L();const W={beats:l=>V(l),lissajous:l=>Q(l),comb:l=>K(l)};for(const l of document.querySelectorAll("[data-demo]")){const g=W[l.dataset.demo];g&&G(l,()=>g(l))}
