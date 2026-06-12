import{i as Ae}from"./siteNav-DaR1fllU.js";import{S as ae,g as oe,m as qe}from"./demoShell-Btkj803W.js";import{g as ie}from"./gpu-DBowy6aD.js";import{S as le}from"./shaderCanvas-B9soO7i5.js";import{T as Q,o as ke,P as Ie,r as G,G as ne,h as xe,i as ge,j as pe,k as Me,s as ce,M as _e,m as A,f as re,u as O,e as he,S as V,d as L,N as Fe,l as Ne}from"./audio-Cx45zrED.js";import{F as U,N as Y}from"./NoiseSynth-DDXNqi7l.js";import{C as Pe,M as De,R as Se}from"./Reverb-xLBcSWPW.js";import{P as Re}from"./PolySynth-CMSO9RJ7.js";class W extends Q{constructor(){const e=ke(W.getDefaults(),arguments,["delayTime","maxDelay"]);super(e),this.name="Delay";const s=this.toSeconds(e.maxDelay);this._maxDelay=Math.max(s,this.toSeconds(e.delayTime)),this._delayNode=this.input=this.output=this.context.createDelay(s),this.delayTime=new Ie({context:this.context,param:this._delayNode.delayTime,units:"time",value:e.delayTime,minValue:0,maxValue:this.maxDelay}),G(this,"delayTime")}static getDefaults(){return Object.assign(Q.getDefaults(),{delayTime:0,maxDelay:1})}get maxDelay(){return this._maxDelay}dispose(){return super.dispose(),this._delayNode.disconnect(),this.delayTime.dispose(),this}}class me extends Q{constructor(e){super(e),this.name="StereoEffect",this.input=new ne({context:this.context}),this.input.channelCount=2,this.input.channelCountMode="explicit",this._dryWet=this.output=new Pe({context:this.context,fade:e.wet}),this.wet=this._dryWet.fade,this._split=new xe({context:this.context,channels:2}),this._merge=new De({context:this.context,channels:2}),this.input.connect(this._split),this.input.connect(this._dryWet.a),this._merge.connect(this._dryWet.b),G(this,["wet"])}connectEffectLeft(...e){this._split.connect(e[0],0,0),ge(...e),pe(e[e.length-1],this._merge,0,0)}connectEffectRight(...e){this._split.connect(e[0],1,0),ge(...e),pe(e[e.length-1],this._merge,0,1)}static getDefaults(){return Object.assign(Q.getDefaults(),{wet:1})}dispose(){return super.dispose(),this._dryWet.dispose(),this._split.dispose(),this._merge.dispose(),this}}class Ce extends me{constructor(e){super(e),this.feedback=new Me({context:this.context,value:e.feedback,units:"normalRange"}),this._feedbackL=new ne({context:this.context}),this._feedbackR=new ne({context:this.context}),this._feedbackSplit=new xe({context:this.context,channels:2}),this._feedbackMerge=new De({context:this.context,channels:2}),this._merge.connect(this._feedbackSplit),this._feedbackMerge.connect(this._split),this._feedbackSplit.connect(this._feedbackL,0,0),this._feedbackL.connect(this._feedbackMerge,0,0),this._feedbackSplit.connect(this._feedbackR,1,0),this._feedbackR.connect(this._feedbackMerge,0,1),this.feedback.fan(this._feedbackL.gain,this._feedbackR.gain),G(this,["feedback"])}static getDefaults(){return Object.assign(me.getDefaults(),{feedback:.5})}dispose(){return super.dispose(),this.feedback.dispose(),this._feedbackL.dispose(),this._feedbackR.dispose(),this._feedbackSplit.dispose(),this._feedbackMerge.dispose(),this}}class ve extends Ce{constructor(e){super(e),this._feedbackL.disconnect(),this._feedbackL.connect(this._feedbackMerge,0,1),this._feedbackR.disconnect(),this._feedbackR.connect(this._feedbackMerge,0,0),G(this,["feedback"])}}class fe extends ve{constructor(){const e=ke(fe.getDefaults(),arguments,["delayTime","feedback"]);super(e),this.name="PingPongDelay",this._leftDelay=new W({context:this.context,maxDelay:e.maxDelay}),this._rightDelay=new W({context:this.context,maxDelay:e.maxDelay}),this._rightPreDelay=new W({context:this.context,maxDelay:e.maxDelay}),this.delayTime=new Me({context:this.context,units:"time",value:e.delayTime}),this.connectEffectLeft(this._leftDelay),this.connectEffectRight(this._rightPreDelay,this._rightDelay),this.delayTime.fan(this._leftDelay.delayTime,this._rightDelay.delayTime,this._rightPreDelay.delayTime),this._feedbackL.disconnect(),this._feedbackL.connect(this._rightDelay),G(this,["delayTime"])}static getDefaults(){return Object.assign(ve.getDefaults(),{delayTime:.25,maxDelay:1})}dispose(){return super.dispose(),this._leftDelay.dispose(),this._rightDelay.dispose(),this._rightPreDelay.dispose(),this.delayTime.dispose(),this}}const b=16;function z(a,e,s=0){const h=[];for(let n=0;n<e;n++){const l=((n-s)%e+e)%e;h.push(Math.floor((l+1)*a/e)!==Math.floor(l*a/e))}return h}const Le=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let head = uf(4u); // 0..1 through the bar
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.3;

  // sweep arm
  let ha = 1.5707963 - head * 6.2831853;
  col += vec3f(0.5, 0.55, 0.7) * glow(sdSeg(q, vec2f(0.0), vec2f(cos(ha), sin(ha)) * 0.97), 0.0022) * 0.5;

  for (var ring = 0u; ring < 3u; ring++) {
    let R = 0.92 - f32(ring) * 0.27;
    let flash = uf(5u + ring);
    let hue = select(select(0.08, 0.55, ring == 1u), 0.32, ring == 2u);
    col += hsv(hue, 0.4, 0.5) * glow(abs(length(q) - R), 0.0016) * 0.4;

    for (var s = 0u; s < ${b}u; s++) {
      let on = D[ring * ${b}u + s];
      let a = 1.5707963 - f32(s) * 6.2831853 / f32(${b});
      let p = vec2f(cos(a), sin(a)) * R;
      let d = length(q - p);
      if (on > 0.5) {
        // is the playhead on this step right now?
        let stepHead = fract(head * f32(${b}));
        let isNow = f32(u32(head * f32(${b})) % ${b}u == s) * (1.0 - stepHead * 0.7);
        col += hsv(hue, 0.7, 1.0) * (glow(d, 0.02 + flash * 0.012 * isNow) * (0.8 + isNow * 1.6) + halo(d, 0.012) * 0.3);
      } else {
        col += vec3f(0.07, 0.08, 0.13) * glow(d, 0.006);
      }
    }
    // ring pulse on hit
    col += hsv(hue, 0.6, 1.0) * glow(abs(length(q) - R), 0.012) * flash * 0.7;
  }
  return col * vignette(uv);
}
`;async function je(a){const e=await ie(),s=new ae(a,.62);if(!e)return oe(a);const h=new le(e,s.canvas,Le,3*b);ce(a);const n=[4,2,8],l=[0,4,0];let w=[0,1,2].map(t=>z(n[t],b,l[t]));const k=()=>{w=[0,1,2].map(t=>z(n[t],b,l[t]));for(let t=0;t<3;t++)for(let r=0;r<b;r++)h.data[t*b+r]=w[t][r]?1:0};k();const P=new _e({pitchDecay:.04,octaves:7,volume:-6}).connect(A()),C=new U(1800,"bandpass").connect(A()),x=new Y({noise:{type:"pink"},envelope:{attack:.001,decay:.16,sustain:0},volume:-8}).connect(C),$=new U(8e3,"highpass").connect(A()),q=new Y({noise:{type:"white"},envelope:{attack:.001,decay:.045,sustain:0},volume:-14}).connect($),_=[0,0,0],u=new he(104,4,(t,r)=>{const M=t%b;w[0][M]&&(P.triggerAttackRelease(55,.12,r),_[0]=1),w[1][M]&&(x.triggerAttackRelease(.16,r),_[1]=1),w[2][M]&&(q.triggerAttackRelease(.05,r),_[2]=1)}),E=()=>u.stop(),I=re(E);s.button("▶ play / stop",()=>{O().then(()=>{u.isRunning?E():u.start()})});const i=["kick hits","snare hits","hat hits"],p=[];for(const t of[0,1,2])p.push(s.slider({label:i[t],min:0,max:16,step:1,value:n[t],format:r=>`E(${r},16)`,onInput:r=>{n[t]=Math.round(r),k()}}));s.slider({label:"snare rotate",min:0,max:15,step:1,value:l[1],onInput:t=>{l[1]=Math.round(t),k()}}),s.slider({label:"tempo",min:70,max:150,step:1,value:u.bpm,format:t=>`${Math.round(t)} bpm`,onInput:t=>u.bpm=t});const f=(t,r,M,v,D)=>{s.button(t,()=>{[n[0],n[1],n[2],l[1]]=[r,M,v,D],p.forEach((F,d)=>F.value=String(n[d])),k(),O().then(()=>{u.isRunning||u.start()})})};return f("four on the floor",4,2,8,4),f("tresillo",3,2,8,4),f("son-ish",5,2,11,4),f("busy",7,5,13,2),s.setInfo(()=>`kick E(${n[0]},16) · snare E(${n[1]},16)+${l[1]} · hat E(${n[2]},16) · evenly spread by Euclid's algorithm`),{frame(){s.tick(),I.pulse();for(let t=0;t<3;t++)_[t]*=.88,h.uniforms[5+t]=_[t];h.uniforms[4]=u.isRunning?u.phase(b):0,h.draw()},dispose(){E()}}}const y=64,R=15,Oe=[0,2,4,5,7,9,11],ye=[{label:"I",degs:[0,2,4]},{label:"IV",degs:[3,5,0]},{label:"V",degs:[4,6,1]},{label:"I",degs:[0,2,4]}],Be=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let head = uf(4u);   // index of the newest trail slot
  let chord = u32(uf(5u));
  let pulse = uf(6u);
  var col = vec3f(0.0);

  // scale-degree lattice; chord-tone rows glow faintly
  for (var d = 0u; d < ${R}u; d++) {
    let y = 0.08 + f32(d) / f32(${R-1}) * 0.84;
    let isChord = D[${y}u + chord * ${R}u + d];
    col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - y), 0.0012);
    col += hsv(0.1, 0.7, 0.8) * glow(abs(uv.y - y), 0.0035) * isChord * (0.22 + pulse * 0.25);
  }

  // the walk: newest at the right edge, history scrolling left
  for (var i = 0u; i < ${y}u; i++) {
    let age = f32(i) / f32(${y}); // 0 = newest
    let slot = (u32(head) + ${y}u - i) % ${y}u;
    let deg = D[slot];
    if (deg < -0.5) { continue; } // rest
    let x = 0.96 - age * 0.92;
    let y = 0.08 + deg / f32(${R-1}) * 0.84;
    let bright = exp(-age * 2.6);
    let d = length(vec2f((uv.x - x) * uf(1u), uv.y - y));
    col += hsv(0.52 + deg * 0.014, 0.6, 1.0) * (glow(d, 0.012 + 0.01 * (1.0 - age)) * bright + halo(d, 0.008) * 0.25 * bright);
    // connecting thread to the previous note
    let slot2 = (slot + ${y}u - 1u) % ${y}u;
    let deg2 = D[slot2];
    if (deg2 > -0.5 && i + 1u < ${y}u) {
      let x2 = 0.96 - (age + 1.0 / f32(${y})) * 0.92;
      let y2 = 0.08 + deg2 / f32(${R-1}) * 0.84;
      let p = vec2f((uv.x) * uf(1u), uv.y);
      let dseg = sdSeg(p, vec2f(x * uf(1u), y), vec2f(x2 * uf(1u), y2));
      col += hsv(0.55, 0.5, 0.9) * glow(dseg, 0.0022) * bright * 0.5;
    }
  }
  return col * vignette(uv);
}
`;async function Ve(a){const e=await ie(),s=new ae(a,.52);if(!e)return oe(a);const h=new le(e,s.canvas,Be,y+4*R);ce(a);for(let i=0;i<4;i++)for(let p=0;p<R;p++)h.data[y+i*R+p]=ye[i].degs.includes(p%7)?1:0;h.data.fill(-1,0,y);let n=.75,l=.6,w=.8;const k=new Se({decay:2.2,wet:.25}).connect(A()),P=new V({oscillator:{type:"triangle"},envelope:{attack:.01,decay:.18,sustain:.3,release:.2},volume:-9}).connect(k),C=new Re(V,{oscillator:{type:"sine"},envelope:{attack:.1,decay:.5,sustain:.4,release:1.2},volume:-19}).connect(k);let x=7,$=0,q=0;const _=i=>60+Oe[i%7]+12*Math.floor(i/7),u=new he(96,2,(i,p)=>{const f=i%32,t=Math.floor(f/8)%4,r=ye[t];if(f%8===0){for(const D of r.degs)C.triggerAttackRelease(L(_(D)),2.2,p);q=1}if($=($+1)%y,Math.random()>w){h.data[$]=-1;return}const M=Math.random();let v;if(M<n*.35?v=x:M<n?v=x+(Math.random()<.5?-1:1):v=x+(Math.random()<.5?-1:1)*(2+Math.floor(Math.random()*3)),f%2===0&&Math.random()<l){let D=v,F=99;for(let d=v-3;d<=v+3;d++){if(d<0||d>=R||!r.degs.includes((d%7+7)%7))continue;const g=Math.abs(d-v);g<F&&(F=g,D=d)}v=D}x=Math.max(0,Math.min(R-1,v)),h.data[$]=x,P.triggerAttackRelease(L(_(x)),.22,p)}),E=()=>{u.stop(),C.releaseAll()},I=re(E);return s.button("▶ play / stop",()=>{O().then(()=>{u.isRunning?E():u.start()})}),s.slider({label:"smoothness (steps vs leaps)",min:0,max:1,step:.01,value:n,onInput:i=>n=i}),s.slider({label:"chord gravity",min:0,max:1,step:.01,value:l,onInput:i=>l=i}),s.slider({label:"note density",min:.2,max:1,step:.01,value:w,onInput:i=>w=i}),s.setInfo(()=>`I–IV–V–I under a random walk · current persona: ${l>.8?"arpeggio-bot":l<.2?"free-roaming":n>.8?"singer":n<.4?"bebop dice":"melody zone"}`),{frame(){s.tick(),I.pulse(),q*=.95,h.uniforms[4]=$,h.uniforms[5]=u.isRunning?Math.floor(u.phase(32)*32/8)%4:0,h.uniforms[6]=q,h.draw()},dispose(){E()}}}const j=64,be=[{name:"major",steps:[0,2,4,5,7,9,11],flavor:"bright"},{name:"mixolydian",steps:[0,2,4,5,7,9,10],flavor:"sunny slouch"},{name:"dorian",steps:[0,2,3,5,7,9,10],flavor:"hopeful minor"},{name:"aeolian",steps:[0,2,3,5,7,8,10],flavor:"melancholy"},{name:"pentatonic",steps:[0,2,4,7,9],flavor:"no wrong notes"}];function we(a){let e=a>>>0;return()=>{e|=0,e=e+1831565813|0;let s=Math.imul(e^e>>>15,1|e);return s=s+Math.imul(s^s>>>7,61|s)^s,((s^s>>>14)>>>0)/4294967296}}const We=`
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0)), u.x),
    u.y,
  );
}
// Sparse point stars: each grid cell may hold one star at a jittered position,
// drawn as a round gaussian glow so it stays crisp at any resolution.
fn stars(q: vec2f, density: f32, t: f32) -> f32 {
  let cell = floor(q * density);
  var v = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = cell + vec2f(f32(dx), f32(dy));
      let h = hash(c);
      if (h < 0.85) { continue; }
      let pos = (c + vec2f(hash(c + vec2f(1.3, 7.1)), hash(c + vec2f(4.7, 2.9)))) / density;
      let d = length(q - pos);
      let size = (0.35 + 0.65 * pow(hash(c + vec2f(9.2, 3.3)), 4.0)) * 0.011;
      let tw = 0.6 + 0.4 * sin(t * (1.0 + h * 4.0) + h * 40.0);
      v += (glow(d, size) + halo(d, size * 0.4) * 0.12) * tw * (h - 0.84) / 0.15;
    }
  }
  return v;
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var k = 0; k < 4; k++) {
    v += a * vnoise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let kick = uf(4u);
  let snare = uf(5u);
  let energy = uf(6u);
  let hueBase = uf(7u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.1;
  let r = length(q);
  let ang = atan2(q.y, q.x);

  // swirl: rotate sampling by noise and time
  let sw = fbm(q * 1.6 + vec2f(t * 0.05, -t * 0.04));
  let a2 = ang + sw * 1.8 + t * 0.03;

  // spectrum shell: radius indexes the FFT (log-ish), low bins at the core
  let binF = clamp(pow(r * 0.78, 1.35), 0.0, 0.999) * f32(${j-1});
  let bi = u32(binF);
  let mag = mix(D[bi], D[min(bi + 1u, ${j-1}u)], fract(binF));

  // angular filaments so the shell isn't a flat ring
  let fil = pow(fbm(vec2f(a2 * 1.9, r * 2.6 - t * 0.08)), 2.0);
  let glowAmt = mag * (0.35 + fil * 1.5);
  let hue = fract(hueBase + r * 0.22 + sw * 0.12);
  col += hsv(hue, 0.65, 1.0) * glowAmt * 1.35;

  // core breath
  col += hsv(fract(hueBase + 0.06), 0.5, 1.0) * glow(r, 0.16 + 0.05 * mag) * (0.25 + energy * 0.3);

  // kick: an expanding shock ring
  let ring = abs(r - (1.25 - kick * 1.0));
  col += vec3f(1.0, 0.85, 0.6) * glow(ring, 0.02 + 0.05 * kick) * kick * 0.9;
  // snare: a brief whole-field sparkle
  col += vec3f(0.7, 0.8, 1.0) * fil * snare * 0.5;

  // starfield dust: a far dim layer and a near bright one
  col += vec3f(0.7, 0.78, 1.0) * stars(q, 26.0, t) * 0.4;
  col += vec3f(0.95, 0.97, 1.0) * stars(q + vec2f(31.7, 17.3), 12.0, t * 0.7) * 0.7;

  return col * vignette(uv);
}
`;async function ze(a,e={}){const s=e.mode==="hero",h=await ie(),n=new ae(a,s?.5:.62);if(!h)return oe(a);const l=new le(h,n.canvas,We,j);ce(a,"tap to start the song");const w=new Se({decay:4,wet:.35}).connect(A()),k=new fe("3/8",.3);k.wet.value=.18,k.connect(w);const P=new Re(V,{oscillator:{type:"triangle"},envelope:{attack:.4,decay:.6,sustain:.5,release:2.5},volume:-17}).connect(w),C=new V({oscillator:{type:"square"},envelope:{attack:.01,decay:.15,sustain:.25,release:.3},volume:-16}).connect(k),x=new V({oscillator:{type:"sine"},envelope:{attack:.02,decay:.25,sustain:.5,release:.4},volume:-9}).connect(A()),$=new _e({pitchDecay:.04,octaves:7,volume:-7}).connect(A()),q=new U(1900,"bandpass").connect(A()),_=new Y({noise:{type:"pink"},envelope:{attack:.001,decay:.15,sustain:0},volume:-11}).connect(q),u=new U(8500,"highpass").connect(A()),E=new Y({noise:{type:"white"},envelope:{attack:.001,decay:.04,sustain:0},volume:-17}).connect(u);let I=s?2:0,i=.55,p=Math.floor(Math.random()*1e9),f=we(p),t=[0,5,3,4],r=[],M=[],v=[],D=0,F=.6,d=7;const g=()=>be[I],H=(o,c)=>{const m=g().steps,S=m.length;return c+D+m[(o%S+S)%S]+12*Math.floor(o/S)},de=o=>[o,o+2,o+4],J=()=>{f=we(p),D=Math.floor(f()*12),F=f();const o=g().steps.length,c=[3,5,1][Math.floor(f()*3)]%o,m=[4,3,5][Math.floor(f()*3)]%o,S=f()<.7?4%o:0;t=[0,c,m,S];const N=i;r=z(2+Math.round(N*3),16,0),M=z(f()<.5?2:3,16,4),v=z(4+Math.round(N*9),16,Math.floor(f()*2)),d=o+Math.floor(f()*o)};J();let Z=0,ee=0;const T=new he(s?92:100,4,(o,c)=>{const m=o%16,S=Math.floor(o/16)%4,N=t[S],B=i;if(r[m]&&($.triggerAttackRelease(50,.12,c),Z=1),M[m]&&B>.25&&(_.triggerAttackRelease(.15,c),ee=1),v[m]&&B>.12&&E.triggerAttackRelease(.04,c,.5+.5*Math.random()),m===0){for(const X of de(N))P.triggerAttackRelease(L(H(X,60)),4.2,c);x.triggerAttackRelease(L(H(N,36)),1.8,c)}if(m===8&&B>.4&&x.triggerAttackRelease(L(H(N,36)),.8,c),m%2===0&&Math.random()<.25+B*.6){const X=Math.random();if(X<.3||(X<.85?d+=Math.random()<.5?-1:1:d+=(Math.random()<.5?-1:1)*(2+Math.floor(Math.random()*2))),m%4===0){const Te=de(N).map(K=>(K%g().steps.length+g().steps.length)%g().steps.length);for(let K=0;K<3&&!Te.includes((d%g().steps.length+g().steps.length)%g().steps.length);K++)d+=Math.random()<.5?-1:1}d=Math.max(3,Math.min(2.6*g().steps.length,d)),C.triggerAttackRelease(L(H(Math.round(d),60)),.18,c,.5+B*.4)}}),te=()=>{T.stop(),P.releaseAll()},$e=re(te),Ee=()=>{T.isRunning?te():T.start()};n.canvas.addEventListener("pointerdown",()=>{O().then(()=>{T.isRunning||T.start()})}),n.button("▶ play / stop",()=>{O().then(Ee)}),n.button("✨ new song",()=>{p=Math.floor(Math.random()*1e9),J(),O().then(()=>{T.isRunning||T.start()})});let ue;n.button(`mode: ${g().name}`,()=>{I=(I+1)%be.length,J(),ue.textContent=`mode: ${g().name}`}),ue=n.controls.lastElementChild,s||(n.slider({label:"tempo",min:70,max:132,step:1,value:T.bpm,format:o=>`${Math.round(o)} bpm`,onInput:o=>T.bpm=o}),n.slider({label:"energy",min:0,max:1,step:.01,value:i,onInput:o=>{i=o,J()}})),n.setInfo(()=>{const o=t.map(c=>c+1).join("–");return`${Fe[D]} ${g().name} (${g().flavor}) · chords on degrees ${o} · seed ${p.toString(36)}`});const se=new Float32Array(j);return{frame(){n.tick(),$e.pulse(),Z*=.9,ee*=.86;const o=Ne();for(let c=0;c<j;c++){const m=o[Math.floor(c/j*100)],S=Math.max(0,(Number.isFinite(m)?m+95:0)/60);se[c]+=(Math.min(S,1.6)-se[c])*.25,l.data[c]=se[c]}l.uniforms[4]=Z,l.uniforms[5]=ee,l.uniforms[6]=i,l.uniforms[7]=F,l.draw()},dispose(){te()}}}Ae();const Ge={euclid:a=>je(a),walk:a=>Ve(a),jukebox:a=>ze(a)};for(const a of document.querySelectorAll("[data-demo]")){const e=Ge[a.dataset.demo];e&&qe(a,()=>e(a))}
