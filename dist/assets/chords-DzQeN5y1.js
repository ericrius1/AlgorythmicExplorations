import{i as ne}from"./siteNav-RZaw0VT9.js";import{S as _,g as K,m as ae}from"./demoShell-Btkj803W.js";import{g as W}from"./gpu-DBowy6aD.js";import{S as X}from"./shaderCanvas-B9soO7i5.js";import{s as Z,S as F,m as G,f as ee,u as E,n as re,a as M,N as te,b as ie}from"./audio-C7YF5wtJ.js";import{P as le}from"./piano-B9UkCvTG.js";import{P as oe}from"./PolySynth-D_92O0qp.js";import{R as ce}from"./Reverb-Dd3M8emd.js";const q=6,ue=130.81,z=[{name:"major",iv:[0,4,7],story:"4:5:6 — a slice of one harmonic series"},{name:"minor",iv:[0,3,7],story:"10:12:15 — same intervals, weaker anchor"},{name:"diminished",iv:[0,3,6],story:"no simple lattice — pure instability"},{name:"augmented",iv:[0,4,8],story:"perfectly symmetric — no home, no root"},{name:"sus4",iv:[0,5,7],story:"6:8:9 — the third withheld, neither happy nor sad"},{name:"dom7",iv:[0,4,7,10],story:"major plus a tritone inside — the engine of part five"},{name:"maj7",iv:[0,4,7,11],story:"8:10:12:15 — soft dissonance worn as perfume"},{name:"min7",iv:[0,3,7,10],story:"10:12:15:18 — minor with the edges sanded"}],fe=`
fn xOf(f: f32) -> f32 {
  return log2(f / ${ue}) / 4.6 + 0.04;
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
`;async function me(s){const h=await W(),a=new _(s,.5);if(!h)return K(s);const d=new X(h,a.canvas,fe,4);Z(s,"click a key below");let i=48,c=z[0],m=0;const y=new oe(F,{oscillator:{type:"triangle"},envelope:{attack:.02,decay:.6,sustain:.35,release:1.2},volume:-12}).connect(G()),R=ee(()=>y.releaseAll()),b=()=>c.iv.map(n=>i+n),w=new le({low:48,high:72,onPress:n=>{i=n,E().then(j)}});a.controls.before(w.el);let p=0;const j=()=>{if(performance.now()-p>400)return;m=1,y.releaseAll();const n=re();b().forEach((t,g)=>{y.triggerAttackRelease(M(t),2.2,n+g*.02)}),w.setHeld(b(),i)},x=[];return z.forEach((n,t)=>{a.button(n.name,()=>{c=z[t],x.forEach((g,C)=>g.style.borderColor=C===t?"var(--accent)":"var(--border)"),E().then(j)}),x.push(a.controls.lastElementChild)}),x[0].style.borderColor="var(--accent)",a.setInfo(()=>`${te[i%12]} ${c.name} · ${c.story}`),w.setHeld(b(),i),{frame(){a.tick(),R.pulse(),p=performance.now(),m*=.96;const n=b();for(let t=0;t<4;t++)d.uniforms[4+t]=t<n.length?M(n[t]):0;d.uniforms[8]=n.length,d.uniforms[9]=m,d.draw()},dispose(){y.releaseAll()}}}const v=96,Q=16,o=(s,h,a,d)=>({label:s,root:h,iv:a,tension:d}),l=[0,4,7],O=[0,3,7],H=[0,4,7,10],U=[{name:"I–IV–V–I",chords:[o("I",0,l,.08),o("IV",5,l,.4),o("V",7,H,.9),o("I",0,l,.08)],blurb:"the three-chord trick: home, away, bowstring, home"},{name:"I–V–vi–IV",chords:[o("I",0,l,.08),o("V",7,l,.75),o("vi",9,O,.45),o("IV",5,l,.4)],blurb:"the pop loop — tension never fully spent, so it cycles forever"},{name:"ii–V–I",chords:[o("ii",2,O,.45),o("V7",7,H,.92),o("I",0,l,.08),o("I",0,l,.08)],blurb:"jazz's handshake: approach the bowstring by a fifth, then release"},{name:"i–VI–III–VII",chords:[o("i",0,O,.25),o("VI",8,l,.4),o("III",3,l,.5),o("VII",10,l,.65)],blurb:"the minor anthem loop — sadness with momentum"},{name:"deceptive: I–IV–V–vi",chords:[o("I",0,l,.08),o("IV",5,l,.4),o("V7",7,H,.92),o("vi",9,O,.55)],blurb:"the V promises home and hands you the relative minor instead"}],ve=`
fn voiceY(v: u32, x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${v-1});
  let i = u32(floor(f));
  return mix(D[v * ${v}u + i], D[v * ${v}u + min(i + 1u, ${v-1}u)], fract(f));
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
    let tn = D[${4*v}u + seg];
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
`;async function he(s,h={}){const a=h.mode==="hero",d=await W(),i=new _(s,a?.42:.56);if(!d)return K(s);const c=new X(d,i.canvas,ve,4*v+4);Z(s,a?"tap to start the band":"tap for sound");let m=U[a?1:0];const y=new ce({decay:2.8,wet:.3}).connect(G()),R=new oe(F,{oscillator:{type:"triangle"},envelope:{attack:.06,decay:.4,sustain:.5,release:1.4},volume:-14}).connect(y),b=new F({oscillator:{type:"sine"},envelope:{attack:.02,decay:.3,sustain:.4,release:.5},volume:-10}).connect(G()),w=e=>{const r=[];let u=[60,64,67];for(const f of e){const I=f.iv.map(L=>(f.root+L)%12).slice(0,3);let k=null,V=1e9;const B=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];for(const L of B){const D=u.map((S,T)=>{const P=I[L[T]];let A=P+12*Math.round((S-P)/12);for(;A<55;)A+=12;for(;A>79;)A-=12;return A}),se=new Set(D.map(S=>S%12)).size,J=D.reduce((S,T,P)=>S+Math.abs(T-u[P]),0)+(3-se)*9;J<V&&(V=J,k=D)}u=k,r.push([36+f.root+(f.root>7?0:12),...u])}return r};let p=w(m.chords);const j=e=>.2+(e-36)/48*.74,x=()=>{for(let e=0;e<4;e++)for(let r=0;r<v;r++){const u=r/(v-1),f=Math.min(Math.floor(u*4),3),$=u*4-f,I=p[f][e],k=p[(f+1)%4][e],V=$<.85?0:($-.85)/.15,B=V*V*(3-2*V);c.data[e*v+r]=j(I+(k-I)*B)}for(let e=0;e<4;e++)c.data[4*v+e]=m.chords[e].tension};x();let n=0;const t=new ie(a?72:84,1,(e,r)=>{const u=e%Q,f=Math.floor(u/4);if(u%4===0){const[$,...I]=p[f];for(const k of I)R.triggerAttackRelease(M(k),3.3,r);b.triggerAttackRelease(M($),1.6,r),n=1}else u%4===2&&b.triggerAttackRelease(M(p[f][0]),.8,r)}),g=()=>{t.stop(),R.releaseAll()},C=ee(g),Y=()=>{t.isRunning?g():t.start()};if(a)i.canvas.addEventListener("pointerdown",()=>{E().then(Y)});else{i.button("▶ play / stop",()=>{E().then(Y)});for(const e of U)i.button(e.name,()=>{m=e,p=w(m.chords),x(),E().then(()=>{t.isRunning||t.start()})});i.slider({label:"tempo",min:56,max:132,step:1,value:t.bpm,format:e=>`${Math.round(e)} bpm`,onInput:e=>t.bpm=e})}i.setInfo(()=>`${m.chords.map(r=>`${r.label}(${te[r.root]})`).join(" → ")} · ${m.blurb}`);let N=0;return{frame(){i.tick(),C.pulse(),n*=.94,t.isRunning?c.uniforms[4]=t.phase(Q):(N=(N+6e-4)%1,c.uniforms[4]=N),c.uniforms[5]=Math.max(n,t.isRunning?.25:.1),c.draw()},dispose(){g()}}}ne();const de={triads:s=>me(s),loop:s=>he(s)};for(const s of document.querySelectorAll("[data-demo]")){const h=de[s.dataset.demo];h&&ae(s,()=>h(s))}
