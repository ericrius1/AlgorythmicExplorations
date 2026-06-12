import{g as P,S as C,a as j,i as U,m as _}from"./gpu-fVucxd0a.js";import{S as G}from"./shaderCanvas-B9soO7i5.js";import{s as L,S as O,m as $,G as J,O as V,f as T,u as y,N as B,n as M}from"./audio-C03jcV_H.js";import{P as F}from"./PolySynth-DXCA2ES0.js";const x=130.81,q=[{name:"major (diatonic)",steps:[2,2,1,2,2,2,1],modeNames:["Ionian — the major scale","Dorian","Phrygian","Lydian","Mixolydian","Aeolian — natural minor","Locrian"]},{name:"pentatonic",steps:[2,2,3,2,3],modeNames:["major pentatonic","Egyptian / suspended","blues minor","blues major","minor pentatonic"]},{name:"harmonic minor",steps:[2,1,2,2,1,3,1]},{name:"whole tone",steps:[2,2,2,2,2,2]}],X={3:"brightness 1/7 (brightest)",0:"brightness 2/7",4:"brightness 3/7",1:"brightness 4/7",5:"brightness 5/7",2:"brightness 6/7",6:"brightness 7/7 (darkest)"},Y=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let comet = uf(4u);    // angle of the playhead, <0 when idle
  let droneOn = uf(5u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.4;
  let R = 0.78;

  // drone breath in the middle
  col += hsv(0.08, 0.7, 1.0) * glow(length(q), 0.05 + 0.02 * sin(t * 2.0)) * droneOn * 0.5;

  for (var k = 0u; k < 12u; k++) {
    // pitch class k sits at angle: clockwise from 12 o'clock
    let a = 1.5707963 - f32(k) * 6.2831853 / 12.0;
    let p = vec2f(cos(a), sin(a)) * R;
    let lit = D[k];

    // chromatic ghost positions
    col += vec3f(0.07, 0.08, 0.13) * glow(length(q - p), 0.008);

    if (lit > 0.5) {
      let isRoot = f32(lit > 1.5);
      let hue = mix(0.55 + f32(k) * 0.018, 0.085, isRoot);
      let throb = 1.0 + 0.25 * sin(t * 2.2 + f32(k)) + isRoot * 0.5;
      col += hsv(hue, 0.6, 1.0) * (glow(length(q - p), 0.028) * throb + halo(length(q - p), 0.015) * 0.35);
    }

    // arc to the NEXT lit note, tinted by step size (D[12+k] = gap or 0)
    let gap = D[12u + k];
    if (gap > 0.5) {
      let a2 = 1.5707963 - f32(k + u32(gap)) * 6.2831853 / 12.0;
      // approximate the arc with its chord, drawn slightly inside the ring
      let p2 = vec2f(cos(a2), sin(a2)) * R;
      let d = sdSeg(q, p * 0.92, p2 * 0.92);
      let isHalf = f32(abs(gap - 1.0) < 0.1);
      let hue = mix(0.45, 0.06, isHalf); // whole steps cool, half steps hot
      col += hsv(hue, 0.85, 0.9) * glow(d, 0.0045) * (0.5 + isHalf * 0.6);
    }
  }

  // the playhead comet
  if (comet > -5.0) {
    let p = vec2f(cos(comet), sin(comet)) * R;
    col += vec3f(1.0, 0.95, 0.8) * glow(length(q - p), 0.02) * 1.3;
  }

  return col * vignette(uv);
}
`;async function Q(l,b={}){const h=b.mode==="hero",d=await P(),t=new C(l,h?.42:.66);if(!d)return j(l);const f=new G(d,t.canvas,Y,24);L(l,h?"tap for the drone":"tap for sound");let p=0,r=0,k=!1;const E=new F(O,{oscillator:{type:"triangle"},envelope:{attack:.01,decay:.3,sustain:.2,release:.5},volume:-11}).connect($()),R=new J(0).connect($()),S=new V(x/2,"sine").connect(R);S.partials=[1,.5,.25,.18,.1];const a=e=>{k=e,e&&S.state!=="started"&&S.start(),R.gain.rampTo(e?.22:0,.4)};let c=[];const u=()=>{a(!1),E.releaseAll(),c=[]},o=T(u),g=()=>{const e=q[p].steps,i=e.length,m=[0];let w=0;for(let n=0;n<i-1;n++)w+=e[(r+n)%i],m.push(w);return m};let s=0;const v=(e,i)=>{if(performance.now()-s>400)return;const m=M();c=e.map((w,n)=>({at:m+n*i,pc:w%12}));for(const[w,n]of e.entries())E.triggerAttackRelease(x*Math.pow(2,n/12),i*.9,m+w*i)},A=()=>v([...g(),12],.28),H=()=>{const e=g();v([0,2,4,5,4,2,1,0].map(m=>m<e.length?e[m]:12),.22)},z=()=>{const e=q[p];return e.modeNames?e.modeNames[r%e.steps.length]:e.name};if(h){t.canvas.addEventListener("pointerdown",()=>{y().then(()=>a(!k))});let e=0;window.setInterval(()=>{e++,e%3===0&&(r=(r+1)%q[0].steps.length,k&&A())},2600)}else t.button("▶ play the scale",()=>{y().then(A)}),t.button("♪ play a riff",()=>{y().then(H)}),t.button("rotate the pattern →",()=>{r=(r+1)%q[p].steps.length,y().then(A)}),t.button("drone C",()=>{y().then(()=>a(!k))}),t.button("pattern: major",()=>{p=(p+1)%q.length,r=0;const e=t.controls.querySelectorAll("button");e[4].textContent=`pattern: ${q[p].name.split(" ")[0]}`});return t.setInfo(()=>{const i=g().map(w=>B[w%12]).join(" "),m=p===0?` · ${X[r]}`:"";return`${z()} on C · ${i}${m}`}),{frame(){t.tick(),o.pulse(),s=performance.now();const e=g();f.data.fill(0);for(const n of e)f.data[n%12]=1;f.data[0]=2;const i=[...e].sort((n,N)=>n-N);for(let n=0;n<i.length;n++){const N=i[n]%12,K=n+1<i.length?i[n+1]:12;f.data[12+N]=K-i[n]}const m=M();let w=-10;for(const n of c)Math.abs(m-n.at)<.14&&(w=Math.PI/2-n.pc*2*Math.PI/12);f.uniforms[4]=w,f.uniforms[5]=k?1:0,f.draw()},dispose(){u()}}}const D=261.63,I=[0,2,4,5,7,9,11],W=["C","G","D","A","E","B","F♯","D♭","A♭","E♭","B♭","F"],Z=["—","1♯","2♯","3♯","4♯","5♯","6♯","5♭","4♭","3♭","2♭","1♭"],tt=`
fn nodeAt(k: u32, R: f32) -> vec2f {
  let a = 1.5707963 - f32(k) * 6.2831853 / 12.0;
  return vec2f(cos(a), sin(a)) * R;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let sel = u32(uf(4u));
  let comet = uf(5u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.35;

  // rim: the twelve keys, tinted by overlap with the chosen key
  for (var k = 0u; k < 12u; k++) {
    let p = nodeAt(k, 0.86);
    let share = D[k]; // 0..7 notes in common
    let d = length(q - p);
    let warmth = share / 7.0;
    let isSel = f32(k == sel);
    let hue = mix(0.62, 0.09, warmth * warmth);
    let size = 0.02 + warmth * 0.014 + isSel * 0.016;
    col += hsv(hue, 0.65, 0.4 + warmth * 0.7) * (glow(d, size) * (0.5 + warmth + isSel) + halo(d, 0.012) * 0.3 * warmth);
    col += vec3f(1.0, 0.95, 0.85) * glow(d, 0.008) * isSel * (0.8 + 0.3 * sin(t * 3.0));
  }
  // neighbour bonds: selected key to its two fifth-neighbours
  let pSel = nodeAt(sel, 0.86);
  let pUp = nodeAt((sel + 1u) % 12u, 0.86);
  let pDn = nodeAt((sel + 11u) % 12u, 0.86);
  col += hsv(0.1, 0.7, 0.9) * (glow(sdSeg(q, pSel, pUp), 0.004) + glow(sdSeg(q, pSel, pDn), 0.004)) * 0.5;

  // inner chromatic clock with the key's notes lit
  for (var k = 0u; k < 12u; k++) {
    let p = nodeAt(k, 0.45);
    let lit = D[12u + k];
    let d = length(q - p);
    col += vec3f(0.06, 0.07, 0.12) * glow(d, 0.006);
    if (lit > 0.5) {
      let isRoot = f32(lit > 1.5);
      col += hsv(mix(0.55, 0.085, isRoot), 0.6, 1.0) * (glow(d, 0.018 + isRoot * 0.008) * (0.8 + isRoot * 0.8));
    }
  }

  if (comet > -5.0) {
    let p = vec2f(cos(comet), sin(comet)) * 0.45;
    col += vec3f(1.0, 0.95, 0.8) * glow(length(q - p), 0.016) * 1.2;
  }

  return col * vignette(uv);
}
`;async function et(l){const b=await P(),h=new C(l,.66);if(!b)return j(l);const d=new G(b,h.canvas,tt,24);L(l,"click a key");let t=0;const f=a=>a*7%12,p=a=>new Set(I.map(c=>(f(a)+c)%12)),r=new F(O,{oscillator:{type:"triangle"},envelope:{attack:.01,decay:.3,sustain:.2,release:.6},volume:-11}).connect($());let k=[];const E=T(()=>{r.releaseAll(),k=[]});let R=0;const S=a=>{if(performance.now()-R>400)return;const c=M(),u=f(a),o=[...I,12].map(s=>u+s);k=o.map((s,v)=>({at:c+v*.16,pc:s%12})),o.forEach((s,v)=>{r.triggerAttackRelease(D*Math.pow(2,(s-12)/12),.15,c+v*.16)});const g=c+o.length*.16+.1;for(const s of[0,4,7])r.triggerAttackRelease(D*Math.pow(2,(u+s-12)/12),1.1,g)};return h.canvas.addEventListener("pointerdown",()=>{const a=h.canvas.width/h.canvas.height,c=(d.pointer.x-.5)*a*2.35,u=(d.pointer.y-.5)*2.35;let o=-1,g=.3;for(let s=0;s<12;s++){const v=Math.PI/2-s*2*Math.PI/12,A=Math.hypot(c-Math.cos(v)*.86,u-Math.sin(v)*.86);A<g&&(g=A,o=s)}o>=0&&(t=o,y().then(()=>S(t)))}),h.button("◀ fifth down",()=>{t=(t+11)%12,y().then(()=>S(t))}),h.button("fifth up ▶",()=>{t=(t+1)%12,y().then(()=>S(t))}),h.setInfo(()=>{const a=p(t),c=[...p((t+1)%12)].filter(u=>a.has(u)).length;return`${W[t]} major · ${Z[t]} · shares ${c} of 7 notes with each neighbour · ${B[f(t)]} is home`}),{frame(){h.tick(),E.pulse(),R=performance.now();const a=p(t);for(let o=0;o<12;o++){const g=p(o);let s=0;for(const v of g)a.has(v)&&s++;d.data[o]=s}for(let o=0;o<12;o++)d.data[12+o]=a.has(o)?1:0;d.data[12+f(t)]=2;const c=M();let u=-10;for(const o of k)Math.abs(c-o.at)<.09&&(u=Math.PI/2-o.pc*2*Math.PI/12);d.uniforms[4]=t,d.uniforms[5]=u,d.draw()},dispose(){r.releaseAll()}}}U();const ot={ring:l=>Q(l),keys:l=>et(l)};for(const l of document.querySelectorAll("[data-demo]")){const b=ot[l.dataset.demo];b&&_(l,()=>b(l))}
