import{g as he,S as ue,a as fe,i as Ce,m as Qe}from"./gpu-DqzAFztT.js";import{T as F,o as Y,P as z,r as G,e as ce,G as U,g as Q,h as re,w as Pe,i as Le,I as we,A as Be,j as xe,k as Ve,E as We,l as Ee,q as ke,S as de,s as pe,M as Ae,m as A,f as ge,u as B,c as me,a as J,b as P,N as Ge,v as He}from"./audio-DykZGtJ8.js";import{N as _e,C as ze,M as Fe,R as Ie}from"./Reverb-bbDhZKFc.js";import{P as Te}from"./PolySynth-DlAqbwDN.js";class X extends F{constructor(){const e=Y(X.getDefaults(),arguments,["delayTime","maxDelay"]);super(e),this.name="Delay";const t=this.toSeconds(e.maxDelay);this._maxDelay=Math.max(t,this.toSeconds(e.delayTime)),this._delayNode=this.input=this.output=this.context.createDelay(t),this.delayTime=new z({context:this.context,param:this._delayNode.delayTime,units:"time",value:e.delayTime,minValue:0,maxValue:this.maxDelay}),G(this,"delayTime")}static getDefaults(){return Object.assign(F.getDefaults(),{delayTime:0,maxDelay:1})}get maxDelay(){return this._maxDelay}dispose(){return super.dispose(),this._delayNode.disconnect(),this.delayTime.dispose(),this}}class ne extends F{constructor(){const e=Y(ne.getDefaults(),arguments,["frequency","type"]);super(e),this.name="BiquadFilter",this._filter=this.context.createBiquadFilter(),this.input=this.output=this._filter,this.Q=new z({context:this.context,units:"number",value:e.Q,param:this._filter.Q}),this.frequency=new z({context:this.context,units:"frequency",value:e.frequency,param:this._filter.frequency}),this.detune=new z({context:this.context,units:"cents",value:e.detune,param:this._filter.detune}),this.gain=new z({context:this.context,units:"decibels",convert:!1,value:e.gain,param:this._filter.gain}),this.type=e.type}static getDefaults(){return Object.assign(F.getDefaults(),{Q:1,type:"lowpass",frequency:350,detune:0,gain:0})}get type(){return this._filter.type}set type(e){ce(["lowpass","highpass","bandpass","lowshelf","highshelf","notch","allpass","peaking"].indexOf(e)!==-1,`Invalid filter type: ${e}`),this._filter.type=e}getFrequencyResponse(e=128){const t=new Float32Array(e);for(let l=0;l<e;l++){const I=Math.pow(l/e,2)*19980+20;t[l]=I}const o=new Float32Array(e),s=new Float32Array(e),n=this.context.createBiquadFilter();return n.type=this.type,n.Q.value=this.Q.value,n.frequency.value=this.frequency.value,n.gain.value=this.gain.value,n.getFrequencyResponse(t,o,s),o}dispose(){return super.dispose(),this._filter.disconnect(),this.Q.dispose(),this.frequency.dispose(),this.gain.dispose(),this.detune.dispose(),this}}class V extends F{constructor(){const e=Y(V.getDefaults(),arguments,["frequency","type","rolloff"]);super(e),this.name="Filter",this.input=new U({context:this.context}),this.output=new U({context:this.context}),this._filters=[],this._filters=[],this.Q=new Q({context:this.context,units:"positive",value:e.Q}),this.frequency=new Q({context:this.context,units:"frequency",value:e.frequency}),this.detune=new Q({context:this.context,units:"cents",value:e.detune}),this.gain=new Q({context:this.context,units:"decibels",convert:!1,value:e.gain}),this._type=e.type,this.rolloff=e.rolloff,G(this,["detune","frequency","gain","Q"])}static getDefaults(){return Object.assign(F.getDefaults(),{Q:1,detune:0,frequency:350,gain:0,rolloff:-12,type:"lowpass"})}get type(){return this._type}set type(e){ce(["lowpass","highpass","bandpass","lowshelf","highshelf","notch","allpass","peaking"].indexOf(e)!==-1,`Invalid filter type: ${e}`),this._type=e,this._filters.forEach(o=>o.type=e)}get rolloff(){return this._rolloff}set rolloff(e){const t=Le(e)?e:parseInt(e,10),o=[-12,-24,-48,-96];let s=o.indexOf(t);ce(s!==-1,`rolloff can only be ${o.join(", ")}`),s+=1,this._rolloff=t,this.input.disconnect(),this._filters.forEach(n=>n.disconnect()),this._filters=new Array(s);for(let n=0;n<s;n++){const l=new ne({context:this.context});l.type=this._type,this.frequency.connect(l.frequency),this.detune.connect(l.detune),this.Q.connect(l.Q),this.gain.connect(l.gain),this._filters[n]=l}this._internalChannels=this._filters,re(this.input,...this._internalChannels,this.output)}getFrequencyResponse(e=128){const t=new ne({context:this.context,frequency:this.frequency.value,gain:this.gain.value,Q:this.Q.value,type:this._type,detune:this.detune.value}),o=new Float32Array(e).map(()=>1);return this._filters.forEach(()=>{t.getFrequencyResponse(e).forEach((n,l)=>o[l]*=n)}),t.dispose(),o}dispose(){return super.dispose(),this._filters.forEach(e=>{e.dispose()}),Pe(this,["detune","frequency","gain","Q"]),this.frequency.dispose(),this.Q.dispose(),this.detune.dispose(),this.gain.dispose(),this}}class W extends we{constructor(){const e=Y(W.getDefaults(),arguments);super(e),this.name="NoiseSynth",this.noise=new _e(Object.assign({context:this.context},e.noise)),this.envelope=new Be(Object.assign({context:this.context},e.envelope)),this.noise.chain(this.envelope,this.output)}static getDefaults(){return Object.assign(we.getDefaults(),{envelope:Object.assign(xe(We.getDefaults(),Object.keys(F.getDefaults())),{decay:.1,sustain:0}),noise:Object.assign(xe(_e.getDefaults(),Object.keys(Ve.getDefaults())),{type:"white"})})}triggerAttack(e,t=1){return e=this.toSeconds(e),this.envelope.triggerAttack(e,t),this.noise.start(e),this.envelope.sustain===0&&this.noise.stop(e+this.toSeconds(this.envelope.attack)+this.toSeconds(this.envelope.decay)),this}triggerRelease(e){return e=this.toSeconds(e),this.envelope.triggerRelease(e),this.noise.stop(e+this.toSeconds(this.envelope.release)),this}sync(){return this._syncState()&&(this._syncMethod("triggerAttack",0),this._syncMethod("triggerRelease",0)),this}triggerAttackRelease(e,t,o=1){return t=this.toSeconds(t),e=this.toSeconds(e),this.triggerAttack(t,o),this.triggerRelease(t+e),this}dispose(){return super.dispose(),this.noise.dispose(),this.envelope.dispose(),this}}class Me extends F{constructor(e){super(e),this.name="StereoEffect",this.input=new U({context:this.context}),this.input.channelCount=2,this.input.channelCountMode="explicit",this._dryWet=this.output=new ze({context:this.context,fade:e.wet}),this.wet=this._dryWet.fade,this._split=new Ee({context:this.context,channels:2}),this._merge=new Fe({context:this.context,channels:2}),this.input.connect(this._split),this.input.connect(this._dryWet.a),this._merge.connect(this._dryWet.b),G(this,["wet"])}connectEffectLeft(...e){this._split.connect(e[0],0,0),re(...e),ke(e[e.length-1],this._merge,0,0)}connectEffectRight(...e){this._split.connect(e[0],1,0),re(...e),ke(e[e.length-1],this._merge,0,1)}static getDefaults(){return Object.assign(F.getDefaults(),{wet:1})}dispose(){return super.dispose(),this._dryWet.dispose(),this._split.dispose(),this._merge.dispose(),this}}class Je extends Me{constructor(e){super(e),this.feedback=new Q({context:this.context,value:e.feedback,units:"normalRange"}),this._feedbackL=new U({context:this.context}),this._feedbackR=new U({context:this.context}),this._feedbackSplit=new Ee({context:this.context,channels:2}),this._feedbackMerge=new Fe({context:this.context,channels:2}),this._merge.connect(this._feedbackSplit),this._feedbackMerge.connect(this._split),this._feedbackSplit.connect(this._feedbackL,0,0),this._feedbackL.connect(this._feedbackMerge,0,0),this._feedbackSplit.connect(this._feedbackR,1,0),this._feedbackR.connect(this._feedbackMerge,0,1),this.feedback.fan(this._feedbackL.gain,this._feedbackR.gain),G(this,["feedback"])}static getDefaults(){return Object.assign(Me.getDefaults(),{feedback:.5})}dispose(){return super.dispose(),this.feedback.dispose(),this._feedbackL.dispose(),this._feedbackR.dispose(),this._feedbackSplit.dispose(),this._feedbackMerge.dispose(),this}}class De extends Je{constructor(e){super(e),this._feedbackL.disconnect(),this._feedbackL.connect(this._feedbackMerge,0,1),this._feedbackR.disconnect(),this._feedbackR.connect(this._feedbackMerge,0,0),G(this,["feedback"])}}class ye extends De{constructor(){const e=Y(ye.getDefaults(),arguments,["delayTime","feedback"]);super(e),this.name="PingPongDelay",this._leftDelay=new X({context:this.context,maxDelay:e.maxDelay}),this._rightDelay=new X({context:this.context,maxDelay:e.maxDelay}),this._rightPreDelay=new X({context:this.context,maxDelay:e.maxDelay}),this.delayTime=new Q({context:this.context,units:"time",value:e.delayTime}),this.connectEffectLeft(this._leftDelay),this.connectEffectRight(this._rightPreDelay,this._rightDelay),this.delayTime.fan(this._leftDelay.delayTime,this._rightDelay.delayTime,this._rightPreDelay.delayTime),this._feedbackL.disconnect(),this._feedbackL.connect(this._rightDelay),G(this,["delayTime"])}static getDefaults(){return Object.assign(De.getDefaults(),{delayTime:.25,maxDelay:1})}dispose(){return super.dispose(),this._leftDelay.dispose(),this._rightDelay.dispose(),this._rightPreDelay.dispose(),this.delayTime.dispose(),this}}const w=16;function K(i,e,t=0){const o=[];for(let s=0;s<e;s++){const n=((s-t)%e+e)%e;o.push(Math.floor((n+1)*i/e)!==Math.floor(n*i/e))}return o}const Xe=`
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

    for (var s = 0u; s < ${w}u; s++) {
      let on = D[ring * ${w}u + s];
      let a = 1.5707963 - f32(s) * 6.2831853 / f32(${w});
      let p = vec2f(cos(a), sin(a)) * R;
      let d = length(q - p);
      if (on > 0.5) {
        // is the playhead on this step right now?
        let stepHead = fract(head * f32(${w}));
        let isNow = f32(u32(head * f32(${w})) % ${w}u == s) * (1.0 - stepHead * 0.7);
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
`;async function Ke(i){const e=await he(),t=new ue(i,.62);if(!e)return fe(i);const o=new de(e,t.canvas,Xe,3*w);pe(i);const s=[4,2,8],n=[0,4,0];let l=[0,1,2].map(a=>K(s[a],w,n[a]));const x=()=>{l=[0,1,2].map(a=>K(s[a],w,n[a]));for(let a=0;a<3;a++)for(let u=0;u<w;u++)o.data[a*w+u]=l[a][u]?1:0};x();const I=new Ae({pitchDecay:.04,octaves:7,volume:-6}).connect(A()),C=new V(1800,"bandpass").connect(A()),k=new W({noise:{type:"pink"},envelope:{attack:.001,decay:.16,sustain:0},volume:-8}).connect(C),R=new V(8e3,"highpass").connect(A()),T=new W({noise:{type:"white"},envelope:{attack:.001,decay:.045,sustain:0},volume:-14}).connect(R),M=[0,0,0],p=new me(104,4,(a,u)=>{const _=a%w;l[0][_]&&(I.triggerAttackRelease(55,.12,u),M[0]=1),l[1][_]&&(k.triggerAttackRelease(.16,u),M[1]=1),l[2][_]&&(T.triggerAttackRelease(.05,u),M[2]=1)}),$=()=>p.stop(),O=ge($);t.button("▶ play / stop",()=>{B().then(()=>{p.isRunning?$():p.start()})});const r=["kick hits","snare hits","hat hits"],m=[];for(const a of[0,1,2])m.push(t.slider({label:r[a],min:0,max:16,step:1,value:s[a],format:u=>`E(${u},16)`,onInput:u=>{s[a]=Math.round(u),x()}}));t.slider({label:"snare rotate",min:0,max:15,step:1,value:n[1],onInput:a=>{n[1]=Math.round(a),x()}}),t.slider({label:"tempo",min:70,max:150,step:1,value:p.bpm,format:a=>`${Math.round(a)} bpm`,onInput:a=>p.bpm=a});const f=(a,u,_,v,D)=>{t.button(a,()=>{[s[0],s[1],s[2],n[1]]=[u,_,v,D],m.forEach((N,d)=>N.value=String(s[d])),x(),B().then(()=>{p.isRunning||p.start()})})};return f("four on the floor",4,2,8,4),f("tresillo",3,2,8,4),f("son-ish",5,2,11,4),f("busy",7,5,13,2),t.setInfo(()=>`kick E(${s[0]},16) · snare E(${s[1]},16)+${n[1]} · hat E(${s[2]},16) · evenly spread by Euclid's algorithm`),{frame(){t.tick(),O.pulse();for(let a=0;a<3;a++)M[a]*=.88,o.uniforms[5+a]=M[a];o.uniforms[4]=p.isRunning?p.phase(w):0,o.draw()},dispose(){$()}}}const b=64,q=15,Ue=[0,2,4,5,7,9,11],Se=[{label:"I",degs:[0,2,4]},{label:"IV",degs:[3,5,0]},{label:"V",degs:[4,6,1]},{label:"I",degs:[0,2,4]}],Ye=`
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let head = uf(4u);   // index of the newest trail slot
  let chord = u32(uf(5u));
  let pulse = uf(6u);
  var col = vec3f(0.0);

  // scale-degree lattice; chord-tone rows glow faintly
  for (var d = 0u; d < ${q}u; d++) {
    let y = 0.08 + f32(d) / f32(${q-1}) * 0.84;
    let isChord = D[${b}u + chord * ${q}u + d];
    col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - y), 0.0012);
    col += hsv(0.1, 0.7, 0.8) * glow(abs(uv.y - y), 0.0035) * isChord * (0.22 + pulse * 0.25);
  }

  // the walk: newest at the right edge, history scrolling left
  for (var i = 0u; i < ${b}u; i++) {
    let age = f32(i) / f32(${b}); // 0 = newest
    let slot = (u32(head) + ${b}u - i) % ${b}u;
    let deg = D[slot];
    if (deg < -0.5) { continue; } // rest
    let x = 0.96 - age * 0.92;
    let y = 0.08 + deg / f32(${q-1}) * 0.84;
    let bright = exp(-age * 2.6);
    let d = length(vec2f((uv.x - x) * uf(1u), uv.y - y));
    col += hsv(0.52 + deg * 0.014, 0.6, 1.0) * (glow(d, 0.012 + 0.01 * (1.0 - age)) * bright + halo(d, 0.008) * 0.25 * bright);
    // connecting thread to the previous note
    let slot2 = (slot + ${b}u - 1u) % ${b}u;
    let deg2 = D[slot2];
    if (deg2 > -0.5 && i + 1u < ${b}u) {
      let x2 = 0.96 - (age + 1.0 / f32(${b})) * 0.92;
      let y2 = 0.08 + deg2 / f32(${q-1}) * 0.84;
      let p = vec2f((uv.x) * uf(1u), uv.y);
      let dseg = sdSeg(p, vec2f(x * uf(1u), y), vec2f(x2 * uf(1u), y2));
      col += hsv(0.55, 0.5, 0.9) * glow(dseg, 0.0022) * bright * 0.5;
    }
  }
  return col * vignette(uv);
}
`;async function Ze(i){const e=await he(),t=new ue(i,.52);if(!e)return fe(i);const o=new de(e,t.canvas,Ye,b+4*q);pe(i);for(let r=0;r<4;r++)for(let m=0;m<q;m++)o.data[b+r*q+m]=Se[r].degs.includes(m%7)?1:0;o.data.fill(-1,0,b);let s=.75,n=.6,l=.8;const x=new Ie({decay:2.2,wet:.25}).connect(A()),I=new J({oscillator:{type:"triangle"},envelope:{attack:.01,decay:.18,sustain:.3,release:.2},volume:-9}).connect(x),C=new Te(J,{oscillator:{type:"sine"},envelope:{attack:.1,decay:.5,sustain:.4,release:1.2},volume:-19}).connect(x);let k=7,R=0,T=0;const M=r=>60+Ue[r%7]+12*Math.floor(r/7),p=new me(96,2,(r,m)=>{const f=r%32,a=Math.floor(f/8)%4,u=Se[a];if(f%8===0){for(const D of u.degs)C.triggerAttackRelease(P(M(D)),2.2,m);T=1}if(R=(R+1)%b,Math.random()>l){o.data[R]=-1;return}const _=Math.random();let v;if(_<s*.35?v=k:_<s?v=k+(Math.random()<.5?-1:1):v=k+(Math.random()<.5?-1:1)*(2+Math.floor(Math.random()*3)),f%2===0&&Math.random()<n){let D=v,N=99;for(let d=v-3;d<=v+3;d++){if(d<0||d>=q||!u.degs.includes((d%7+7)%7))continue;const g=Math.abs(d-v);g<N&&(N=g,D=d)}v=D}k=Math.max(0,Math.min(q-1,v)),o.data[R]=k,I.triggerAttackRelease(P(M(k)),.22,m)}),$=()=>{p.stop(),C.releaseAll()},O=ge($);return t.button("▶ play / stop",()=>{B().then(()=>{p.isRunning?$():p.start()})}),t.slider({label:"smoothness (steps vs leaps)",min:0,max:1,step:.01,value:s,onInput:r=>s=r}),t.slider({label:"chord gravity",min:0,max:1,step:.01,value:n,onInput:r=>n=r}),t.slider({label:"note density",min:.2,max:1,step:.01,value:l,onInput:r=>l=r}),t.setInfo(()=>`I–IV–V–I under a random walk · current persona: ${n>.8?"arpeggio-bot":n<.2?"free-roaming":s>.8?"singer":s<.4?"bebop dice":"melody zone"}`),{frame(){t.tick(),O.pulse(),T*=.95,o.uniforms[4]=R,o.uniforms[5]=p.isRunning?Math.floor(p.phase(32)*32/8)%4:0,o.uniforms[6]=T,o.draw()},dispose(){$()}}}const L=64,qe=[{name:"major",steps:[0,2,4,5,7,9,11],flavor:"bright"},{name:"mixolydian",steps:[0,2,4,5,7,9,10],flavor:"sunny slouch"},{name:"dorian",steps:[0,2,3,5,7,9,10],flavor:"hopeful minor"},{name:"aeolian",steps:[0,2,3,5,7,8,10],flavor:"melancholy"},{name:"pentatonic",steps:[0,2,4,7,9],flavor:"no wrong notes"}];function Re(i){let e=i>>>0;return()=>{e|=0,e=e+1831565813|0;let t=Math.imul(e^e>>>15,1|e);return t=t+Math.imul(t^t>>>7,61|t)^t,((t^t>>>14)>>>0)/4294967296}}const et=`
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
  let binF = clamp(pow(r * 0.78, 1.35), 0.0, 0.999) * f32(${L-1});
  let bi = u32(binF);
  let mag = mix(D[bi], D[min(bi + 1u, ${L-1}u)], fract(binF));

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

  // starfield dust
  let star = pow(hash(floor(q * 60.0 + vec2f(7.0))), 60.0);
  col += vec3f(star) * 0.5 * (0.4 + 0.6 * sin(t * 2.0 + hash(floor(q * 60.0)) * 40.0));

  return col * vignette(uv);
}
`;async function $e(i,e={}){const t=e.mode==="hero",o=await he(),s=new ue(i,t?.5:.62);if(!o)return fe(i);const n=new de(o,s.canvas,et,L);pe(i,"tap to start the song");const l=new Ie({decay:4,wet:.35}).connect(A()),x=new ye("3/8",.3);x.wet.value=.18,x.connect(l);const I=new Te(J,{oscillator:{type:"triangle"},envelope:{attack:.4,decay:.6,sustain:.5,release:2.5},volume:-17}).connect(l),C=new J({oscillator:{type:"square"},envelope:{attack:.01,decay:.15,sustain:.25,release:.3},volume:-16}).connect(x),k=new J({oscillator:{type:"sine"},envelope:{attack:.02,decay:.25,sustain:.5,release:.4},volume:-9}).connect(A()),R=new Ae({pitchDecay:.04,octaves:7,volume:-7}).connect(A()),T=new V(1900,"bandpass").connect(A()),M=new W({noise:{type:"pink"},envelope:{attack:.001,decay:.15,sustain:0},volume:-11}).connect(T),p=new V(8500,"highpass").connect(A()),$=new W({noise:{type:"white"},envelope:{attack:.001,decay:.04,sustain:0},volume:-17}).connect(p);let O=t?2:0,r=.55,m=Math.floor(Math.random()*1e9),f=Re(m),a=[0,5,3,4],u=[],_=[],v=[],D=0,N=.6,d=7;const g=()=>qe[O],Z=(c,h)=>{const y=g().steps,S=y.length;return h+D+y[(c%S+S)%S]+12*Math.floor(c/S)},ve=c=>[c,c+2,c+4],ee=()=>{f=Re(m),D=Math.floor(f()*12),N=f();const c=g().steps.length,h=[3,5,1][Math.floor(f()*3)]%c,y=[4,3,5][Math.floor(f()*3)]%c,S=f()<.7?4%c:0;a=[0,h,y,S];const j=r;u=K(2+Math.round(j*3),16,0),_=K(f()<.5?2:3,16,4),v=K(4+Math.round(j*9),16,Math.floor(f()*2)),d=c+Math.floor(f()*c)};ee();let ae=0,oe=0;const E=new me(t?92:100,4,(c,h)=>{const y=c%16,S=Math.floor(c/16)%4,j=a[S],H=r;if(u[y]&&(R.triggerAttackRelease(50,.12,h),ae=1),_[y]&&H>.25&&(M.triggerAttackRelease(.15,h),oe=1),v[y]&&H>.12&&$.triggerAttackRelease(.04,h,.5+.5*Math.random()),y===0){for(const te of ve(j))I.triggerAttackRelease(P(Z(te,60)),4.2,h);k.triggerAttackRelease(P(Z(j,36)),1.8,h)}if(y===8&&H>.4&&k.triggerAttackRelease(P(Z(j,36)),.8,h),y%2===0&&Math.random()<.25+H*.6){const te=Math.random();if(te<.3||(te<.85?d+=Math.random()<.5?-1:1:d+=(Math.random()<.5?-1:1)*(2+Math.floor(Math.random()*2))),y%4===0){const je=ve(j).map(se=>(se%g().steps.length+g().steps.length)%g().steps.length);for(let se=0;se<3&&!je.includes((d%g().steps.length+g().steps.length)%g().steps.length);se++)d+=Math.random()<.5?-1:1}d=Math.max(3,Math.min(2.6*g().steps.length,d)),C.triggerAttackRelease(P(Z(Math.round(d),60)),.18,h,.5+H*.4)}}),ie=()=>{E.stop(),I.releaseAll()},Oe=ge(ie),Ne=()=>{E.isRunning?ie():E.start()};s.canvas.addEventListener("pointerdown",()=>{B().then(()=>{E.isRunning||E.start()})}),s.button("▶ play / stop",()=>{B().then(Ne)}),s.button("✨ new song",()=>{m=Math.floor(Math.random()*1e9),ee(),B().then(()=>{E.isRunning||E.start()})});let be;s.button(`mode: ${g().name}`,()=>{O=(O+1)%qe.length,ee(),be.textContent=`mode: ${g().name}`}),be=s.controls.lastElementChild,t||(s.slider({label:"tempo",min:70,max:132,step:1,value:E.bpm,format:c=>`${Math.round(c)} bpm`,onInput:c=>E.bpm=c}),s.slider({label:"energy",min:0,max:1,step:.01,value:r,onInput:c=>{r=c,ee()}})),s.setInfo(()=>{const c=a.map(h=>h+1).join("–");return`${Ge[D]} ${g().name} (${g().flavor}) · chords on degrees ${c} · seed ${m.toString(36)}`});const le=new Float32Array(L);return{frame(){s.tick(),Oe.pulse(),ae*=.9,oe*=.86;const c=He();for(let h=0;h<L;h++){const y=c[Math.floor(h/L*100)],S=Math.max(0,(Number.isFinite(y)?y+95:0)/60);le[h]+=(Math.min(S,1.6)-le[h])*.25,n.data[h]=le[h]}n.uniforms[4]=ae,n.uniforms[5]=oe,n.uniforms[6]=r,n.uniforms[7]=N,n.draw()},dispose(){ie()}}}Ce();const tt={hero:i=>$e(i,{mode:"hero"}),euclid:i=>Ke(i),walk:i=>Ze(i),jukebox:i=>$e(i)};for(const i of document.querySelectorAll("[data-demo]")){const e=tt[i.dataset.demo];e&&Qe(i,()=>e(i))}
