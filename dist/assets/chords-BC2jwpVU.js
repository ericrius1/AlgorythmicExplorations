import{g as _,S as X,a as Z,i as re,m as ie}from"./gpu-DqzAFztT.js";import{S as ee,s as te,a as F,m as G,f as se,u as A,n as le,b as M,N as oe,c as ce}from"./audio-DykZGtJ8.js";import{P as ne}from"./PolySynth-DlAqbwDN.js";import{R as ue}from"./Reverb-bbDhZKFc.js";const K=new Set([1,3,6,8,10]);class fe{el;keys=new Map;constructor(l){this.el=document.createElement("div"),this.el.className="piano";const t=[];for(let e=l.low;e<=l.high;e++)K.has(e%12)||t.push(e);const r=100/t.length;t.forEach((e,c)=>{const o=document.createElement("div");o.className="piano-key piano-white",o.style.left=`${c*r}%`,o.style.width=`${r}%`,this.wire(o,e,l),this.el.appendChild(o),this.keys.set(e,o)}),t.forEach((e,c)=>{const o=e+1;if(o>l.high||!K.has(o%12))return;const h=document.createElement("div");h.className="piano-key piano-black",h.style.left=`${(c+.68)*r}%`,h.style.width=`${r*.64}%`,this.wire(h,o,l),this.el.appendChild(h),this.keys.set(o,h)})}wire(l,t,r){l.addEventListener("pointerdown",e=>{e.preventDefault(),r.onPress(t)})}setHeld(l,t=-1){for(const[r,e]of this.keys)e.classList.toggle("is-held",l.includes(r)&&r!==t),e.classList.toggle("is-root",r===t)}}const q=6,he=130.81,z=[{name:"major",iv:[0,4,7],story:"4:5:6 — a slice of one harmonic series"},{name:"minor",iv:[0,3,7],story:"10:12:15 — same intervals, weaker anchor"},{name:"diminished",iv:[0,3,6],story:"no simple lattice — pure instability"},{name:"augmented",iv:[0,4,8],story:"perfectly symmetric — no home, no root"},{name:"sus4",iv:[0,5,7],story:"6:8:9 — the third withheld, neither happy nor sad"},{name:"dom7",iv:[0,4,7,10],story:"major plus a tritone inside — the engine of part five"},{name:"maj7",iv:[0,4,7,11],story:"8:10:12:15 — soft dissonance worn as perfume"},{name:"min7",iv:[0,3,7,10],story:"10:12:15:18 — minor with the edges sanded"}],me=`
fn xOf(f: f32) -> f32 {
  return log2(f / ${he}) / 4.6 + 0.04;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let count = u32(uf(8u));
  let strike = uf(9u);
  var col = vec3f(0.0);

  let mid = 0.36;
  col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - mid), 0.0018);

  // each voice: its ladder of partials rising from the axis
  for (var v = 0u; v < 4u; v++) {
    if (v >= count) { break; }
    let f = uf(4u + v);
    let hue = 0.56 + f32(v) * 0.09;
    for (var k = 0u; k < ${q}u; k++) {
      let amp = 1.0 / f32(k + 1u);
      let x = xOf(f * f32(k + 1u));
      let len = 0.06 + amp * 0.30;
      if (uv.y > mid && uv.y < mid + len && abs(uv.x - x) < 0.01) {
        col += hsv(hue, 0.7, 1.0) * glow(abs(uv.x - x), 0.0019) * (0.35 + amp) * (0.7 + strike * 0.6);
      }
    }
    // the fundamental, marked below the axis
    col += hsv(hue, 0.6, 1.0) * glow(length(vec2f((uv.x - xOf(f)) * uf(1u), (uv.y - mid + 0.07) )), 0.014) * 0.9;
  }

  // handshakes and collisions between every pair of voices
  for (var a = 0u; a < 4u; a++) {
    for (var b = a + 1u; b < 4u; b++) {
      if (b >= count) { continue; }
      let fa = uf(4u + a);
      let fb = uf(4u + b);
      for (var i = 1u; i <= ${q}u; i++) {
        for (var j = 1u; j <= ${q}u; j++) {
          let xa = xOf(fa * f32(i));
          let xb = xOf(fb * f32(j));
          let sep = abs(xa - xb);
          if (sep < 0.016) {
            let amp = 1.0 / (f32(i) * f32(j));
            let x = (xa + xb) * 0.5;
            let d = length(vec2f((uv.x - x) * uf(1u), (uv.y - 0.84) * 2.0));
            let fuse = smoothstep(0.0035, 0.0, sep);
            let fight = smoothstep(0.0, 0.0035, sep) * smoothstep(0.016, 0.007, sep);
            col += vec3f(1.0, 0.97, 0.88) * glow(d, 0.014) * fuse * amp * 2.6;
            col += vec3f(1.0, 0.2, 0.12) * glow(d, 0.016) * fight * amp * (1.3 + sin(t * 8.0)) * 1.5;
          }
        }
      }
    }
  }

  return col * vignette(uv);
}
`;async function ve(a){const l=await _(),t=new X(a,.5);if(!l)return Z(a);const r=new ee(l,t.canvas,me,4);te(a,"click a key below");let e=48,c=z[0],o=0;const h=new ne(F,{oscillator:{type:"triangle"},envelope:{attack:.02,decay:.6,sustain:.35,release:1.2},volume:-12}).connect(G()),C=se(()=>h.releaseAll()),y=()=>c.iv.map(u=>e+u),g=new fe({low:48,high:72,onPress:u=>{e=u,A().then(R)}});t.controls.before(g.el);let b=0;const R=()=>{if(performance.now()-b>400)return;o=1,h.releaseAll();const u=le();y().forEach((n,w)=>{h.triggerAttackRelease(M(n),2.2,u+w*.02)}),g.setHeld(y(),e)},k=[];return z.forEach((u,n)=>{t.button(u.name,()=>{c=z[n],k.forEach((w,N)=>w.style.borderColor=N===n?"var(--accent)":"var(--border)"),A().then(R)}),k.push(t.controls.lastElementChild)}),k[0].style.borderColor="var(--accent)",t.setInfo(()=>`${oe[e%12]} ${c.name} · ${c.story}`),g.setHeld(y(),e),{frame(){t.tick(),C.pulse(),b=performance.now(),o*=.96;const u=y();for(let n=0;n<4;n++)r.uniforms[4+n]=n<u.length?M(u[n]):0;r.uniforms[8]=u.length,r.uniforms[9]=o,r.draw()},dispose(){h.releaseAll()}}}const p=96,Q=16,i=(a,l,t,r)=>({label:a,root:l,iv:t,tension:r}),m=[0,4,7],L=[0,3,7],H=[0,4,7,10],U=[{name:"I–IV–V–I",chords:[i("I",0,m,.08),i("IV",5,m,.4),i("V",7,H,.9),i("I",0,m,.08)],blurb:"the three-chord trick: home, away, bowstring, home"},{name:"I–V–vi–IV",chords:[i("I",0,m,.08),i("V",7,m,.75),i("vi",9,L,.45),i("IV",5,m,.4)],blurb:"the pop loop — tension never fully spent, so it cycles forever"},{name:"ii–V–I",chords:[i("ii",2,L,.45),i("V7",7,H,.92),i("I",0,m,.08),i("I",0,m,.08)],blurb:"jazz's handshake: approach the bowstring by a fifth, then release"},{name:"i–VI–III–VII",chords:[i("i",0,L,.25),i("VI",8,m,.4),i("III",3,m,.5),i("VII",10,m,.65)],blurb:"the minor anthem loop — sadness with momentum"},{name:"deceptive: I–IV–V–vi",chords:[i("I",0,m,.08),i("IV",5,m,.4),i("V7",7,H,.92),i("vi",9,L,.55)],blurb:"the V promises home and hands you the relative minor instead"}],de=`
fn voiceY(v: u32, x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${p-1});
  let i = u32(floor(f));
  return mix(D[v * ${p}u + i], D[v * ${p}u + min(i + 1u, ${p-1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let head = uf(4u);
  let pulse = uf(5u);
  var col = vec3f(0.0);

  // chord boundaries
  for (var k = 0u; k < 5u; k++) {
    let x = f32(k) * 0.25;
    col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.x - x), 0.0012) * step(0.2, uv.y);
  }

  // tension lane
  if (uv.y < 0.16) {
    let seg = min(u32(uv.x * 4.0), 3u);
    let tn = D[${4*p}u + seg];
    let h = tn * 0.13;
    if (uv.y < h + 0.015) {
      col += mix(vec3f(0.1, 0.3, 0.25), vec3f(1.0, 0.45, 0.1), tn) * (0.3 + 0.4 * smoothstep(h + 0.015, h - 0.04, uv.y));
    }
  }

  // the four threads: bass low and warm, three voices cool
  for (var v = 0u; v < 4u; v++) {
    let y = voiceY(v, uv.x);
    let d = abs(uv.y - y);
    let isBass = f32(v == 0u);
    let hue = mix(0.52 + f32(v) * 0.06, 0.08, isBass);
    let near = exp(-pow((uv.x - head) * 9.0, 2.0)) * pulse;
    col += hsv(hue, 0.6, 1.0) * (glow(d, 0.003 + isBass * 0.0015) * (0.7 + near * 1.2) + halo(d, 0.004) * 0.25);
  }

  // playhead
  col += vec3f(1.0, 0.95, 0.85) * glow(abs(uv.x - head), 0.0022) * (0.5 + pulse * 0.6);

  return col * vignette(uv);
}
`;async function W(a,l={}){const t=l.mode==="hero",r=await _(),e=new X(a,t?.42:.56);if(!r)return Z(a);const c=new ee(r,e.canvas,de,4*p+4);te(a,t?"tap to start the band":"tap for sound");let o=U[t?1:0];const h=new ue({decay:2.8,wet:.3}).connect(G()),C=new ne(F,{oscillator:{type:"triangle"},envelope:{attack:.06,decay:.4,sustain:.5,release:1.4},volume:-14}).connect(h),y=new F({oscillator:{type:"sine"},envelope:{attack:.02,decay:.3,sustain:.4,release:.5},volume:-10}).connect(G()),g=s=>{const f=[];let v=[60,64,67];for(const d of s){const x=d.iv.map(B=>(d.root+B)%12).slice(0,3);let I=null,$=1e9;const O=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];for(const B of O){const D=v.map((E,T)=>{const j=x[B[T]];let S=j+12*Math.round((E-j)/12);for(;S<55;)S+=12;for(;S>79;)S-=12;return S}),ae=new Set(D.map(E=>E%12)).size,J=D.reduce((E,T,j)=>E+Math.abs(T-v[j]),0)+(3-ae)*9;J<$&&($=J,I=D)}v=I,f.push([36+d.root+(d.root>7?0:12),...v])}return f};let b=g(o.chords);const R=s=>.2+(s-36)/48*.74,k=()=>{for(let s=0;s<4;s++)for(let f=0;f<p;f++){const v=f/(p-1),d=Math.min(Math.floor(v*4),3),V=v*4-d,x=b[d][s],I=b[(d+1)%4][s],$=V<.85?0:(V-.85)/.15,O=$*$*(3-2*$);c.data[s*p+f]=R(x+(I-x)*O)}for(let s=0;s<4;s++)c.data[4*p+s]=o.chords[s].tension};k();let u=0;const n=new ce(t?72:84,1,(s,f)=>{const v=s%Q,d=Math.floor(v/4);if(v%4===0){const[V,...x]=b[d];for(const I of x)C.triggerAttackRelease(M(I),3.3,f);y.triggerAttackRelease(M(V),1.6,f),u=1}else v%4===2&&y.triggerAttackRelease(M(b[d][0]),.8,f)}),w=()=>{n.stop(),C.releaseAll()},N=se(w),Y=()=>{n.isRunning?w():n.start()};if(t)e.canvas.addEventListener("pointerdown",()=>{A().then(Y)});else{e.button("▶ play / stop",()=>{A().then(Y)});for(const s of U)e.button(s.name,()=>{o=s,b=g(o.chords),k(),A().then(()=>{n.isRunning||n.start()})});e.slider({label:"tempo",min:56,max:132,step:1,value:n.bpm,format:s=>`${Math.round(s)} bpm`,onInput:s=>n.bpm=s})}e.setInfo(()=>`${o.chords.map(f=>`${f.label}(${oe[f.root]})`).join(" → ")} · ${o.blurb}`);let P=0;return{frame(){e.tick(),N.pulse(),u*=.94,n.isRunning?c.uniforms[4]=n.phase(Q):(P=(P+6e-4)%1,c.uniforms[4]=P),c.uniforms[5]=Math.max(u,n.isRunning?.25:.1),c.draw()},dispose(){w()}}}re();const pe={hero:a=>W(a,{mode:"hero"}),triads:a=>ve(a),loop:a=>W(a)};for(const a of document.querySelectorAll("[data-demo]")){const l=pe[a.dataset.demo];l&&ie(a,()=>l(a))}
