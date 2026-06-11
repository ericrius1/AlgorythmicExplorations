import{g as O,S as P,a as F,i as tt,m as et}from"./gpu-DqzAFztT.js";import{g as I,o as N,G as E,h as st,z as H,U as nt,q as at,V as ot,T as it,P as C,O as A,X as rt,r as lt,Y as ct,S as z,s as G,m as L,f as R,u as q,Z as Y,$ as J,a0 as K,a1 as ut,n as W}from"./audio-C6wRk_Ux.js";class B extends I{constructor(){super(N(B.getDefaults(),arguments,["value"])),this.override=!1,this.name="Add",this._sum=new E({context:this.context}),this.input=this._sum,this.output=this._sum,this.addend=this._param,st(this._constantSource,this._sum)}static getDefaults(){return Object.assign(I.getDefaults(),{value:0})}dispose(){return super.dispose(),this._sum.dispose(),this}}class j extends H{constructor(){const t=N(j.getDefaults(),arguments,["min","max"]);super(t),this.name="Scale",this._mult=this.input=new nt({context:this.context,value:t.max-t.min}),this._add=this.output=new B({context:this.context,value:t.min}),this._min=t.min,this._max=t.max,this.input.connect(this.output)}static getDefaults(){return Object.assign(H.getDefaults(),{max:1,min:0})}get min(){return this._min}set min(t){this._min=t,this._setRange()}get max(){return this._max}set max(t){this._max=t,this._setRange()}_setRange(){this._add.value=this._min,this._mult.value=this._max-this._min}dispose(){return super.dispose(),this._add.dispose(),this._mult.dispose(),this}}class Z extends H{constructor(){super(N(Z.getDefaults(),arguments)),this.name="Zero",this._gain=new E({context:this.context}),this.output=this._gain,this.input=void 0,at(this.context.getConstant(0),this._gain)}dispose(){return super.dispose(),ot(this.context.getConstant(0),this._gain),this}}class U extends it{constructor(){const t=N(U.getDefaults(),arguments,["frequency","min","max"]);super(t),this.name="LFO",this._stoppedValue=0,this._units="number",this.convert=!0,this._fromType=C.prototype._fromType,this._toType=C.prototype._toType,this._is=C.prototype._is,this._clampValue=C.prototype._clampValue,this._oscillator=new A(t),this.frequency=this._oscillator.frequency,this._amplitudeGain=new E({context:this.context,gain:t.amplitude,units:"normalRange"}),this.amplitude=this._amplitudeGain.gain,this._stoppedSignal=new I({context:this.context,units:"audioRange",value:0}),this._zeros=new Z({context:this.context}),this._a2g=new rt({context:this.context}),this._scaler=this.output=new j({context:this.context,max:t.max,min:t.min}),this.units=t.units,this.min=t.min,this.max=t.max,this._oscillator.chain(this._amplitudeGain,this._a2g,this._scaler),this._zeros.connect(this._a2g),this._stoppedSignal.connect(this._a2g),lt(this,["amplitude","frequency"]),this.phase=t.phase}static getDefaults(){return Object.assign(A.getDefaults(),{amplitude:1,frequency:"4n",max:1,min:0,type:"sine",units:"number"})}start(t){return t=this.toSeconds(t),this._stoppedSignal.setValueAtTime(0,t),this._oscillator.start(t),this}stop(t){return t=this.toSeconds(t),this._stoppedSignal.setValueAtTime(this._stoppedValue,t),this._oscillator.stop(t),this}sync(){return this._oscillator.sync(),this._oscillator.syncFrequency(),this}unsync(){return this._oscillator.unsync(),this._oscillator.unsyncFrequency(),this}_setStoppedValue(){this._stoppedValue=this._oscillator.getInitialValue(),this._stoppedSignal.value=this._stoppedValue}get min(){return this._toType(this._scaler.min)}set min(t){t=this._fromType(t),this._scaler.min=t}get max(){return this._toType(this._scaler.max)}set max(t){t=this._fromType(t),this._scaler.max=t}get type(){return this._oscillator.type}set type(t){this._oscillator.type=t,this._setStoppedValue()}get partials(){return this._oscillator.partials}set partials(t){this._oscillator.partials=t,this._setStoppedValue()}get phase(){return this._oscillator.phase}set phase(t){this._oscillator.phase=t,this._setStoppedValue()}get units(){return this._units}set units(t){const n=this.min,p=this.max;this._units=t,this.min=n,this.max=p}get state(){return this._oscillator.state}connect(t,n,p){return(t instanceof C||t instanceof I)&&(this.convert=t.convert,this.units=t.units),ct(this,t,n,p),this}dispose(){return super.dispose(),this._oscillator.dispose(),this._stoppedSignal.dispose(),this._zeros.dispose(),this._scaler.dispose(),this._a2g.dispose(),this._amplitudeGain.dispose(),this.amplitude.dispose(),this}}const V=256,ht=`
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${V-1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${V-1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let level = uf(4u);
  var col = vec3f(0.0);

  // deep background: slow interference shimmer, the "air"
  let a = sin(uv.x * 9.0 + t * 0.31) * sin(uv.y * 7.0 - t * 0.23);
  let b = sin(uv.x * 15.0 - t * 0.17 + uv.y * 4.0);
  col += vec3f(0.016, 0.02, 0.045) * (0.6 + 0.4 * a) + vec3f(0.02, 0.012, 0.04) * (0.5 + 0.5 * b);

  // echo lines: the same wave, displaced and faded, like pressure fronts
  for (var k = 1; k <= 3; k++) {
    let off = f32(k) * 0.13;
    let yk = 0.5 + sample(uv.x) * (0.16 - f32(k) * 0.03);
    let d = abs(uv.y - yk - off) + abs(uv.y - yk + off) - 2.0 * off;
    col += hsv(0.62 + f32(k) * 0.04, 0.75, 1.0) * halo(d, 0.0035) * 0.05 / f32(k);
  }

  // the note itself
  let y = 0.5 + sample(uv.x) * 0.19;
  let d = abs(uv.y - y);
  let hue = 0.58 - level * 0.07 + 0.03 * sin(t * 0.4);
  col += hsv(hue, 0.55, 1.0) * (glow(d, 0.004 + level * 0.003) * 1.1 + halo(d, 0.006) * 0.35);

  return col * vignette(uv);
}
`;async function ft(c){const t=await O(),n=new P(c,.42);if(!t)return F(c);const p=new z(t,n.canvas,ht,V);G(c,"tap to hear the note");let o=!1;const g=new E(0).connect(L()),d=new A(220,"sine").connect(g);d.partials=[1,.28,.14,.07,.04];const x=new U(4.6,218.6,221.4);let v=0;const y=u=>{u!==o&&(o=u,u?(d.state!=="started"&&(d.start(),x.connect(d.frequency).start()),g.gain.rampTo(.5,.8)):g.gain.rampTo(0,.6))},$=R(()=>y(!1));n.canvas.addEventListener("pointerdown",()=>{q().then(()=>y(!o))}),n.setInfo(()=>o?"live — this line is your speaker output · tap to hush":"A · 220 Hz · tap to hear it");let _=0;return{frame(){if(n.tick(),$.pulse(),v+=((o?1:0)-v)*.04,p.uniforms[4]=v,Y()&&v>.25){const u=J();let m=0;for(let i=1;i<u.length-V;i++)if(u[i-1]<=0&&u[i]>0){m=i;break}for(let i=0;i<V;i++)p.data[i]=u[m+i]*1.4}else{_+=.012;const u=.55+.12*Math.sin(_*.7);for(let m=0;m<V;m++){const i=m/(V-1);p.data[m]=u*(Math.sin(2*Math.PI*(3*i-_))+.22*Math.sin(2*Math.PI*(6*i-2*_))+.1*Math.sin(2*Math.PI*(9*i-3*_)))}}p.draw()},dispose(){y(!1)}}}const D=512,pt=`
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${D-1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${D-1}u)], fract(f));
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
`;async function mt(c){const t=await O(),n=new P(c,.5);if(!t)return F(c);const p=new z(t,n.canvas,pt,D);G(c);let o=220,g="sine",d=!1;const x=new E(0).connect(L()),v=new A(o,"sine").connect(x),y=e=>{e!==d&&(d=e,e&&v.state!=="started"&&v.start(),x.gain.rampTo(e?.35:0,.1))},$=R(()=>{y(!1),m()});let _;const u=[],m=()=>{_.textContent=d?"■ stop":"▶ play";for(const[e,a]of u)a.style.borderColor=e===g?"var(--accent)":"var(--border)"};n.button("▶ play",()=>{q().then(()=>{y(!d),m()})}),_=n.controls.lastElementChild;for(const e of["sine","triangle","square","sawtooth"])n.button(e==="sawtooth"?"saw":e,()=>{g=e,v.type=e,m()}),u.push([e,n.controls.lastElementChild]);n.slider({label:"frequency",min:55,max:880,step:1,value:o,log:!0,format:e=>`${Math.round(e)} Hz`,onInput:e=>{o=e,v.frequency.rampTo(e,.03)}}),m(),n.setInfo(()=>`${K(o)} · period ${(1e3/o).toFixed(2)} ms · ${Math.round(o)} repeats per second`);const i=(e,a)=>{const l=a-Math.floor(a);switch(e){case"sine":return Math.sin(2*Math.PI*l);case"square":return l<.5?1:-1;case"sawtooth":return 2*l-1;case"triangle":return l<.5?4*l-1:3-4*l}};return{frame(){n.tick(),$.pulse();const e=ut().sampleRate,a=D/e;if(p.uniforms[4]=1/o/a,p.uniforms[5]=d?1:0,d&&Y()){const l=J();let s=0;for(let r=1;r<l.length-D;r++)if(l[r-1]<=0&&l[r]>0){s=r;break}for(let r=0;r<D;r++)p.data[r]=l[Math.min(s+r,l.length-1)]*2}else{const l=o*a;for(let s=0;s<D;s++)p.data[s]=i(g,s/D*l)*.7}p.draw()},dispose(){y(!1)}}}const f=160,T=10,X=80,dt=`
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${f-1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${f-1}u)], fract(f));
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
    let amp = D[${f}u + u32(n - 1)];
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
  for (var n = 0u; n < ${T}u; n++) {
    let amp = D[${f}u + n];
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
`;async function vt(c){const t=await O(),n=new P(c,.52);if(!t)return F(c);const p=new z(t,n.canvas,dt,f+T);G(c,"drag the string, let go");let o=110;const g=[],d=[],x={t:-1},v=new Float32Array(T);for(let s=1;s<=T;s++){const r=new E(0).connect(L()),h=new A(o*s,"sine").connect(r);g.push(h),d.push(r)}const y=s=>3.2/(1+.45*(s-1)),$=()=>{for(const s of d)s.gain.cancelScheduledValues(W());for(const s of d)s.gain.rampTo(0,.1)},_=R($),u=new Float32Array(f),m=new Float32Array(f);let i=-1;const e=()=>{let s=1e-6;for(let h=1;h<=T;h++){let w=0;for(let M=0;M<f;M++)w+=u[M]*Math.sin(h*Math.PI*M/(f-1));w=Math.abs(2*w/f),v[h-1]=w,s=Math.max(s,w)}const r=W();x.t=performance.now();for(let h=1;h<=T;h++){const w=d[h-1].gain,M=v[h-1]/s*.34/Math.sqrt(h);g[h-1].state!=="started"&&g[h-1].start(),w.cancelScheduledValues(r),w.setValueAtTime(Math.max(M,1e-4),r),w.exponentialRampToValueAtTime(1e-4,r+y(h)),w.linearRampToValueAtTime(0,r+y(h)+.05)}for(let h=0;h<T;h++)v[h]/=s},a=s=>Math.round((s-.04)/.92*(f-1));n.canvas.addEventListener("pointerdown",s=>{q(),s.preventDefault(),i=Math.max(2,Math.min(f-3,a(p.pointer.x)))});const l=()=>{i<0||(i=-1,e())};return n.canvas.addEventListener("pointerup",l),n.canvas.addEventListener("pointerleave",l),n.slider({label:"pitch",min:65,max:330,step:1,value:o,log:!0,format:s=>`${Math.round(s)} Hz`,onInput:s=>{o=s,g.forEach((r,h)=>r.frequency.rampTo(o*(h+1),.05))}}),n.button("pluck the middle",()=>{q();for(let s=0;s<f;s++)u[s]=.9*Math.min(s/(f/2),(f-1-s)/(f/2));m.fill(0),e()}),n.button("pluck near the bridge",()=>{q();const s=Math.floor(f*.92);for(let r=0;r<f;r++)u[r]=.9*(r<=s?r/s:(f-1-r)/(f-1-s));m.fill(0),e()}),n.setInfo(()=>`${K(o)} string · shown ${X}× slower than it sounds · drag it`),{frame(){n.tick(),_.pulse();const s=2*o/X,r=1/(f-1),h=.8*r/s,w=Math.max(1,Math.min(40,Math.round(1/60/h)));for(let k=0;k<w;k++){i>=0&&(u[i]=Math.max(-1,Math.min(1,(p.pointer.y-.56)/.22)),m[i]=0);const Q=(s*h/r)**2;for(let b=1;b<f-1;b++)m[b]+=Q*(u[b-1]-2*u[b]+u[b+1]),m[b]*=.99995;i>=0&&(m[i]=0);for(let b=1;b<f-1;b++)u[b]+=m[b]}p.data.set(u.subarray(0,f),0);const M=x.t<0?-1:(performance.now()-x.t)/1e3;for(let k=1;k<=T;k++)p.data[f+k-1]=M<0?0:v[k-1]*Math.exp(-3*M/y(k));p.uniforms[4]=i>=0?1:0,p.draw()},dispose(){$()}}}const S=8,gt=130.81,yt=`
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
  for (var n = 0u; n < ${S}u; n++) {
    let a = D[n];
    norm += a;
  }
  for (var n = 0u; n < ${S}u; n++) {
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
`;async function xt(c){const t=await O(),n=new P(c,.5);if(!t)return F(c);const p=new z(t,n.canvas,yt,S);G(c);const o=new Float32Array(S);o[0]=1;const g=[],d=[];for(let e=1;e<=S;e++){const a=new E(0).connect(L());d.push(new A(gt*e,"sine").connect(a)),g.push(a)}let x=!1;const v=()=>{if(!x)return;let e=.05;for(let a=0;a<S;a++)e+=o[a];for(let a=0;a<S;a++)g[a].gain.rampTo(o[a]/e*.5,.06)},y=e=>{if(x=e,e){for(const a of d)a.state!=="started"&&a.start();v()}else for(const a of g)a.gain.rampTo(0,.12)},$=R(()=>{y(!1),u()});let _;const u=()=>{_.textContent=x?"■ stop":"▶ play C3"};n.button("▶ play C3",()=>{q().then(()=>{y(!x),u()})}),_=n.controls.lastElementChild;const m=[];for(let e=1;e<=S;e++){const a=n.slider({label:`h${e}${e===1?" (fundamental)":""}`,min:0,max:1,step:.01,value:o[e-1],onInput:l=>{o[e-1]=l,v()}});a.closest("label").classList.add("demo-slider-narrow"),m.push(a)}const i=(e,a)=>{n.button(e,()=>{for(let l=1;l<=S;l++)o[l-1]=a(l),m[l-1].value=String(o[l-1]),m[l-1].dispatchEvent(new Event("input"))})};return i("pure",e=>e===1?1:0),i("clarinet-ish (odd 1/n)",e=>e%2===1?1/e:0),i("sawtooth (1/n)",e=>1/e),i("mellow (1/n²)",e=>1/(e*e)),n.setInfo(()=>{const e=o.reduce((a,l)=>a+(l>.01?1:0),0);return`${e} partial${e===1?"":"s"} of C3 · same pitch, ${e===1?"no":"different"} flavour`}),{frame(){n.tick(),$.pulse(),p.data.set(o),p.draw()},dispose(){y(!1)}}}tt();const _t={hero:c=>ft(c),oscillo:c=>mt(c),string:c=>vt(c),harmonics:c=>xt(c)};for(const c of document.querySelectorAll("[data-demo]")){const t=_t[c.dataset.demo];t&&et(c,()=>t(c))}
