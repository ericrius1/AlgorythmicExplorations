import{g as F,S as C,a as P,i as X,m as z}from"./gpu-DqzAFztT.js";import{S as R,s as j,a as V,m as L,f as B,u as b,N as W,G as J,O as A}from"./audio-C6wRk_Ux.js";import{P as K}from"./PolySynth-C0kHVlaI.js";const T=1200*Math.log2(3/2),k=13,Q=130.81,Y=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let count = u32(uf(4u));
  let flash = uf(5u);
  let gap = uf(6u);      // comma gap in radians, 0 when tempered shut
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.3;
  let r = length(q);
  let ang = atan2(q.y, q.x);

  // reference clock: 12 equal pitch-class spokes
  for (var k = 0u; k < 12u; k++) {
    let a = f32(k) * 6.2831853 / 12.0;
    let dir = vec2f(cos(a), sin(a));
    let d = sdSeg(q, dir * 0.22, dir * 1.04);
    col += vec3f(0.05, 0.06, 0.10) * glow(d, 0.0035);
  }
  col += vec3f(0.05, 0.06, 0.11) * glow(abs(r - 1.04), 0.004);

  // the chain of fifths
  for (var k = 0u; k < ${k}u; k++) {
    if (k >= count) { break; }
    let p = vec2f(D[k * 2u], D[k * 2u + 1u]);
    if (k + 1u < count) {
      let p2 = vec2f(D[k * 2u + 2u], D[k * 2u + 3u]);
      col += hsv(0.58 + f32(k) * 0.025, 0.6, 0.9) * glow(sdSeg(q, p, p2), 0.004) * 0.55;
    }
    let isNew = select(0.0, flash, k + 1u == count);
    let d = length(q - p);
    let hue = fract(atan2(p.y, p.x) / 6.2831853);
    col += hsv(hue, 0.55, 1.0) * (glow(d, 0.016 + isNew * 0.012) * (0.9 + isNew * 1.6) + halo(d, 0.01) * 0.3);
  }

  // the comma: a bright arc between where you landed and where you began
  if (count == ${k}u && gap > 0.0005) {
    let a0 = atan2(D[1], D[0]);
    let rr = length(vec2f(D[${(k-1)*2}], D[${(k-1)*2+1}]));
    let rel = (ang - a0 + 6.2831853 * 3.0) % 6.2831853;
    if (rel < gap && abs(r - rr) < 0.05) {
      col += vec3f(1.0, 0.25, 0.15) * (0.8 + 0.5 * sin(t * 6.0)) * glow(abs(r - rr), 0.012);
    }
  }

  return col * vignette(uv);
}
`;async function H(n,w={}){const l=w.mode==="hero",u=await F(),v=new C(n,l?.42:.66);if(!u)return P(n);const r=new R(u,v.canvas,Y,k*2);j(n,l?"tap to hear the stack":"tap for sound");let s=1,f=0,p=0,h=!1;const d=new K(V,{oscillator:{type:"triangle"},envelope:{attack:.005,decay:.35,sustain:.12,release:.6},volume:-10}).connect(L()),S=B(()=>d.releaseAll()),q=()=>T+(700-T)*f,y=t=>(t*q()%1200+1200)%1200,e=t=>W[t*7%12];let o=0;const i=t=>{l&&!h||performance.now()-o>400||d.triggerAttackRelease(Q*Math.pow(2,y(t)/1200),.5)},c=()=>{s>=k||(s++,p=1,i(s-1))},M=()=>{s=1,p=1,i(0)};if(l){v.canvas.addEventListener("pointerdown",()=>{b().then(()=>h=!h)});let t=0;window.setInterval(()=>{t++;const a=t%26;a<12?c():a===15?f=1:a===21&&(f=0,s=1)},1100)}else{v.button("stack a fifth",()=>{b().then(c)}),v.button("restart",()=>{b().then(M)});let t=0;v.button("stack all twelve",()=>{b().then(()=>{s=1,clearInterval(t),t=window.setInterval(()=>{c(),s>=k&&clearInterval(t)},450)})}),v.slider({label:"temper each fifth",min:0,max:1,step:.01,value:0,format:a=>`${(T+(700-T)*a).toFixed(2)}¢`,onInput:a=>f=a})}v.setInfo(()=>{const t=Array.from({length:s},(a,g)=>e(g));if(s===k){const a=Math.abs(y(12)).toFixed(1);return f>.98?"twelve tempered fifths · the circle closes — every key equally in tune, none perfectly":`back to ${e(0)}… but ${a}¢ sharp — the Pythagorean comma`}return`${t.join(" → ")} · ${s-1} fifth${s===2?"":"s"} stacked`});let m=0;return{frame(){v.tick(),S.pulse(),o=performance.now(),p*=.93,m+=(f-m)*.07;const t=T+(700-T)*m;for(let g=0;g<k;g++){const O=(g*t%1200+1200)%1200/1200*2*Math.PI,G=.24+g*.062;r.data[g*2]=Math.cos(O)*G,r.data[g*2+1]=Math.sin(O)*G}r.uniforms[4]=s,r.uniforms[5]=p;const a=(12*t%1200+1200)%1200;r.uniforms[6]=Math.min(a,1200-a)/1200*2*Math.PI,r.draw()},dispose(){d.releaseAll()}}}const $=261.63,Z=6,U={freqs:[$,$*1.25,$*1.5]},N={freqs:[$,$*Math.pow(2,4/12),$*Math.pow(2,7/12)]},ee=[[0,1,5,4],[0,2,3,2],[1,2,6,5]],te=`
fn panel(q: vec2f, side: f32, t: f32, active: f32) -> vec3f {
  var col = vec3f(0.0);
  // three voices: vertical strings at x = -0.5, 0, 0.5 within the panel
  for (var v = 0u; v < 3u; v++) {
    let x = (f32(v) - 1.0) * 0.5;
    let shimmer = D[u32(side) * 8u + 6u + 0u]; // overall shimmer of this side
    let wob = sin(t * 5.0 + f32(v) * 2.1) * 0.006 * shimmer * active;
    let d = sdSeg(q, vec2f(x + wob, -0.62), vec2f(x - wob, 0.45));
    let hue = 0.56 + f32(v) * 0.07 + f32(side) * 0.04;
    col += hsv(hue, 0.6, 1.0) * (glow(d, 0.006) * (0.5 + active * 0.6) + halo(d, 0.006) * 0.25);
  }
  // beat lights between the pairs
  for (var k = 0u; k < 3u; k++) {
    let bright = D[u32(side) * 8u + k];           // 0..1 pulse
    let rate = D[u32(side) * 8u + 3u + k];        // beats/sec, for tinting
    let cx = select(select(0.25, -0.25, k == 0u), 0.0, k == 1u);
    let cy = select(0.62, 0.78, k == 1u);
    let p = vec2f(cx, cy);
    let d = length(q - p);
    let steady = smoothstep(2.0, 0.2, rate);     // calm pairs glow white-green
    let tint = mix(vec3f(1.0, 0.3, 0.2), vec3f(0.55, 1.0, 0.7), steady);
    col += tint * glow(d, 0.035 + 0.025 * bright) * (0.25 + bright) * active;
    col += tint * halo(d, 0.02) * 0.15 * active;
  }
  return col;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let activeL = uf(4u);
  let activeR = uf(5u);
  var col = vec3f(0.0);

  // divider
  col += vec3f(0.06, 0.07, 0.12) * glow(abs(uv.x - 0.5), 0.0015);

  let scale = 1.25;
  if (uv.x < 0.5) {
    let q = vec2f((uv.x - 0.25) * aspect, uv.y - 0.45) * scale * 2.0;
    col += panel(q, 0.0, t, 0.35 + 0.65 * activeL);
  } else {
    let q = vec2f((uv.x - 0.75) * aspect, uv.y - 0.45) * scale * 2.0;
    col += panel(q, 1.0, t, 0.35 + 0.65 * activeR);
  }
  return col * vignette(uv);
}
`;async function oe(n){const w=await F(),l=new C(n,.52);if(!w)return P(n);const u=new R(w,l.canvas,te,16);j(n);const v=o=>{const i=new J(0).connect(L()),c=o.freqs.map(M=>{const m=new A(M,"sine").connect(i);return m.partials=Array.from({length:Z},(t,a)=>1/(a+1)**1.4),m});return{gain:i,oscs:c}},r=v(U),s=v(N);let f=0,p=0,h=0;const d=o=>{f=o==="just"?1:0,p=o==="et"?1:0;for(const i of[r,s])for(const c of i.oscs)c.state!=="started"&&c.start();r.gain.gain.rampTo(f*.16,.12),s.gain.gain.rampTo(p*.16,.12)},S=B(()=>{clearInterval(h),d("off")});l.button("▶ pure 4:5:6",()=>{b().then(()=>{clearInterval(h),d(f?"off":"just")})}),l.button("▶ equal-tempered",()=>{b().then(()=>{clearInterval(h),d(p?"off":"et")})}),l.button("alternate A/B",()=>{b().then(()=>{clearInterval(h);let o=!0;d("just"),h=window.setInterval(()=>{o=!o,d(o?"just":"et")},1600)})}),l.button("silence",()=>{clearInterval(h),d("off")});const q=(o,i)=>{const[c,M,m,t]=ee[i];return Math.abs(o.freqs[c]*m-o.freqs[M]*t)};l.setInfo(()=>{const o=q(N,0).toFixed(1),i=q(N,1).toFixed(1);return`tempered third beats ${o}×/s · tempered fifth only ${i}×/s · pure side: 0`});const y=new Float32Array(6);let e=performance.now();return{frame(){l.tick(),S.pulse();const o=performance.now(),i=(o-e)/1e3;e=o;for(let c=0;c<2;c++){const M=c===0?U:N;let m=0;for(let t=0;t<3;t++){const a=q(M,t);y[c*3+t]+=2*Math.PI*a*i;const g=a<.05?1:.5+.5*Math.cos(y[c*3+t]);u.data[c*8+t]=g,u.data[c*8+3+t]=a,m+=Math.min(a/12,1)}u.data[c*8+6]=m/3}u.uniforms[4]=f,u.uniforms[5]=p,u.draw()},dispose(){clearInterval(h),d("off")}}}const I=5,ne=31,x=ne-I+1,E=1200*Math.log2(3/2),_=1200*Math.log2(5/4),D=196,se=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let sel = uf(4u);
  let flash = uf(5u);
  var col = vec3f(0.0);

  // audibility line: ~2 cents
  let yline = 0.12 + (2.0 / 30.0) * 0.74;
  col += vec3f(0.2, 0.35, 0.2) * glow(abs(uv.y - yline), 0.0012) * 0.6;

  for (var k = 0u; k < ${x}u; k++) {
    let x = 0.05 + (f32(k) + 0.5) * 0.9 / f32(${x});
    let halfw = 0.012;
    let e5 = D[k];                 // fifth error, cents
    let e3 = D[${x}u + k];     // third error, cents
    let isSel = f32(abs(f32(k) + f32(${I}) - sel) < 0.5);

    // baseline tick
    col += vec3f(0.12, 0.13, 0.2) * glow(length(uv - vec2f(x, 0.105)), 0.004);

    // fifth error bar (cool blue, capped at 30¢ of display)
    let h5 = 0.12 + clamp(e5 / 30.0, 0.0, 1.0) * 0.74;
    if (abs(uv.x - x) < halfw && uv.y > 0.12 && uv.y < h5) {
      let good = smoothstep(8.0, 0.5, e5);
      col += mix(hsv(0.62, 0.7, 0.55), hsv(0.5, 0.9, 1.0), good) * (0.55 + isSel * 0.7 + flash * isSel);
    }
    // third error bar (warm, thinner, drawn beside)
    let h3 = 0.12 + clamp(e3 / 30.0, 0.0, 1.0) * 0.74;
    if (abs(uv.x - x - halfw * 1.4) < halfw * 0.45 && uv.y > 0.12 && uv.y < h3) {
      col += hsv(0.08, 0.85, 0.9) * (0.4 + isSel * 0.5);
    }
    // selection beacon
    col += vec3f(1.0, 0.9, 0.7) * glow(length(uv - vec2f(x, 0.05)), 0.006 + 0.004 * sin(t * 4.0)) * isSel;
  }
  return col * vignette(uv);
}
`;async function ae(n){const w=await F(),l=new C(n,.52);if(!w)return P(n);const u=new R(w,l.canvas,se,x*2);j(n,"click a column");const v=(e,o)=>{const i=1200/e;return Math.abs(Math.round(o/i)*i-o)};for(let e=0;e<x;e++)u.data[e]=v(I+e,E),u.data[x+e]=v(I+e,_);let r=12,s=0;const f=new J(0).connect(L()),p=new A(D,"sine").connect(f),h=new A(D*1.5,"sine").connect(f);for(const e of[p,h])e.partials=[1,.5,.33,.25,.2];let d=0;const S=()=>{clearTimeout(d),f.gain.rampTo(0,.1)},q=B(S),y=e=>{const o=1200/e,i=Math.round(E/o)*o;p.state!=="started"&&(p.start(),h.start()),clearTimeout(d),h.frequency.value=D*1.5,f.gain.rampTo(.2,.08),d=window.setTimeout(()=>{h.frequency.rampTo(D*Math.pow(2,i/1200),.03),d=window.setTimeout(()=>f.gain.rampTo(0,.3),1400)},1400)};l.canvas.addEventListener("pointerdown",()=>{const e=Math.floor((u.pointer.x-.05)/.9*x);e<0||e>=x||(r=I+e,s=1,b().then(()=>y(r)))});for(const e of[12,19,31])l.button(`${e}-TET`,()=>{r=e,s=1,b().then(()=>y(e))});return l.setInfo(()=>{const e=v(r,E),o=v(r,_);return`${r} equal steps · fifth off by ${e.toFixed(2)}¢ · major third off by ${o.toFixed(2)}¢ · click = pure fifth, then ${r}-TET's`}),{frame(){l.tick(),q.pulse(),s*=.95,u.uniforms[4]=r,u.uniforms[5]=s,u.draw()},dispose(){S()}}}X();const ce={hero:n=>H(n,{mode:"hero"}),spiral:n=>H(n),comma:n=>oe(n),whytwelve:n=>ae(n)};for(const n of document.querySelectorAll("[data-demo]")){const w=ce[n.dataset.demo];w&&z(n,()=>w(n))}
