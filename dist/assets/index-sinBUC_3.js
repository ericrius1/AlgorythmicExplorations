function ia(s,B){let a=new Map,G=s.dtype??"float32";for(let P=0;P<s.keys.length;P++){let r=s.keys[P],g=s.shapes[P],A=s.offsets[P],U=g.reduce((w,v)=>w*v,1),y,c;if(G==="float32")y=new Float32Array(B,A,U);else{let w=new DataView(B);y=new Float32Array(U);for(let v=0;v<U;v++)y[v]=na(w.getUint16(A+v*2,!0));c=B.slice(A,A+U*2)}a.set(r,{data:y,shape:g,rawF16:c})}return a}function na(s){let B=s>>15&1,a=s>>10&31,G=s&1023;if(a===0){if(G===0)return B?-0:0;let g=-14,A=G/1024;return(B?-1:1)*Math.pow(2,g)*A}if(a===31)return G===0?B?-1/0:1/0:NaN;let P=a-15,r=1+G/1024;return(B?-1:1)*Math.pow(2,P)*r}var oa=[[24,24,128,1,"backbone1.3.f.0."],[24,24,128,1,"backbone1.3.f.1."],[24,48,128,2,"backbone1.4."],[48,48,64,1,"backbone2.0.f.0."],[48,48,64,1,"backbone2.0.f.1."],[48,96,64,2,"backbone2.1."],[96,96,32,1,"backbone3.0.f.0."],[96,96,32,1,"backbone3.0.f.1."],[96,96,32,2,"backbone3.1."],[96,96,16,1,"backbone4.0.f.0."],[96,96,16,1,"backbone4.0.f.1."],[96,96,16,2,"backbone4.1."],[96,96,16,1,"backbone5.0."],[96,96,32,1,"backbone6.0."],[48,48,64,1,"ff.0.f.0."],[48,48,64,1,"ff.0.f.1."],[48,48,64,1,"ff.0.f.2."],[48,48,64,1,"ff.0.f.3."],[48,96,64,2,"ff.1."],[96,96,32,1,"ff.2.f.0."],[96,96,32,1,"ff.2.f.1."],[96,96,32,1,"ff.2.f.2."],[96,96,32,1,"ff.2.f.3."],[96,288,32,2,"ff.3."],[288,288,16,1,"ff.4.f.0."],[288,288,16,1,"ff.4.f.1."],[288,288,16,1,"ff.4.f.2."],[288,288,16,1,"ff.4.f.3."],[288,288,16,2,"ff.5."],[288,288,8,1,"ff.6.f.0."],[288,288,8,1,"ff.6.f.1."],[288,288,8,1,"ff.6.f.2."],[288,288,8,1,"ff.6.f.3."],[288,288,8,2,"ff.7."],[288,288,4,1,"ff.8.f.0."],[288,288,4,1,"ff.8.f.1."],[288,288,4,1,"ff.8.f.2."],[288,288,4,1,"ff.8.f.3."],[288,288,4,2,"ff.9."],[288,288,2,1,"ff.10.f.0."],[288,288,2,1,"ff.10.f.1."],[288,288,2,1,"ff.10.f.2."],[288,288,2,1,"ff.10.f.3."]];oa.map(([s,B,a,G,P])=>({type:"resmodule",inCh:s,outCh:B,h:a,w:a,stride:G,prefix:P}));function ua(s,B){let a=new Map,G=s.dtype??"float32",P=new Map;for(let r=0;r<s.keys.length;r++){let g=s.keys[r],A=s.shapes[r],U=s.offsets[r],y=A.reduce((W,l)=>W*l,1),c,w;if(G==="float32")c=new Float32Array(B,U,y);else{let W=new DataView(B);c=new Float32Array(y);for(let l=0;l<y;l++)c[l]=sa(W.getUint16(U+l*2,!0));w=B.slice(U,U+y*2)}let v=P.get(g)??0;P.set(g,v+1);let j=v===0?g:`${g}__${v}`;a.set(j,{data:c,shape:A,rawF16:w})}return a}function sa(s){let B=s>>15&1,a=s>>10&31,G=s&1023;return a===0?G===0?B?-0:0:(B?-1:1)*Math.pow(2,-14)*(G/1024):a===31?G===0?B?-1/0:1/0:NaN:(B?-1:1)*Math.pow(2,a-15)*(1+G/1024)}function Je(s){return s.replace(/\/\/[^\n]*/g,"").replace(/\s+/g," ").replace(/\s*([{}();,=+\-*/<>!&|@])\s*/g,"$1").trim()}var da=Je(`
struct CanvasParams { in_size:u32, }
@group(0)@binding(0) var input_tex:texture_2d<f32>;
@group(0)@binding(1) var<storage,read_write> output:array<f32>;
@group(0)@binding(2) var<uniform> params:CanvasParams;
@compute @workgroup_size(16,16,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let x=gid.x; let y=gid.y;
  if(x>=params.in_size||y>=params.in_size){return;}
  let pixel=textureLoad(input_tex,vec2<u32>(x,y),0);
  let stride=params.in_size*params.in_size;
  output[0u*stride+y*params.in_size+x]=pixel.r;
  output[1u*stride+y*params.in_size+x]=pixel.g;
  output[2u*stride+y*params.in_size+x]=pixel.b;
}
`),la=Je(`
struct Params { in_channels:u32, out_channels:u32, in_h:u32, in_w:u32, out_h:u32, out_w:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:Params;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let oc=gid.z;
  if(out_x>=params.out_w||out_y>=params.out_h||oc>=params.out_channels){return;}
  var sum:f32=0.0;
  let in_h=i32(params.in_h); let in_w=i32(params.in_w);
  for(var ic:u32=0u;ic<params.in_channels;ic++){
    for(var ky:u32=0u;ky<3u;ky++){
      for(var kx:u32=0u;kx<3u;kx++){
        let iy=i32(out_y*2u+ky); let ix=i32(out_x*2u+kx);
        if(iy>=0 && iy<in_h && ix>=0 && ix<in_w){
          let in_idx=ic*params.in_h*params.in_w+u32(iy)*params.in_w+u32(ix);
          let w_idx=oc*params.in_channels*9u+ic*9u+ky*3u+kx;
          sum+=input[in_idx]*weight[w_idx];
        }
      }
    }
  }
  sum+=bias[oc];
  sum=min(max(sum,0.0),6.0);
  let out_idx=oc*params.out_h*params.out_w+out_y*params.out_w+out_x;
  output[out_idx]=sum;
}
`),pa=Je(`
struct Params { in_channels:u32, out_channels:u32, height:u32, width:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:Params;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let oc=gid.z;
  if(out_x>=params.width||out_y>=params.height||oc>=params.out_channels){return;}
  var sum:f32=0.0;
  let spatial=params.height*params.width;
  let pix=out_y*params.width+out_x;
  for(var ic:u32=0u;ic<params.in_channels;ic++){
    sum+=input[ic*spatial+pix]*weight[oc*params.in_channels+ic];
  }
  sum+=bias[oc];
  sum=min(max(sum,0.0),6.0);
  output[oc*spatial+pix]=sum;
}
`),ca=Je(`
struct Params { channels:u32, in_h:u32, in_w:u32, out_h:u32, out_w:u32, stride:u32, pad:u32, kernel:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:Params;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let c=gid.z;
  if(out_x>=params.out_w||out_y>=params.out_h||c>=params.channels){return;}
  var sum:f32=0.0;
  let in_h=i32(params.in_h); let in_w=i32(params.in_w);
  let kk=params.kernel*params.kernel;
  for(var ky:u32=0u;ky<params.kernel;ky++){
    for(var kx:u32=0u;kx<params.kernel;kx++){
      let iy=i32(out_y*params.stride+ky)-i32(params.pad);
      let ix=i32(out_x*params.stride+kx)-i32(params.pad);
      if(iy>=0 && iy<in_h && ix>=0 && ix<in_w){
        sum+=input[c*params.in_h*params.in_w+u32(iy)*params.in_w+u32(ix)]*weight[c*kk+ky*params.kernel+kx];
      }
    }
  }
  sum+=bias[c];
  sum=min(max(sum,0.0),6.0);
  output[c*params.out_h*params.out_w+out_y*params.out_w+out_x]=sum;
}
`),fa=Je(`
struct Params { in_channels:u32, out_channels:u32, height:u32, width:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:Params;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let oc=gid.z;
  if(out_x>=params.width||out_y>=params.height||oc>=params.out_channels){return;}
  var sum:f32=0.0;
  let spatial=params.height*params.width;
  let pix=out_y*params.width+out_x;
  for(var ic:u32=0u;ic<params.in_channels;ic++){
    sum+=input[ic*spatial+pix]*weight[oc*params.in_channels+ic];
  }
  sum+=bias[oc];
  output[oc*spatial+pix]=sum;
}
`),_a=Je(`
@group(0)@binding(0) var<storage,read> a:array<f32>;
@group(0)@binding(1) var<storage,read> b:array<f32>;
@group(0)@binding(2) var<storage,read_write> output:array<f32>;
@group(0)@binding(3) var<uniform> size:u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let idx=gid.x; if(idx>=size){return;} output[idx]=a[idx]+b[idx];
}
`),ha=Je(`
struct Params { channels:u32, spatial:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read_write> output:array<f32>;
@group(0)@binding(2) var<uniform> params:Params;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let c=gid.x;
  if(c>=params.channels){return;}
  var sum:f32=0.0;
  let base=c*params.spatial;
  for(var i:u32=0u;i<params.spatial;i++){
    sum+=input[base+i];
  }
  output[c]=sum/f32(params.spatial);
}
`),ma=Je(`
struct Params { in_features:u32, out_features:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let oc=gid.x;
  if(oc>=params.out_features){return;}
  var sum:f32=0.0;
  for(var ic:u32=0u;ic<params.in_features;ic++){
    sum+=input[ic]*weight[oc*params.in_features+ic];
  }
  output[oc]=sum+bias[oc];
}
`),ga=Je(`
struct Params { in_features:u32, out_features:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:Params;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let oc=gid.x;
  if(oc>=params.out_features){return;}
  var sum:f32=0.0;
  for(var ic:u32=0u;ic<params.in_features;ic++){
    sum+=input[ic]*weight[oc*params.in_features+ic];
  }
  sum+=bias[oc];
  output[oc]=1.0/(1.0+exp(-sum));
}
`),vt=[{inCh:24,expandCh:24,dwKernel:3,stride:1,outCh:16,hasResidual:!1,hasProject:!0},{inCh:16,expandCh:64,dwKernel:3,stride:2,outCh:24,hasResidual:!1,hasProject:!0},{inCh:24,expandCh:144,dwKernel:3,stride:1,outCh:24,hasResidual:!0,hasProject:!0},{inCh:24,expandCh:144,dwKernel:5,stride:2,outCh:40,hasResidual:!1,hasProject:!0},{inCh:40,expandCh:240,dwKernel:5,stride:1,outCh:40,hasResidual:!0,hasProject:!0},{inCh:40,expandCh:240,dwKernel:3,stride:2,outCh:80,hasResidual:!1,hasProject:!0},{inCh:80,expandCh:480,dwKernel:3,stride:1,outCh:80,hasResidual:!0,hasProject:!0},{inCh:80,expandCh:480,dwKernel:3,stride:1,outCh:80,hasResidual:!0,hasProject:!0},{inCh:80,expandCh:480,dwKernel:5,stride:1,outCh:112,hasResidual:!1,hasProject:!0},{inCh:112,expandCh:672,dwKernel:5,stride:1,outCh:112,hasResidual:!0,hasProject:!0},{inCh:112,expandCh:672,dwKernel:5,stride:1,outCh:112,hasResidual:!0,hasProject:!0},{inCh:112,expandCh:672,dwKernel:5,stride:2,outCh:192,hasResidual:!1,hasProject:!0},{inCh:192,expandCh:1152,dwKernel:5,stride:1,outCh:192,hasResidual:!0,hasProject:!0},{inCh:192,expandCh:1152,dwKernel:5,stride:1,outCh:192,hasResidual:!0,hasProject:!0},{inCh:192,expandCh:1152,dwKernel:5,stride:1,outCh:192,hasResidual:!0,hasProject:!0},{inCh:192,expandCh:1152,dwKernel:3,stride:1,outCh:1152,hasResidual:!1,hasProject:!1}],ba=[{dwWeightKey:"batch_normalization_1/FusedBatchNormV3",dwBNKey:"batch_normalization_1",projectConvKey:"conv2d_1",projectBNKey:"batch_normalization_2/FusedBatchNormV3"},{expandConvKey:"conv2d_2",expandBNKey:"batch_normalization_3",dwWeightKey:"batch_normalization_4/FusedBatchNormV3",dwBNKey:"batch_normalization_4",projectConvKey:"conv2d_3",projectBNKey:"batch_normalization_5/FusedBatchNormV3"},{expandConvKey:"conv2d_4",expandBNKey:"batch_normalization_6",dwWeightKey:"batch_normalization_7/FusedBatchNormV3",dwBNKey:"batch_normalization_7",projectConvKey:"conv2d_5",projectBNKey:"batch_normalization_8/FusedBatchNormV3"},{expandConvKey:"conv2d_6",expandBNKey:"batch_normalization_9",dwWeightKey:"batch_normalization_10/FusedBatchNormV3",dwBNKey:"batch_normalization_10",projectConvKey:"conv2d_7",projectBNKey:"batch_normalization_11/FusedBatchNormV3"},{expandConvKey:"conv2d_8",expandBNKey:"batch_normalization_12",dwWeightKey:"batch_normalization_13/FusedBatchNormV3",dwBNKey:"batch_normalization_13",projectConvKey:"conv2d_9",projectBNKey:"batch_normalization_14/FusedBatchNormV3"},{expandConvKey:"conv2d_10",expandBNKey:"batch_normalization_15",dwWeightKey:"batch_normalization_16/FusedBatchNormV3",dwBNKey:"batch_normalization_16",projectConvKey:"conv2d_11",projectBNKey:"batch_normalization_17/FusedBatchNormV3"},{expandConvKey:"conv2d_12",expandBNKey:"batch_normalization_18",dwWeightKey:"batch_normalization_19/FusedBatchNormV3",dwBNKey:"batch_normalization_19",projectConvKey:"conv2d_13",projectBNKey:"batch_normalization_20/FusedBatchNormV3"},{expandConvKey:"conv2d_14",expandBNKey:"batch_normalization_21",dwWeightKey:"batch_normalization_22/FusedBatchNormV3",dwBNKey:"batch_normalization_22",projectConvKey:"conv2d_15",projectBNKey:"batch_normalization_23/FusedBatchNormV3"},{expandConvKey:"conv2d_16",expandBNKey:"batch_normalization_24",dwWeightKey:"batch_normalization_25/FusedBatchNormV3",dwBNKey:"batch_normalization_25",projectConvKey:"conv2d_17",projectBNKey:"batch_normalization_26/FusedBatchNormV3"},{expandConvKey:"conv2d_18",expandBNKey:"batch_normalization_27",dwWeightKey:"batch_normalization_28/FusedBatchNormV3",dwBNKey:"batch_normalization_28",projectConvKey:"conv2d_19",projectBNKey:"batch_normalization_29/FusedBatchNormV3"},{expandConvKey:"conv2d_20",expandBNKey:"batch_normalization_30",dwWeightKey:"batch_normalization_31/FusedBatchNormV3",dwBNKey:"batch_normalization_31",projectConvKey:"conv2d_21",projectBNKey:"batch_normalization_32/FusedBatchNormV3"},{expandConvKey:"conv2d_22",expandBNKey:"batch_normalization_33",dwWeightKey:"batch_normalization_34/FusedBatchNormV3",dwBNKey:"batch_normalization_34",projectConvKey:"conv2d_23",projectBNKey:"batch_normalization_35/FusedBatchNormV3"},{expandConvKey:"conv2d_24",expandBNKey:"batch_normalization_36",dwWeightKey:"batch_normalization_37/FusedBatchNormV3",dwBNKey:"batch_normalization_37",projectConvKey:"conv2d_25",projectBNKey:"batch_normalization_38/FusedBatchNormV3"},{expandConvKey:"conv2d_26",expandBNKey:"batch_normalization_39",dwWeightKey:"batch_normalization_40/FusedBatchNormV3",dwBNKey:"batch_normalization_40",projectConvKey:"conv2d_27",projectBNKey:"batch_normalization_41/FusedBatchNormV3"},{expandConvKey:"conv2d_28",expandBNKey:"batch_normalization_42",dwWeightKey:"batch_normalization_43/FusedBatchNormV3",dwBNKey:"batch_normalization_43",projectConvKey:"conv2d_29",projectBNKey:"batch_normalization_44/FusedBatchNormV3"},{expandConvKey:"conv2d_30",expandBNKey:"batch_normalization_45",dwWeightKey:"batch_normalization_46/FusedBatchNormV3",dwBNKey:"batch_normalization_46"}];async function wa(s,B){if(!navigator.gpu)throw new Error("WebGPU not supported");let a=await navigator.gpu.requestAdapter();if(!a)throw new Error("No GPU adapter found");let G=a.features.has("shader-f16"),P=G?["shader-f16"]:[],r=await a.requestDevice({requiredFeatures:P,requiredLimits:{maxStorageBuffersPerShaderStage:Math.min(a.limits.maxStorageBuffersPerShaderStage,8)}}),g=s.values().next().value,A=G&&!!g?.rawF16&&!0;function U(h){if(A&&h.rawF16){let n=new Uint16Array(h.rawF16);if(n.length%2!==0){let p=new Uint16Array(n.length+1);return p.set(n),p}return n}return h.data}function y(h){return A&&h.rawF16?Math.ceil(h.rawF16.byteLength/4)*4:h.data.byteLength}let c=A?2:4;function w(h){if(!A)return h;let n=h;return n=n.replace(/array<f32>/g,"array<f16>"),n=n.replace(/array<f32,/g,"array<f16,"),n=n.replace(/var sum:f32=0\.0/g,"var sum:f16=0.0h"),n=n.replace(/var sum0:f32=0\.0/g,"var sum0:f16=0.0h"),n=n.replace(/var sum1:f32=0\.0/g,"var sum1:f16=0.0h"),n=n.replace(/var sum2:f32=0\.0/g,"var sum2:f16=0.0h"),n=n.replace(/var sum3:f32=0\.0/g,"var sum3:f16=0.0h"),n=n.replace(/\/f32\(params/g,"/f16(params"),n=n.replace(/,0\.0\),6\.0\)/g,",0.0h),6.0h)"),n=n.replace(/->f32\{/g,"->f16{"),n=n.replace(/->f32 \{/g,"->f16 {"),n=n.replace(/return 0\.0;/g,"return 0.0h;"),"enable f16;"+n}function v(h){if(!A)return h;let n=w(h);return n=n.replace("read>input:array<f16>","read>input:array<f32>"),n=n.replace(/input\[in_idx\]/g,"f16(input[in_idx])"),n}function j(h){if(!A)return h;let n=h;return n=n.replace("read>input:array<f32>","read>input:array<f16>"),n=n.replace("read>weight:array<f32>","read>weight:array<f16>"),n=n.replace("read>bias:array<f32>","read>bias:array<f16>"),n=n.replace(/input\[ic\]/g,"f32(input[ic])"),n=n.replace(/weight\[oc\*params\.in_features\+ic\]/g,"f32(weight[oc*params.in_features+ic])"),n=n.replace(/bias\[oc\]/g,"f32(bias[oc])"),"enable f16;"+n}let W={r:"read-only-storage",s:"storage",u:"uniform"};function l(h){return r.createBindGroupLayout({entries:h.map((n,p)=>n==="t"?{binding:p,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"float"}}:{binding:p,visibility:GPUShaderStage.COMPUTE,buffer:{type:W[n]}})})}let C=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,E=GPUBufferUsage.STORAGE,Te=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,He=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,ie=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST;function k(h,n){return r.createBuffer({size:Math.max(h,4),usage:n})}function de(h,n){return r.createBindGroup({layout:h,entries:n.map((p,R)=>({binding:R,resource:"size"in p?{buffer:p}:p}))})}function ve(h,n){return r.createComputePipeline({layout:r.createPipelineLayout({bindGroupLayouts:[h]}),compute:{module:n,entryPoint:"main"}})}function $(h){let n=s.get(h);if(!n)throw new Error(`Missing weight: ${h}`);return n}let Ne=r.createShaderModule({code:da}),Ct=r.createShaderModule({code:v(la)}),et=r.createShaderModule({code:w(pa)}),Bt=r.createShaderModule({code:w(ca)}),Pt=r.createShaderModule({code:w(fa)}),Ut=r.createShaderModule({code:w(_a)}),Ie=r.createShaderModule({code:w(ha)}),Ce=r.createShaderModule({code:j(ma)}),ft=r.createShaderModule({code:j(ga)}),Ke=l(["r","r","r","s","u"]),Kt=l(["r","r","s","u"]),Be=l(["r","s","u"]),qe=l(["r","r","r","s","u"]),kt=l(["t","s","u"]),St=ve(kt,Ne),b=ve(Ke,Ct),N=ve(Ke,et),K=ve(Ke,Bt),q=ve(Ke,Pt),he=ve(Kt,Ut),ke=ve(Be,Ie),me=ve(qe,Ce),ge=ve(qe,ft),te=1152*112*112*4,X=k(te,He),be=k(te,He),oe=k(te,E),I=k(te,E),J=k(te,C),ae=k(672*224*4,He),D=k(1152*4,Te),we=k(252,Te);k(252,Te);let ue=k(4,Te),Pe=k(4,Te),ce=k(260,He),re=k(260,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),ze=r.createTexture({size:[224,224],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),Ee=k(4,ie);r.queue.writeBuffer(Ee,0,new Uint32Array([224]));let Me=$("conv2d"),De=$("batch_normalization"),Se=U(Me),We=U(De),Ve=k(y(Me),C),Oe=k(y(De),C),tt=k(24,ie);r.queue.writeBuffer(Ve,0,Se),r.queue.writeBuffer(Oe,0,We),r.queue.writeBuffer(tt,0,new Uint32Array([3,24,224,224,112,112]));let Re=112,Ae=112,Le=[];for(let h=0;h<vt.length;h++){let n=vt[h],p=ba[h],R=Re,S=Ae,L=n.stride===2?Math.floor(Re/2):Re,ne=n.stride===2?Math.floor(Ae/2):Ae,z={spec:n,inH:R,inW:S,outH:L,outW:ne,dwW:k(4,C),dwB:k(4,C),dwU:k(32,ie)};if(p.expandConvKey){let se=$(p.expandConvKey),xe=$(p.expandBNKey);z.expandW=k(y(se),C),z.expandB=k(y(xe),C),z.expandU=k(16,ie),r.queue.writeBuffer(z.expandW,0,U(se)),r.queue.writeBuffer(z.expandB,0,U(xe)),r.queue.writeBuffer(z.expandU,0,new Uint32Array([n.inCh,n.expandCh,R,S]))}let fe=$(p.dwWeightKey),le=$(p.dwBNKey);z.dwW=k(y(fe),C),z.dwB=k(y(le),C),r.queue.writeBuffer(z.dwW,0,U(fe)),r.queue.writeBuffer(z.dwB,0,U(le));let ye=Math.floor((n.dwKernel-n.stride)/2);if(r.queue.writeBuffer(z.dwU,0,new Uint32Array([n.expandCh,R,S,L,ne,n.stride,ye,n.dwKernel])),n.hasProject&&p.projectConvKey){let se=$(p.projectConvKey),xe=$(p.projectBNKey);z.projectW=k(y(se),C),z.projectB=k(y(xe),C),z.projectU=k(16,ie),r.queue.writeBuffer(z.projectW,0,U(se)),r.queue.writeBuffer(z.projectB,0,U(xe)),r.queue.writeBuffer(z.projectU,0,new Uint32Array([n.expandCh,n.outCh,L,ne]))}Le.push(z),Re=L,Ae=ne}let at=$("conv_landmarks__1"),zt=$("conv_world_landmarks__1"),Ht=$("conv_handflag__1"),Mt=$("conv_handedness__1"),Fe=$("Identity"),rt=$("Identity_1"),Et=$("Identity_2"),Wt=$("Identity_3"),_t=k(y(at),C),it=k(y(Fe),C),ht=k(y(zt),C),mt=k(y(Wt),C),nt=k(y(Ht),C),ot=k(y(rt),C),ut=k(y(Mt),C),gt=k(y(Et),C);r.queue.writeBuffer(_t,0,U(at)),r.queue.writeBuffer(it,0,U(Fe)),r.queue.writeBuffer(ht,0,U(zt)),r.queue.writeBuffer(mt,0,U(Wt)),r.queue.writeBuffer(nt,0,U(Ht)),r.queue.writeBuffer(ot,0,U(rt)),r.queue.writeBuffer(ut,0,U(Mt)),r.queue.writeBuffer(gt,0,U(Et));let bt=k(8,ie),At=k(8,ie),wt=k(8,ie),yt=k(8,ie);r.queue.writeBuffer(bt,0,new Uint32Array([1152,63])),r.queue.writeBuffer(At,0,new Uint32Array([1152,63])),r.queue.writeBuffer(wt,0,new Uint32Array([1152,1])),r.queue.writeBuffer(yt,0,new Uint32Array([1152,1]));let T=k(8,ie);r.queue.writeBuffer(T,0,new Uint32Array([1152,Re*Ae]));let O=new Map;for(let h=0;h<vt.length;h++)if(vt[h].hasResidual){let n=Le[h],p=k(4,ie);r.queue.writeBuffer(p,0,new Uint32Array([vt[h].outCh*n.outH*n.outW])),O.set(h,p)}let qt=de(kt,[ze.createView(),X,Ee]),Dt=de(Ke,[X,Ve,Oe,be,tt]),Ye=new Float32Array(1),$e=new Float32Array(1),Xe=new Float32Array(63);function xt(h,n){let p=h.beginComputePass();p.setPipeline(b),p.setBindGroup(0,Dt),p.dispatchWorkgroups(Math.ceil(112/8),Math.ceil(112/8),24),p.end();let R=be,S=X;for(let L=0;L<vt.length;L++){let ne=vt[L],z=Le[L];if(ne.hasResidual){let ye=ne.inCh*z.inH*z.inW*c;h.copyBufferToBuffer(R,0,J,0,ye)}if(p=h.beginComputePass(),z.expandW){let ye=de(Ke,[R,z.expandW,z.expandB,oe,z.expandU]);p.setPipeline(N),p.setBindGroup(0,ye),p.dispatchWorkgroups(Math.ceil(z.inW/8),Math.ceil(z.inH/8),ne.expandCh)}let fe=z.expandW?oe:R,le=de(Ke,[fe,z.dwW,z.dwB,I,z.dwU]);if(p.setPipeline(K),p.setBindGroup(0,le),p.dispatchWorkgroups(Math.ceil(z.outW/8),Math.ceil(z.outH/8),ne.expandCh),ne.hasProject&&z.projectW){let ye=(ne.hasResidual,S),se=de(Ke,[I,z.projectW,z.projectB,ye,z.projectU]);if(p.setPipeline(q),p.setBindGroup(0,se),p.dispatchWorkgroups(Math.ceil(z.outW/8),Math.ceil(z.outH/8),ne.outCh),ne.hasResidual){let xe=O.get(L),Ze=de(Kt,[S,J,R,xe]);p.setPipeline(he),p.setBindGroup(0,Ze),p.dispatchWorkgroups(Math.ceil(ne.outCh*z.outH*z.outW/256))}else{let xe=R;R=S,S=xe}}if(p.end(),!ne.hasProject){p=h.beginComputePass();let ye=de(Be,[I,D,T]);p.setPipeline(ke),p.setBindGroup(0,ye),p.dispatchWorkgroups(Math.ceil(1152/256));let se=de(qe,[D,_t,it,we,bt]);p.setPipeline(me),p.setBindGroup(0,se),p.dispatchWorkgroups(1);let xe=de(qe,[D,nt,ot,ue,wt]);p.setPipeline(ge),p.setBindGroup(0,xe),p.dispatchWorkgroups(1);let Ze=de(qe,[D,ut,gt,Pe,yt]);p.setPipeline(ge),p.setBindGroup(0,Ze),p.dispatchWorkgroups(1),p.end(),h.copyBufferToBuffer(ue,0,ce,0,4),h.copyBufferToBuffer(Pe,0,ce,4,4),h.copyBufferToBuffer(we,0,ce,8,252),n&&h.copyBufferToBuffer(ce,0,n,0,260);return}}}async function Yt(h){r.queue.writeBuffer(ae,0,h);let n=r.createCommandEncoder();n.copyBufferToBuffer(ae,0,X,0,672*224*4),xt(n,re),r.queue.submit([n.finish()]);let p=re.mapAsync(GPUMapMode.READ);await r.queue.onSubmittedWorkDone(),await p;let R=new Float32Array(re.getMappedRange());Ye[0]=R[0],$e[0]=R[1];for(let S=0;S<63;S++)Xe[S]=R[2+S]/224;return re.unmap(),{handflag:new Float32Array(Ye),handedness:new Float32Array($e),landmarks:new Float32Array(Xe)}}async function Gt(h){r.queue.copyExternalImageToTexture({source:h},{texture:ze},[224,224]);let n=r.createCommandEncoder();{let S=n.beginComputePass();S.setPipeline(St),S.setBindGroup(0,qt),S.dispatchWorkgroups(Math.ceil(224/16),Math.ceil(224/16),1),S.end()}xt(n,re),r.queue.submit([n.finish()]);let p=re.mapAsync(GPUMapMode.READ);await r.queue.onSubmittedWorkDone(),await p;let R=new Float32Array(re.getMappedRange());Ye[0]=R[0],$e[0]=R[1];for(let S=0;S<63;S++)Xe[S]=R[2+S]/224;return re.unmap(),{handflag:new Float32Array(Ye),handedness:new Float32Array($e),landmarks:new Float32Array(Xe)}}async function $t(h){let n=r.createCommandEncoder();n.copyBufferToBuffer(h,0,X,0,672*224*4),xt(n,re),r.queue.submit([n.finish()]);let p=re.mapAsync(GPUMapMode.READ);await r.queue.onSubmittedWorkDone(),await p;let R=new Float32Array(re.getMappedRange());Ye[0]=R[0],$e[0]=R[1];for(let S=0;S<63;S++)Xe[S]=R[2+S]/224;return re.unmap(),{handflag:new Float32Array(Ye),handedness:new Float32Array($e),landmarks:new Float32Array(Xe)}}async function Xt(){return null}async function Ot(){return null}async function Rt(h=100){let n=new OffscreenCanvas(224,224),p=n.getContext("2d");p.fillStyle="#886644",p.fillRect(0,0,224,224);for(let L=0;L<5;L++)await Gt(n);let R=performance.now();for(let L=0;L<h;L++)await Gt(n);let S=(performance.now()-R)/h;return{avgMs:S,fps:1e3/S}}async function Lt(h=100){let n=await Rt(h);return{...n,medianMs:n.avgMs,minMs:n.avgMs}}async function jt(h){return Gt(h)}async function It(){return{gpuOnly:{median:0,min:0},mapAsyncOnly:{median:0,min:0},mapAsyncNoWait:{median:0,min:0},total:{median:0,min:0},pipelined:{median:0,min:0},renderReadback:null}}async function Vt(h){let n={};async function p(L,ne,z){let fe=ne*4,le=r.createBuffer({size:fe,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),ye=r.createCommandEncoder();ye.copyBufferToBuffer(L,0,le,0,fe),r.queue.submit([ye.finish()]),await r.queue.onSubmittedWorkDone(),await le.mapAsync(GPUMapMode.READ);let se=new Float32Array(le.getMappedRange()),xe=1/0,Ze=-1/0,F=0;for(let e=0;e<se.length;e++)se[e]<xe&&(xe=se[e]),se[e]>Ze&&(Ze=se[e]),se[e]!==0&&F++;let Zt=Array.from(se.slice(0,5));le.unmap(),le.destroy(),n[z]={min:xe,max:Ze,nonZero:F,total:ne,sample:Zt}}let R=new Float32Array(672*224);for(let L=0;L<50176;L++)R[L]=.5,R[50176+L]=.3,R[448*224+L]=.7;r.queue.writeBuffer(ae,0,R);let S=r.createCommandEncoder();return S.copyBufferToBuffer(ae,0,X,0,672*224*4),xt(S,re),r.queue.submit([S.finish()]),await r.queue.onSubmittedWorkDone(),await p(X,672*224,"inputBufA"),await p(be,2688*112,"afterInitConvBufB"),await p(D,1152,"gapOutput"),await p(we,63,"landmarks"),await p(ue,1,"handflag"),await p(ce,65,"unifiedOutput"),n}return{device:r,run:Yt,runFromCanvas:Gt,runFromGPUBuffer:$t,runFromCanvasPipelined:Xt,flushPipelined:Ot,benchmark:Rt,benchmarkGPU:Lt,runFromCanvasViaRender:jt,benchmarkDiagnostic:It,debugLayerOutputs:Vt}}function Qe(s){return s.replace(/\/\/[^\n]*/g,"").replace(/\s+/g," ").replace(/\s*([{}();,=+\-*/<>!&|@])\s*/g,"$1").trim()}var ya=Qe(`
struct ConvParams { batch:u32, in_channels:u32, out_channels:u32, in_height:u32, in_width:u32, out_height:u32, out_width:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read> alpha:array<f32>;
@group(0)@binding(4) var<storage,read_write> output:array<f32>;
@group(0)@binding(5) var<uniform> params:ConvParams;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let oc_batch=gid.z;
  let oc=oc_batch%params.out_channels; let batch=oc_batch/params.out_channels;
  if(out_x>=params.out_width||out_y>=params.out_height||batch>=params.batch){return;}
  var sum:f32=0.0;
  let in_h=i32(params.in_height); let in_w=i32(params.in_width);
  let in_stride=params.in_height*params.in_width;
  let in_batch_base=batch*params.in_channels*in_stride;
  for(var ky:u32=0u;ky<5u;ky=ky+1u){
    let in_y=i32(out_y*2u+ky)-1;
    if(in_y<0 || in_y>=in_h){continue;}
    for(var kx:u32=0u;kx<5u;kx=kx+1u){
      let in_x=i32(out_x*2u+kx)-1;
      if(in_x<0 || in_x>=in_w){continue;}
      let pix_off=u32(in_y)*params.in_width+u32(in_x);
      // Load all 3 input channels for this pixel into vec3, dot with 3 weights
      let inp=vec3<f32>(
        input[in_batch_base+pix_off],
        input[in_batch_base+in_stride+pix_off],
        input[in_batch_base+2u*in_stride+pix_off]
      );
      let w_off=oc*75u+ky*15u+kx*3u;
      let w=vec3<f32>(weight[w_off],weight[w_off+1u],weight[w_off+2u]);
      sum+=dot(inp,w);
    }
  }
  sum=sum+bias[oc];
  // PReLU
  let a=alpha[oc];
  let result=max(0.0,sum)+a*min(0.0,sum);
  let out_idx=batch*params.out_channels*params.out_height*params.out_width+oc*params.out_height*params.out_width+out_y*params.out_width+out_x;
  output[out_idx]=result;
}
`),xa=Qe(`
struct DepthwiseParams { batch:u32, channels:u32, in_height:u32, in_width:u32, out_height:u32, out_width:u32, stride:u32, pad:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:DepthwiseParams;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let c_batch=gid.z;
  let c=c_batch%params.channels; let batch=c_batch/params.channels;
  if(out_x>=params.out_width||out_y>=params.out_height||batch>=params.batch){return;}
  let in_base=batch*params.channels*params.in_height*params.in_width+c*params.in_height*params.in_width;
  let w_base=c*25u; let in_h=i32(params.in_height); let in_w=i32(params.in_width); let pad=i32(params.pad);
  let base_in_y=i32(out_y*params.stride)-pad; let base_in_x=i32(out_x*params.stride)-pad;
  var sum:f32=0.0;
  for(var ky:u32=0u;ky<5u;ky=ky+1u){
    let in_y=base_in_y+i32(ky);
    if(in_y>=0 && in_y<in_h){
      let row_base=in_base+u32(in_y)*params.in_width;
      for(var kx:u32=0u;kx<5u;kx=kx+1u){
        let in_x=base_in_x+i32(kx);
        if(in_x>=0 && in_x<in_w){
          sum+=input[row_base+u32(in_x)]*weight[w_base+ky*5u+kx];
        }
      }
    }
  }
  sum+=bias[c];
  let out_idx=batch*params.channels*params.out_height*params.out_width+c*params.out_height*params.out_width+out_y*params.out_width+out_x;
  output[out_idx]=sum;
}
`),va=Qe(`
struct PointwiseParams { batch:u32, in_channels:u32, out_channels:u32, height:u32, width:u32, channel_pad:u32, stride:u32, in_height:u32, in_width:u32, }
@group(0)@binding(0) var<storage,read> dw_output:array<f32>;
@group(0)@binding(1) var<storage,read> skip_input:array<f32>;
@group(0)@binding(2) var<storage,read> pw_weight:array<f32>;
@group(0)@binding(3) var<storage,read> pw_bias:array<f32>;
@group(0)@binding(4) var<storage,read> alpha:array<f32>;
@group(0)@binding(5) var<storage,read_write> output:array<f32>;
@group(0)@binding(6) var<uniform> params:PointwiseParams;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let oc_batch=gid.z;
  let oc=oc_batch%params.out_channels; let batch=oc_batch/params.out_channels;
  if(out_x>=params.width||out_y>=params.height||batch>=params.batch){return;}
  var sum:f32=0.0;
  let dw_base=batch*params.in_channels*params.height*params.width+out_y*params.width+out_x;
  let w_base=oc*params.in_channels; let spatial_stride=params.height*params.width;
  let ic4=params.in_channels/4u;
  for(var i:u32=0u;i<ic4;i=i+1u){
    let ic=i*4u;
    let inp=vec4<f32>(
      dw_output[dw_base+ic*spatial_stride],
      dw_output[dw_base+(ic+1u)*spatial_stride],
      dw_output[dw_base+(ic+2u)*spatial_stride],
      dw_output[dw_base+(ic+3u)*spatial_stride]
    );
    let w=vec4<f32>(
      pw_weight[w_base+ic],
      pw_weight[w_base+ic+1u],
      pw_weight[w_base+ic+2u],
      pw_weight[w_base+ic+3u]
    );
    sum+=dot(inp,w);
  }
  sum+=pw_bias[oc];
  // Skip connection: zero-pad channels
  var skip_val:f32=0.0;
  if(oc<params.channel_pad){
    if(params.stride==2u){
      var max_val:f32=-1e38;
      for(var py:u32=0u;py<2u;py=py+1u){
        for(var px:u32=0u;px<2u;px=px+1u){
          let skip_y=out_y*2u+py; let skip_x=out_x*2u+px;
          if(skip_y<params.in_height && skip_x<params.in_width){
            let skip_idx=batch*params.channel_pad*params.in_height*params.in_width+oc*params.in_height*params.in_width+skip_y*params.in_width+skip_x;
            max_val=max(max_val,skip_input[skip_idx]);
          }
        }
      }
      skip_val=max_val;
    } else {
      let skip_idx=batch*params.channel_pad*params.height*params.width+oc*params.height*params.width+out_y*params.width+out_x;
      skip_val=skip_input[skip_idx];
    }
  }
  let v=sum+skip_val;
  let a=alpha[oc];
  let result=max(0.0,v)+a*min(0.0,v);
  let out_idx=batch*params.out_channels*params.height*params.width+oc*params.height*params.width+out_y*params.width+out_x;
  output[out_idx]=result;
}
`),Ca=Qe(`
struct Conv1x1Params { batch:u32, in_channels:u32, out_channels:u32, height:u32, width:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read_write> output:array<f32>;
@group(0)@binding(4) var<uniform> params:Conv1x1Params;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let oc_batch=gid.z;
  let oc=oc_batch%params.out_channels; let batch=oc_batch/params.out_channels;
  if(out_x>=params.width||out_y>=params.height||batch>=params.batch){return;}
  var sum:f32=0.0;
  let in_base=batch*params.in_channels*params.height*params.width+out_y*params.width+out_x;
  let w_base=oc*params.in_channels;
  let spatial_stride=params.height*params.width;
  let ic4=params.in_channels/4u;
  for(var i:u32=0u;i<ic4;i=i+1u){
    let ic=i*4u;
    let inp=vec4<f32>(
      input[in_base+ic*spatial_stride],
      input[in_base+(ic+1u)*spatial_stride],
      input[in_base+(ic+2u)*spatial_stride],
      input[in_base+(ic+3u)*spatial_stride]
    );
    let w=vec4<f32>(
      weight[w_base+ic],
      weight[w_base+ic+1u],
      weight[w_base+ic+2u],
      weight[w_base+ic+3u]
    );
    sum+=dot(inp,w);
  }
  sum=sum+bias[oc];
  let out_idx=batch*params.out_channels*params.height*params.width+oc*params.height*params.width+out_y*params.width+out_x;
  output[out_idx]=sum;
}
`),Ba=Qe(`
struct UpsampleParams { batch:u32, channels:u32, in_height:u32, in_width:u32, out_height:u32, out_width:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> skip:array<f32>;
@group(0)@binding(2) var<storage,read_write> output:array<f32>;
@group(0)@binding(3) var<uniform> params:UpsampleParams;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let c_batch=gid.z;
  let c=c_batch%params.channels; let batch=c_batch/params.channels;
  if(out_x>=params.out_width||out_y>=params.out_height||batch>=params.batch){return;}
  let scale_y=f32(params.in_height)/f32(params.out_height); let scale_x=f32(params.in_width)/f32(params.out_width);
  // TFLite ResizeBilinear: half_pixel_centers=true, align_corners=false
  // src = (dst + 0.5) * scale - 0.5
  let src_y=(f32(out_y)+0.5)*scale_y-0.5; let src_x=(f32(out_x)+0.5)*scale_x-0.5;
  let y0=u32(max(0.0,floor(src_y))); let x0=u32(max(0.0,floor(src_x)));
  let y1=min(y0+1u,params.in_height-1u); let x1=min(x0+1u,params.in_width-1u);
  let ly=max(0.0,src_y-f32(y0)); let lx=max(0.0,src_x-f32(x0));
  let base=batch*params.channels*params.in_height*params.in_width+c*params.in_height*params.in_width;
  let v00=input[base+y0*params.in_width+x0]; let v01=input[base+y0*params.in_width+x1];
  let v10=input[base+y1*params.in_width+x0]; let v11=input[base+y1*params.in_width+x1];
  let val=v00*(1.0-ly)*(1.0-lx)+v01*(1.0-ly)*lx+v10*ly*(1.0-lx)+v11*ly*lx;
  let out_idx=batch*params.channels*params.out_height*params.out_width+c*params.out_height*params.out_width+out_y*params.out_width+out_x;
  output[out_idx]=val+skip[out_idx];
}
`),Pa=Qe(`
struct Conv1x1Params { batch:u32, in_channels:u32, out_channels:u32, height:u32, width:u32, }
@group(0)@binding(0) var<storage,read> input:array<f32>;
@group(0)@binding(1) var<storage,read> weight:array<f32>;
@group(0)@binding(2) var<storage,read> bias:array<f32>;
@group(0)@binding(3) var<storage,read> alpha:array<f32>;
@group(0)@binding(4) var<storage,read_write> output:array<f32>;
@group(0)@binding(5) var<uniform> params:Conv1x1Params;
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let out_x=gid.x; let out_y=gid.y; let oc_batch=gid.z;
  let oc=oc_batch%params.out_channels; let batch=oc_batch/params.out_channels;
  if(out_x>=params.width||out_y>=params.height||batch>=params.batch){return;}
  var sum:f32=0.0;
  let in_base=batch*params.in_channels*params.height*params.width+out_y*params.width+out_x;
  let w_base=oc*params.in_channels;
  let spatial_stride=params.height*params.width;
  let ic4=params.in_channels/4u;
  for(var i:u32=0u;i<ic4;i=i+1u){
    let ic=i*4u;
    let inp=vec4<f32>(
      input[in_base+ic*spatial_stride],
      input[in_base+(ic+1u)*spatial_stride],
      input[in_base+(ic+2u)*spatial_stride],
      input[in_base+(ic+3u)*spatial_stride]
    );
    let w=vec4<f32>(
      weight[w_base+ic],
      weight[w_base+ic+1u],
      weight[w_base+ic+2u],
      weight[w_base+ic+3u]
    );
    sum+=dot(inp,w);
  }
  sum=sum+bias[oc];
  let a=alpha[oc];
  let result=max(0.0,sum)+a*min(0.0,sum);
  let out_idx=batch*params.out_channels*params.height*params.width+oc*params.height*params.width+out_y*params.width+out_x;
  output[out_idx]=result;
}
`),Ua=Qe(`
struct CanvasParams { in_width:u32, in_height:u32, out_size:u32, }
@group(0)@binding(0) var input_tex:texture_2d<f32>;
@group(0)@binding(1) var<storage,read_write> output:array<f32>;
@group(0)@binding(2) var<uniform> params:CanvasParams;
@compute @workgroup_size(16,16,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let x=gid.x; let y=gid.y;
  if(x>=params.in_width||y>=params.in_height){return;}
  let pixel=textureLoad(input_tex,vec2<u32>(x,y),0);
  let out_stride=params.out_size*params.out_size;
  output[0u*out_stride+y*params.out_size+x]=pixel.r;
  output[1u*out_stride+y*params.out_size+x]=pixel.g;
  output[2u*out_stride+y*params.out_size+x]=pixel.b;
}
`),Ka=Qe(`
struct LBParams {
  src_w:u32, src_h:u32, dst_size:u32, _pad:u32,
  scale_x:f32, scale_y:f32, offset_x:f32, offset_y:f32,
}
@group(0)@binding(0) var input_tex:texture_2d<f32>;
@group(0)@binding(1) var<storage,read_write> output:array<f32>;
@group(0)@binding(2) var<uniform> params:LBParams;
@group(0)@binding(3) var input_sampler:sampler;
@compute @workgroup_size(16,16,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let dx=gid.x; let dy=gid.y;
  if(dx>=params.dst_size||dy>=params.dst_size){return;}

  let out_stride=params.dst_size*params.dst_size;

  // Map dst pixel to src pixel using MediaPipe's convention:
  // dst pixel center at (dx + 0.5), offset by letterbox padding, then scale to src
  let src_x = (f32(dx) - params.offset_x + 0.5) * params.scale_x - 0.5;
  let src_y = (f32(dy) - params.offset_y + 0.5) * params.scale_y - 0.5;

  // Check if we're in the letterbox padding region
  let in_region = src_x >= -0.5 && src_x < f32(params.src_w) - 0.5
               && src_y >= -0.5 && src_y < f32(params.src_h) - 0.5;

  if(!in_region){
    // Zero padding (letterbox)
    output[0u*out_stride+dy*params.dst_size+dx]=0.0;
    output[1u*out_stride+dy*params.dst_size+dx]=0.0;
    output[2u*out_stride+dy*params.dst_size+dx]=0.0;
    return;
  }

  // Hardware bilinear sampling via textureSampleLevel
  // Matches MediaPipe's OpenGL GL_LINEAR + GL_CLAMP_TO_EDGE exactly
  // (uses same GPU texture filtering hardware)
  let u = (src_x + 0.5) / f32(params.src_w);
  let v = (src_y + 0.5) / f32(params.src_h);
  let pixel = textureSampleLevel(input_tex, input_sampler, vec2<f32>(u, v), 0.0);

  output[0u*out_stride+dy*params.dst_size+dx]=pixel.r;
  output[1u*out_stride+dy*params.dst_size+dx]=pixel.g;
  output[2u*out_stride+dy*params.dst_size+dx]=pixel.b;
}
`),ka=Qe(`
@group(0)@binding(0) var<storage,read_write> buf:array<f32>;
@group(0)@binding(1) var<uniform> count:u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let idx=gid.x;
  if(idx>=count){return;}
  let v=buf[idx];
  buf[idx]=unpack2x16float(pack2x16float(vec2(v,0.0))).x;
}
`);async function za(s,B){let a;{if(!navigator.gpu)throw new Error("WebGPU not supported");let e=await navigator.gpu.requestAdapter();if(!e)throw new Error("No GPU adapter found");a=await e.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:Math.min(e.limits.maxStorageBuffersPerShaderStage,8)}})}let G={r:"read-only-storage",s:"storage",u:"uniform"};function P(e){return a.createBindGroupLayout({entries:e.map((t,u)=>t==="t"?{binding:u,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"float"}}:t==="sm"?{binding:u,visibility:GPUShaderStage.COMPUTE,sampler:{}}:{binding:u,visibility:GPUShaderStage.COMPUTE,buffer:{type:G[t]}})})}let r=a.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),g=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,A=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,U=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,y=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST;function c(e,t){return a.createBuffer({size:Math.max(e,4),usage:t})}function w(e,t,u){a.queue.writeBuffer(e,t,u)}function v(e){let t=c(e.data.byteLength,g);return w(t,0,e.data),t}let j=Array.from(s.keys());function W(e){let t=s.get(e);if(!t)throw new Error(`Weight not found: ${e}`);return t}function l(...e){let t=j.find(u=>e.every(x=>u.includes(x)));if(!t)throw new Error(`Weight not found for: ${e.join(", ")}`);return W(t)}function C(e){let[,t,u,x]=e.shape,M=new Float32Array(x*25);for(let m=0;m<x;m++)for(let V=0;V<t;V++)for(let Y=0;Y<u;Y++)M[m*25+V*5+Y]=e.data[V*u*x+Y*x+m];return M}function E(e){let[t,,,u]=e.shape,x=new Float32Array(t*u);for(let M=0;M<t;M++)for(let m=0;m<u;m++)x[M*u+m]=e.data[M*u+m];return x}let Te=a.createShaderModule({code:ya}),He=a.createShaderModule({code:xa}),ie=a.createShaderModule({code:va}),k=a.createShaderModule({code:Ca}),de=a.createShaderModule({code:Pa}),ve=a.createShaderModule({code:Ba}),$=a.createShaderModule({code:Ua}),Ne=a.createShaderModule({code:Ka}),Ct=a.createShaderModule({code:ka}),et=P(["r","r","r","r","s","u"]),Bt=P(["r","r","r","s","u"]),Pt=P(["r","r","r","r","r","s","u"]),Ut=P(["r","r","r","s","u"]),Ie=P(["r","r","r","r","s","u"]),Ce=P(["r","r","s","u"]),ft=P(["t","s","u"]),Ke=P(["t","s","u","sm"]),Kt=P(["s","u"]);function Be(e,t){return a.createComputePipeline({layout:a.createPipelineLayout({bindGroupLayouts:[e]}),compute:{module:t,entryPoint:"main"}})}let qe=Be(et,Te),kt=Be(Bt,He),St=Be(Pt,ie),b=Be(Ut,k),N=Be(Ie,de),K=Be(Ce,ve),q=Be(ft,$),he=Be(Ke,Ne);Be(Kt,Ct);let ke=l("conv2d/Conv2D"),me=l("batch_normalization/","conv2d/Conv2D"),ge=l("p_re_lu/"),te=v(ke),X=v(me),be=v(ge),oe=[{dwKey:"depthwise_conv2d/",pwKey:"conv2d_1/",bnKey:"batch_normalization_1/",preluKey:"p_re_lu_1/",inCh:32,outCh:32,stride:1,inH:96},{dwKey:"depthwise_conv2d_1/",pwKey:"conv2d_2/",bnKey:"batch_normalization_2/",preluKey:"p_re_lu_2/",inCh:32,outCh:32,stride:1,inH:96},{dwKey:"depthwise_conv2d_2/",pwKey:"conv2d_3/",bnKey:"batch_normalization_3/",preluKey:"p_re_lu_3/",inCh:32,outCh:32,stride:1,inH:96},{dwKey:"depthwise_conv2d_3/",pwKey:"conv2d_4/",bnKey:"batch_normalization_4/",preluKey:"p_re_lu_4/",inCh:32,outCh:32,stride:1,inH:96},{dwKey:"depthwise_conv2d_4/",pwKey:"conv2d_5/",bnKey:"batch_normalization_5/",preluKey:"p_re_lu_5/",inCh:32,outCh:64,stride:2,inH:96},{dwKey:"depthwise_conv2d_5/",pwKey:"conv2d_6/",bnKey:"batch_normalization_6/",preluKey:"p_re_lu_6/",inCh:64,outCh:64,stride:1,inH:48},{dwKey:"depthwise_conv2d_6/",pwKey:"conv2d_7/",bnKey:"batch_normalization_7/",preluKey:"p_re_lu_7/",inCh:64,outCh:64,stride:1,inH:48},{dwKey:"depthwise_conv2d_7/",pwKey:"conv2d_8/",bnKey:"batch_normalization_8/",preluKey:"p_re_lu_8/",inCh:64,outCh:64,stride:1,inH:48},{dwKey:"depthwise_conv2d_8/",pwKey:"conv2d_9/",bnKey:"batch_normalization_9/",preluKey:"p_re_lu_9/",inCh:64,outCh:64,stride:1,inH:48},{dwKey:"depthwise_conv2d_9/",pwKey:"conv2d_10/",bnKey:"batch_normalization_10/",preluKey:"p_re_lu_10/",inCh:64,outCh:128,stride:2,inH:48},{dwKey:"depthwise_conv2d_10/",pwKey:"conv2d_11/",bnKey:"batch_normalization_11/",preluKey:"p_re_lu_11/",inCh:128,outCh:128,stride:1,inH:24},{dwKey:"depthwise_conv2d_11/",pwKey:"conv2d_12/",bnKey:"batch_normalization_12/",preluKey:"p_re_lu_12/",inCh:128,outCh:128,stride:1,inH:24},{dwKey:"depthwise_conv2d_12/",pwKey:"conv2d_13/",bnKey:"batch_normalization_13/",preluKey:"p_re_lu_13/",inCh:128,outCh:128,stride:1,inH:24},{dwKey:"depthwise_conv2d_13/",pwKey:"conv2d_14/",bnKey:"batch_normalization_14/",preluKey:"p_re_lu_14/",inCh:128,outCh:128,stride:1,inH:24},{dwKey:"depthwise_conv2d_14/",pwKey:"conv2d_15/",bnKey:"batch_normalization_15/",preluKey:"p_re_lu_15/",inCh:128,outCh:256,stride:2,inH:24},{dwKey:"depthwise_conv2d_15/",pwKey:"conv2d_16/",bnKey:"batch_normalization_16/",preluKey:"p_re_lu_16/",inCh:256,outCh:256,stride:1,inH:12},{dwKey:"depthwise_conv2d_16/",pwKey:"conv2d_17/",bnKey:"batch_normalization_17/",preluKey:"p_re_lu_17/",inCh:256,outCh:256,stride:1,inH:12},{dwKey:"depthwise_conv2d_17/",pwKey:"conv2d_18/",bnKey:"batch_normalization_18/",preluKey:"p_re_lu_18/",inCh:256,outCh:256,stride:1,inH:12},{dwKey:"depthwise_conv2d_18/",pwKey:"conv2d_19/",bnKey:"batch_normalization_19/",preluKey:"p_re_lu_19/",inCh:256,outCh:256,stride:1,inH:12},{dwKey:"depthwise_conv2d_19/",pwKey:"conv2d_20/",bnKey:"batch_normalization_20/",preluKey:"p_re_lu_20/",inCh:256,outCh:256,stride:2,inH:12},{dwKey:"depthwise_conv2d_20/",pwKey:"conv2d_21/",bnKey:"batch_normalization_21/",preluKey:"p_re_lu_21/",inCh:256,outCh:256,stride:1,inH:6},{dwKey:"depthwise_conv2d_21/",pwKey:"conv2d_22/",bnKey:"batch_normalization_22/",preluKey:"p_re_lu_22/",inCh:256,outCh:256,stride:1,inH:6},{dwKey:"depthwise_conv2d_22/",pwKey:"conv2d_23/",bnKey:"batch_normalization_23/",preluKey:"p_re_lu_23/",inCh:256,outCh:256,stride:1,inH:6},{dwKey:"depthwise_conv2d_23/",pwKey:"conv2d_24/",bnKey:"batch_normalization_24/",preluKey:"p_re_lu_24/",inCh:256,outCh:256,stride:1,inH:6}].map(e=>{let t=l(e.dwKey),u=l(e.pwKey),x=l(e.bnKey),M=l(e.preluKey),m=C(t),V=c(m.byteLength,g);w(V,0,m);let Y=new Float32Array(e.inCh),Z=c(Y.byteLength,g);w(Z,0,Y);let _=E(u),Q=c(_.byteLength,g);w(Q,0,_);let ee=v(x),i=v(M);return{dwWeightBuf:V,dwBiasBuf:Z,pwWeightBuf:Q,pwBiasBuf:ee,alphaBuf:i,inCh:e.inCh,outCh:e.outCh,stride:e.stride,inH:e.inH}}),I=E(l("conv2d_25/Conv2D")),J=c(I.byteLength,g);w(J,0,I);let ae=v(l("batch_normalization_25/")),D=v(l("p_re_lu_25/")),we={dwWeightBuf:(()=>{let e=C(l("depthwise_conv2d_24/")),t=c(e.byteLength,g);return w(t,0,e),t})(),dwBiasBuf:(()=>{let e=new Float32Array(256),t=c(e.byteLength,g);return w(t,0,e),t})(),pwWeightBuf:(()=>{let e=E(l("conv2d_26/")),t=c(e.byteLength,g);return w(t,0,e),t})(),pwBiasBuf:v(l("batch_normalization_26/")),alphaBuf:v(l("p_re_lu_26/")),inCh:256,outCh:256,stride:1,inH:12},ue={dwWeightBuf:(()=>{let e=C(l("depthwise_conv2d_25/")),t=c(e.byteLength,g);return w(t,0,e),t})(),dwBiasBuf:(()=>{let e=new Float32Array(256),t=c(e.byteLength,g);return w(t,0,e),t})(),pwWeightBuf:(()=>{let e=E(l("conv2d_27/Conv2D1")),t=c(e.byteLength,g);return w(t,0,e),t})(),pwBiasBuf:v(l("batch_normalization_27/")),alphaBuf:v(l("p_re_lu_27/")),inCh:256,outCh:256,stride:1,inH:12},Pe=E(l("conv2d_28/Conv2D")),ce=c(Pe.byteLength,g);w(ce,0,Pe);let re=v(l("batch_normalization_28/")),ze=v(l("p_re_lu_28/")),Ee={dwWeightBuf:(()=>{let e=C(l("depthwise_conv2d_26/")),t=c(e.byteLength,g);return w(t,0,e),t})(),dwBiasBuf:(()=>{let e=new Float32Array(128),t=c(e.byteLength,g);return w(t,0,e),t})(),pwWeightBuf:(()=>{let e=E(l("conv2d_29/")),t=c(e.byteLength,g);return w(t,0,e),t})(),pwBiasBuf:v(l("batch_normalization_29/")),alphaBuf:v(l("p_re_lu_29/")),inCh:128,outCh:128,stride:1,inH:24},Me={dwWeightBuf:(()=>{let e=C(l("depthwise_conv2d_27/")),t=c(e.byteLength,g);return w(t,0,e),t})(),dwBiasBuf:(()=>{let e=new Float32Array(128),t=c(e.byteLength,g);return w(t,0,e),t})(),pwWeightBuf:(()=>{let e=E(l("conv2d_30/Conv2D1")),t=c(e.byteLength,g);return w(t,0,e),t})(),pwBiasBuf:v(l("batch_normalization_30/")),alphaBuf:v(l("p_re_lu_30/")),inCh:128,outCh:128,stride:1,inH:24},De=E(l("classifier_palm_16_NO_PRUNING/Conv2D")),Se=c(De.byteLength,g);w(Se,0,De);let We=v(l("classifier_palm_16_NO_PRUNING/BiasAdd")),Ve=E(l("regressor_palm_16_NO_PRUNING/Conv2D")),Oe=c(Ve.byteLength,g);w(Oe,0,Ve);let tt=v(l("regressor_palm_16_NO_PRUNING/BiasAdd")),Re=E(l("classifier_palm_8_NO_PRUNING/Conv2D")),Ae=c(Re.byteLength,g);w(Ae,0,Re);let Le=v(l("classifier_palm_8_NO_PRUNING/BiasAdd")),at=E(l("regressor_palm_8_NO_PRUNING/Conv2D")),zt=c(at.byteLength,g);w(zt,0,at);let Ht=v(l("regressor_palm_8_NO_PRUNING/BiasAdd")),Mt=Math.max(36864*3,9216*64,2304*128,576*256,144*256)*4,Fe=c(36864*3*4,g),rt=c(Mt,A),Et=c(Mt,A),Wt=c(Mt,A),_t=c(576*256*4,A),it=c(144*256*4,A|GPUBufferUsage.COPY_DST),ht=c(576*128*4,A|GPUBufferUsage.COPY_DST),mt=c(864*4,U),nt=c(15552*4,U),ot=c(576*2*4,U),ut=c(576*36*4,U),gt=c(864*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),bt=c(15552*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),At=c(576*2*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),wt=c(576*36*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),yt=a.createTexture({size:[192,192,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});function T(e,t){return Math.ceil(e/t)}function O(e){let t=c(e.byteLength,y);return w(t,0,e),t}let qt=O(new Uint32Array([1,3,32,192,192,96,96])),Dt=oe.map(e=>{let t=e.stride===2?e.inH/2:e.inH,u=t,x=e.stride===2?1:2,M=e.inCh;return{dw:O(new Uint32Array([1,e.inCh,e.inH,e.inH,t,u,e.stride,x])),pw:O(new Uint32Array([1,e.inCh,e.outCh,t,u,M,e.stride,e.inH,e.inH])),outH:t,outW:u}}),Ye=(()=>{let e=we;return{dw:O(new Uint32Array([1,e.inCh,e.inH,e.inH,e.inH,e.inH,e.stride,2])),pw:O(new Uint32Array([1,e.inCh,e.outCh,e.inH,e.inH,e.inCh,e.stride,e.inH,e.inH])),outH:e.inH}})(),$e=(()=>{let e=ue;return{dw:O(new Uint32Array([1,e.inCh,e.inH,e.inH,e.inH,e.inH,e.stride,2])),pw:O(new Uint32Array([1,e.inCh,e.outCh,e.inH,e.inH,e.inCh,e.stride,e.inH,e.inH])),outH:e.inH}})(),Xe=(()=>{let e=Ee;return{dw:O(new Uint32Array([1,e.inCh,e.inH,e.inH,e.inH,e.inH,e.stride,2])),pw:O(new Uint32Array([1,e.inCh,e.outCh,e.inH,e.inH,e.inCh,e.stride,e.inH,e.inH])),outH:e.inH}})(),xt=(()=>{let e=Me;return{dw:O(new Uint32Array([1,e.inCh,e.inH,e.inH,e.inH,e.inH,e.stride,2])),pw:O(new Uint32Array([1,e.inCh,e.outCh,e.inH,e.inH,e.inCh,e.stride,e.inH,e.inH])),outH:e.inH}})(),Yt=O(new Uint32Array([1,256,6,6,12,12])),Gt=O(new Uint32Array([1,256,12,12,12,12])),$t=O(new Uint32Array([1,256,12,12,24,24])),Xt=O(new Uint32Array([1,128,24,24,24,24])),Ot=O(new Uint32Array([1,256,256,12,12])),Rt=O(new Uint32Array([1,256,128,24,24])),Lt=O(new Uint32Array([1,256,6,12,12])),jt=O(new Uint32Array([1,256,108,12,12])),It=O(new Uint32Array([1,128,2,24,24])),Vt=O(new Uint32Array([1,128,36,24,24])),h=O(new Uint32Array([192,192,192])),n=a.createBindGroup({layout:ft,entries:[{binding:0,resource:yt.createView()},{binding:1,resource:{buffer:Fe}},{binding:2,resource:{buffer:h}}]}),p=null,R=0,S=0,L=c(32,y);function ne(e,t){return p&&R===e&&S===t||(p&&p.destroy(),p=a.createTexture({size:[e,t,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),R=e,S=t),p}let z=a.createBindGroup({layout:et,entries:[{binding:0,resource:{buffer:Fe}},{binding:1,resource:{buffer:te}},{binding:2,resource:{buffer:X}},{binding:3,resource:{buffer:be}},{binding:4,resource:{buffer:rt}},{binding:5,resource:{buffer:qt}}]});function fe(e,t,u,x,M,m){let V=m.outH,Y=a.createBindGroup({layout:Bt,entries:[{binding:0,resource:{buffer:u}},{binding:1,resource:{buffer:t.dwWeightBuf}},{binding:2,resource:{buffer:t.dwBiasBuf}},{binding:3,resource:{buffer:Wt}},{binding:4,resource:{buffer:m.dw}}]}),Z=e.beginComputePass();Z.setPipeline(kt),Z.setBindGroup(0,Y),Z.dispatchWorkgroups(T(V,8),T(m.outH,8),t.inCh),Z.end(),t.inCh*m.outH*V;let _=a.createBindGroup({layout:Pt,entries:[{binding:0,resource:{buffer:Wt}},{binding:1,resource:{buffer:M}},{binding:2,resource:{buffer:t.pwWeightBuf}},{binding:3,resource:{buffer:t.pwBiasBuf}},{binding:4,resource:{buffer:t.alphaBuf}},{binding:5,resource:{buffer:x}},{binding:6,resource:{buffer:m.pw}}]}),Q=e.beginComputePass();Q.setPipeline(St),Q.setBindGroup(0,_),Q.dispatchWorkgroups(T(V,8),T(m.outH,8),t.outCh),Q.end(),t.outCh*m.outH*V}function le(e,t,u,x,M,m,V,Y,Z){let _=a.createBindGroup({layout:Ut,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:u}},{binding:2,resource:{buffer:x}},{binding:3,resource:{buffer:M}},{binding:4,resource:{buffer:m}}]}),Q=e.beginComputePass();Q.setPipeline(b),Q.setBindGroup(0,_),Q.dispatchWorkgroups(T(Z,8),T(Y,8),V),Q.end()}function ye(e,t,u,x,M,m,V,Y,Z,_){let Q=a.createBindGroup({layout:Ie,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:u}},{binding:2,resource:{buffer:x}},{binding:3,resource:{buffer:M}},{binding:4,resource:{buffer:m}},{binding:5,resource:{buffer:V}}]}),ee=e.beginComputePass();ee.setPipeline(N),ee.setBindGroup(0,Q),ee.dispatchWorkgroups(T(_,8),T(Z,8),Y),ee.end()}async function se(e){{let i=e.beginComputePass();i.setPipeline(qe),i.setBindGroup(0,z),i.dispatchWorkgroups(T(96,8),T(96,8),32),i.end()}let t=rt,u=Et;for(let i=0;i<oe.length;i++){let f=oe[i];fe(e,f,t,u,t,Dt[i]);let _e=t;t=u,u=_e,i===13&&e.copyBufferToBuffer(t,0,ht,0,576*128*4),i===18&&e.copyBufferToBuffer(t,0,it,0,144*256*4)}{let i=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:_t}},{binding:2,resource:{buffer:u}},{binding:3,resource:{buffer:Yt}}]}),f=e.beginComputePass();f.setPipeline(K),f.setBindGroup(0,i),f.dispatchWorkgroups(T(12,8),T(12,8),256),f.end()}{let i=t;t=u,u=i}ye(e,t,J,ae,D,u,Ot,256,12,12);{let i=t;t=u,u=i}{let i=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:it}},{binding:2,resource:{buffer:u}},{binding:3,resource:{buffer:Gt}}]}),f=e.beginComputePass();f.setPipeline(K),f.setBindGroup(0,i),f.dispatchWorkgroups(T(12,8),T(12,8),256),f.end()}{let i=t;t=u,u=i}fe(e,we,t,u,t,Ye);{let i=t;t=u,u=i}fe(e,ue,t,u,t,$e);{let i=t;t=u,u=i}le(e,t,Se,We,mt,Lt,6,12,12),le(e,t,Oe,tt,nt,jt,108,12,12);{let i=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:_t}},{binding:2,resource:{buffer:u}},{binding:3,resource:{buffer:$t}}]}),f=e.beginComputePass();f.setPipeline(K),f.setBindGroup(0,i),f.dispatchWorkgroups(T(24,8),T(24,8),256),f.end()}{let i=t;t=u,u=i}ye(e,t,ce,re,ze,u,Rt,128,24,24);{let i=t;t=u,u=i}{let i=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:ht}},{binding:2,resource:{buffer:u}},{binding:3,resource:{buffer:Xt}}]}),f=e.beginComputePass();f.setPipeline(K),f.setBindGroup(0,i),f.dispatchWorkgroups(T(24,8),T(24,8),128),f.end()}{let i=t;t=u,u=i}fe(e,Ee,t,u,t,Xe);{let i=t;t=u,u=i}fe(e,Me,t,u,t,xt);{let i=t;t=u,u=i}le(e,t,Ae,Le,ot,It,2,24,24),le(e,t,zt,Ht,ut,Vt,36,24,24),a.queue.submit([e.finish()]);let x=a.createCommandEncoder();x.copyBufferToBuffer(mt,0,gt,0,864*4),x.copyBufferToBuffer(nt,0,bt,0,15552*4),x.copyBufferToBuffer(ot,0,At,0,576*2*4),x.copyBufferToBuffer(ut,0,wt,0,576*36*4),a.queue.submit([x.finish()]),await Promise.all([gt.mapAsync(GPUMapMode.READ),bt.mapAsync(GPUMapMode.READ),At.mapAsync(GPUMapMode.READ),wt.mapAsync(GPUMapMode.READ)]);let M=new Float32Array(gt.getMappedRange()).slice(),m=new Float32Array(bt.getMappedRange()).slice(),V=new Float32Array(At.getMappedRange()).slice(),Y=new Float32Array(wt.getMappedRange()).slice();gt.unmap(),bt.unmap(),At.unmap(),wt.unmap();let Z=2016,_=new Float32Array(Z),Q=new Float32Array(Z*18),ee=0;for(let i=0;i<12;i++)for(let f=0;f<12;f++)for(let _e=0;_e<6;_e++){_[ee]=M[_e*144+i*12+f];for(let Ge=0;Ge<18;Ge++){let st=_e*18+Ge;Q[ee*18+Ge]=m[st*144+i*12+f]}ee++}for(let i=0;i<24;i++)for(let f=0;f<24;f++)for(let _e=0;_e<2;_e++){_[ee]=V[_e*576+i*24+f];for(let Ge=0;Ge<18;Ge++){let st=_e*18+Ge;Q[ee*18+Ge]=Y[st*576+i*24+f]}ee++}return{scores:_,regressors:Q}}async function xe(e){a.queue.copyExternalImageToTexture({source:e},{texture:yt},[192,192]);let t=a.createCommandEncoder();{let u=t.beginComputePass();u.setPipeline(q),u.setBindGroup(0,n),u.dispatchWorkgroups(T(192,16),T(192,16),1),u.end()}return se(t)}async function Ze(e,t,u){let x=Math.min(192/t,192/u),M=Math.round(t*x),m=Math.round(u*x),V=Math.floor((192-M)/2),Y=Math.floor((192-m)/2),Z=V/192,_=Y/192,Q=ne(t,u),ee;e instanceof HTMLVideoElement?ee=await createImageBitmap(e,{colorSpaceConversion:"none"}):e instanceof HTMLImageElement?ee=await createImageBitmap(e,{colorSpaceConversion:"none"}):ee=e,a.queue.copyExternalImageToTexture({source:ee},{texture:Q},[t,u]);let i=new ArrayBuffer(32),f=new Uint32Array(i),_e=new Float32Array(i);f[0]=t,f[1]=u,f[2]=192,f[3]=0,_e[4]=t/M,_e[5]=u/m,_e[6]=V,_e[7]=Y,a.queue.writeBuffer(L,0,i);let Ge=a.createBindGroup({layout:Ke,entries:[{binding:0,resource:Q.createView()},{binding:1,resource:{buffer:Fe}},{binding:2,resource:{buffer:L}},{binding:3,resource:r}]}),st=a.createCommandEncoder();{let Tt=st.beginComputePass();Tt.setPipeline(he),Tt.setBindGroup(0,Ge),Tt.dispatchWorkgroups(T(192,16),T(192,16),1),Tt.end()}return{output:await se(st),lbPadX:Z,lbPadY:_}}async function F(e,t){let u=a.createBuffer({size:t*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),x=a.createCommandEncoder();x.copyBufferToBuffer(e,0,u,0,t*4),a.queue.submit([x.finish()]),await u.mapAsync(GPUMapMode.READ);let M=new Float32Array(u.getMappedRange()).slice();return u.unmap(),u.destroy(),M}async function Zt(e,t,u){function x(o,d=1e3){let H=o.slice(0,d),pe=Math.max(0,Math.floor(o.length/2)-250);return{min:Math.min(...H),max:Math.max(...H),mean:H.reduce((Ue,dt)=>Ue+dt,0)/H.length,nonZero:H.filter(Ue=>Ue!==0).length,sample:Array.from(H.slice(0,10)),data500:Array.from(o.slice(0,500)),dataMid500:Array.from(o.slice(pe,pe+500)),totalLength:o.length}}function M(o,d,H,pe){let Ue=[],dt=Math.floor(H/2),lt=Math.floor(pe/2),je=H*pe;for(let pt=0;pt<d&&Ue.length<500;pt++)for(let Ft=-1;Ft<=1&&Ue.length<500;Ft++)for(let Nt=-1;Nt<=1&&Ue.length<500;Nt++){let ct=dt+Ft,Jt=lt+Nt;ct>=0&&ct<H&&Jt>=0&&Jt<pe&&Ue.push(o[pt*je+ct*pe+Jt])}return Ue}let m={},V;e instanceof HTMLImageElement?(t=t??e.naturalWidth,u=u??e.naturalHeight,V=await createImageBitmap(e,{colorSpaceConversion:"none"})):(t=t??e.width??192,u=u??e.height??192,V=e);let Y=t,Z=u;if(Y!==192||Z!==192){let o=Math.min(192/Y,192/Z),d=Math.round(Y*o),H=Math.round(Z*o),pe=Math.floor((192-d)/2),Ue=Math.floor((192-H)/2),dt=ne(Y,Z);a.queue.copyExternalImageToTexture({source:V},{texture:dt},[Y,Z]);let lt=new ArrayBuffer(32),je=new Uint32Array(lt),pt=new Float32Array(lt);je[0]=Y,je[1]=Z,je[2]=192,je[3]=0,pt[4]=Y/d,pt[5]=Z/H,pt[6]=pe,pt[7]=Ue,a.queue.writeBuffer(L,0,lt);let Ft=a.createBindGroup({layout:Ke,entries:[{binding:0,resource:dt.createView()},{binding:1,resource:{buffer:Fe}},{binding:2,resource:{buffer:L}},{binding:3,resource:r}]});{let Nt=a.createCommandEncoder(),ct=Nt.beginComputePass();ct.setPipeline(he),ct.setBindGroup(0,Ft),ct.dispatchWorkgroups(T(192,16),T(192,16),1),ct.end(),a.queue.submit([Nt.finish()])}}else{a.queue.copyExternalImageToTexture({source:V},{texture:yt},[192,192]);let o=O(new Uint32Array([192,192,192])),d=a.createBindGroup({layout:ft,entries:[{binding:0,resource:yt.createView()},{binding:1,resource:{buffer:Fe}},{binding:2,resource:{buffer:o}}]});{let H=a.createCommandEncoder(),pe=H.beginComputePass();pe.setPipeline(q),pe.setBindGroup(0,d),pe.dispatchWorkgroups(T(192,16),T(192,16),1),pe.end(),a.queue.submit([H.finish()])}}{let o=await F(Fe,110592),d=x(o);d.dataCenter500=M(o,3,192,192),m.input=d}let _=a.createCommandEncoder(),Q=a.createBindGroup({layout:et,entries:[{binding:0,resource:{buffer:Fe}},{binding:1,resource:{buffer:te}},{binding:2,resource:{buffer:X}},{binding:3,resource:{buffer:be}},{binding:4,resource:{buffer:rt}},{binding:5,resource:{buffer:qt}}]}),ee=_.beginComputePass();ee.setPipeline(qe),ee.setBindGroup(0,Q),ee.dispatchWorkgroups(T(96,8),T(96,8),32),ee.end(),a.queue.submit([_.finish()]);{let o=await F(rt,294912),d=x(o);d.dataCenter500=M(o,32,96,96),m.initConv=d}let i=rt,f=Et;for(let o=0;o<oe.length;o++){let d=oe[o];_=a.createCommandEncoder(),fe(_,d,i,f,i,Dt[o]),a.queue.submit([_.finish()]);let H=i;i=f,f=H;{let pe=d.stride===2?d.inH/2:d.inH,Ue=pe,dt=pe*Ue*d.outCh,lt=await F(i,dt),je=x(lt);je.dataCenter500=M(lt,d.outCh,pe,Ue),je.spatialShape=[d.outCh,pe,Ue],m[`block${o}`]=je}o===13&&(_=a.createCommandEncoder(),_.copyBufferToBuffer(i,0,ht,0,576*128*4),a.queue.submit([_.finish()])),o===18&&(_=a.createCommandEncoder(),_.copyBufferToBuffer(i,0,it,0,144*256*4),a.queue.submit([_.finish()]))}_=a.createCommandEncoder();{let o=O(new Uint32Array([1,256,6,6,12,12])),d=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:i}},{binding:1,resource:{buffer:_t}},{binding:2,resource:{buffer:f}},{binding:3,resource:{buffer:o}}]}),H=_.beginComputePass();H.setPipeline(K),H.setBindGroup(0,d),H.dispatchWorkgroups(T(12,8),T(12,8),256),H.end()}a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,36864),d=x(o);d.dataCenter500=M(o,256,12,12),m.fpnUpsample6to12=d}_=a.createCommandEncoder(),ye(_,i,J,ae,D,f,Ot,256,12,12),a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,36864),d=x(o);d.dataCenter500=M(o,256,12,12),m.fpn6to12Conv=d}{let o=await F(it,36864),d=x(o);d.dataCenter500=M(o,256,12,12),m.backbone12Skip=d}_=a.createCommandEncoder();{let o=O(new Uint32Array([1,256,12,12,12,12])),d=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:i}},{binding:1,resource:{buffer:it}},{binding:2,resource:{buffer:f}},{binding:3,resource:{buffer:o}}]}),H=_.beginComputePass();H.setPipeline(K),H.setBindGroup(0,d),H.dispatchWorkgroups(T(12,8),T(12,8),256),H.end()}a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,36864),d=x(o);d.dataCenter500=M(o,256,12,12),m.fpnAdd12=d}_=a.createCommandEncoder(),fe(_,we,i,f,i,Ye),a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,36864),d=x(o);d.dataCenter500=M(o,256,12,12),m.fpn12Block1=d}_=a.createCommandEncoder(),fe(_,ue,i,f,i,$e),a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,36864),d=x(o);d.dataCenter500=M(o,256,12,12),m.fpn12Block2=d}_=a.createCommandEncoder(),le(_,i,Se,We,mt,Lt,6,12,12),a.queue.submit([_.finish()]);{let o=await F(mt,864),d=x(o);d.dataCenter500=M(o,6,12,12),m.cls16=d}_=a.createCommandEncoder(),le(_,i,Oe,tt,nt,jt,108,12,12),a.queue.submit([_.finish()]);{let o=await F(nt,15552),d=x(o,500);d.dataCenter500=M(o,108,12,12),m.reg16=d}_=a.createCommandEncoder();{let o=O(new Uint32Array([1,256,12,12,24,24])),d=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:i}},{binding:1,resource:{buffer:_t}},{binding:2,resource:{buffer:f}},{binding:3,resource:{buffer:o}}]}),H=_.beginComputePass();H.setPipeline(K),H.setBindGroup(0,d),H.dispatchWorkgroups(T(24,8),T(24,8),256),H.end()}a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,147456),d=x(o);d.dataCenter500=M(o,256,24,24),m.fpnUpsample12to24=d}_=a.createCommandEncoder(),ye(_,i,ce,re,ze,f,Rt,128,24,24),a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,73728),d=x(o);d.dataCenter500=M(o,128,24,24),m.fpn12to24Conv=d}{let o=await F(ht,73728),d=x(o);d.dataCenter500=M(o,128,24,24),m.backbone24Skip=d}_=a.createCommandEncoder();{let o=O(new Uint32Array([1,128,24,24,24,24])),d=a.createBindGroup({layout:Ce,entries:[{binding:0,resource:{buffer:i}},{binding:1,resource:{buffer:ht}},{binding:2,resource:{buffer:f}},{binding:3,resource:{buffer:o}}]}),H=_.beginComputePass();H.setPipeline(K),H.setBindGroup(0,d),H.dispatchWorkgroups(T(24,8),T(24,8),128),H.end()}a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,73728),d=x(o);d.dataCenter500=M(o,128,24,24),m.fpnAdd24=d}_=a.createCommandEncoder(),fe(_,Ee,i,f,i,Xe),a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,73728),d=x(o);d.dataCenter500=M(o,128,24,24),m.fpn24Block1=d}_=a.createCommandEncoder(),fe(_,Me,i,f,i,xt),a.queue.submit([_.finish()]);{let o=i;i=f,f=o}{let o=await F(i,73728),d=x(o);d.dataCenter500=M(o,128,24,24),m.fpn24Block2=d}_=a.createCommandEncoder(),le(_,i,Ae,Le,ot,It,2,24,24),a.queue.submit([_.finish()]);{let o=await F(ot,1152),d=x(o);d.dataCenter500=M(o,2,24,24),m.cls8=d}_=a.createCommandEncoder(),le(_,i,zt,Ht,ut,Vt,36,24,24),a.queue.submit([_.finish()]);{let o=await F(ut,20736),d=x(o);d.dataCenter500=M(o,36,24,24),m.reg8=d}m.initWeights=x(await F(te,100),100),m.initBias=x(await F(X,32),32),m.cls16Weights=x(await F(Se,100),100),m.cls16Bias=x(await F(We,6),6),m.cls8Weights=x(await F(Ae,100),100),m.cls8Bias=x(await F(Le,2),2),m.fpn6to12Weights=x(await F(J,100),100);let _e=await F(mt,864),Ge=await F(ot,576*2);m.rawScores=new Float32Array(2016),m.rawScores.set(_e,0),m.rawScores.set(Ge,864);let st=await F(nt,15552),Tt=await F(ut,576*36);return m.rawRegressors=new Float32Array(36288),m.rawRegressors.set(st,0),m.rawRegressors.set(Tt,15552),m.rawInput=await F(Fe,36864*3),m}return{device:a,run:xe,runWithResize:Ze,debugRun:Zt}}function Ma(){let s=[];for(let B=0;B<12;B++)for(let a=0;a<12;a++){let G=(a+.5)/12,P=(B+.5)/12;for(let r=0;r<6;r++)s.push({x:G,y:P})}for(let B=0;B<24;B++)for(let a=0;a<24;a++){let G=(a+.5)/24,P=(B+.5)/24;for(let r=0;r<2;r++)s.push({x:G,y:P})}return s}var ta=Ma();function Aa(s){return 1/(1+Math.exp(-s))}function Qt(s,B){let a=[],{scores:G,regressors:P}=s,r=192;for(let g=0;g<ta.length;g++){let A=Aa(G[g]);if(A<B)continue;let U=ta[g],y=g*18,c=U.x+P[y+0]/r,w=U.y+P[y+1]/r,v=P[y+2]/r,j=P[y+3]/r,W=[];for(let l=0;l<7;l++){let C=U.x+P[y+4+l*2]/r,E=U.y+P[y+4+l*2+1]/r;W.push([C,E])}a.push({score:A,box:[c,w,v,j],keypoints:W})}return a}function ea(s,B){if(s.length===0)return[];let a=[...s].sort((r,g)=>g.score-r.score),G=[],P=new Set;for(let r=0;r<a.length;r++){if(P.has(r))continue;let g=[r];for(let W=r+1;W<a.length;W++)P.has(W)||Ga(a[r],a[W])>B&&(g.push(W),P.add(W));let A=0,U=0,y=0,c=0,w=0,v=[];for(let W=0;W<7;W++)v.push([0,0]);for(let W of g){let l=a[W],C=l.score;A+=C,U+=l.box[0]*C,y+=l.box[1]*C,c+=l.box[2]*C,w+=l.box[3]*C;for(let E=0;E<7;E++)v[E][0]+=l.keypoints[E][0]*C,v[E][1]+=l.keypoints[E][1]*C}let j=1/A;G.push({score:a[r].score,box:[U*j,y*j,c*j,w*j],keypoints:v.map(([W,l])=>[W*j,l*j])})}return G}function Ga(s,B){let a=s.box[0]-s.box[2]/2,G=s.box[1]-s.box[3]/2,P=s.box[0]+s.box[2]/2,r=s.box[1]+s.box[3]/2,g=B.box[0]-B.box[2]/2,A=B.box[1]-B.box[3]/2,U=B.box[0]+B.box[2]/2,y=B.box[1]+B.box[3]/2,c=Math.max(a,g),w=Math.max(G,A),v=Math.min(P,U),j=Math.min(r,y),W=Math.max(0,v-c),l=Math.max(0,j-w),C=W*l,E=(P-a)*(r-G),Te=(U-g)*(y-A),He=E+Te-C;return He>0?C/He:0}function Ta(s){let[B,a,G,P]=s.box,r=s.keypoints[0],g=s.keypoints[2],A=g[0]-r[0],U=g[1]-r[1],y=Math.atan2(U,A),c=-Math.PI/2-y,w=Math.max(G,P),v=w*2.6,j=-.5*w,W=Math.cos(c),l=Math.sin(c),C=j*l,E=j*W;return{centerX:B+C,centerY:a+E,width:v,height:v,rotation:c}}function Na(s,B={}){let{scoreThreshold:a=.5,nmsThreshold:G=.3,maxHands:P=2}=B;async function r(y){let c=await s.run(y),w=Qt(c,a);return ea(w,G).slice(0,P).map(Ta)}async function g(y){let c=await s.run(y),w=Qt(c,a);return ea(w,G).slice(0,P)}async function A(y,c,w){let{output:v,lbPadX:j,lbPadY:W}=await s.runWithResize(y,c,w),l=Qt(v,a);return{detections:ea(l,G).slice(0,P),lbPadX:j,lbPadY:W}}async function U(y,c,w){let{output:v,lbPadX:j,lbPadY:W}=await s.runWithResize(y,c,w);return{scores:v.scores,regressors:v.regressors,lbPadX:j,lbPadY:W}}return{detect:r,detectRaw:g,detectRawWithResize:A,detectRawSSD:U,model:s}}var aa=["wrist","thumb_cmc","thumb_mcp","thumb_ip","thumb_tip","index_mcp","index_pip","index_dip","index_tip","middle_mcp","middle_pip","middle_dip","middle_tip","ring_mcp","ring_pip","ring_dip","ring_tip","pinky_mcp","pinky_pip","pinky_dip","pinky_tip"];function ra(s){let B={};for(let a=0;a<aa.length;a++)B[aa[a]]=s[a];return B}function Sa(s){return s.replace(/\/\/[^\n]*/g,"").replace(/\s+/g," ").replace(/\s*([{}();,=+\-*/<>!&|@])\s*/g,"$1").trim()}var Ha=Sa(`
struct CropParams { src_width:u32, src_height:u32, dst_size:u32, _pad:u32, }
struct AffineTransform { a:f32, b:f32, tx:f32, c:f32, d:f32, ty:f32, }

@group(0)@binding(0) var src_tex:texture_2d<f32>;
@group(0)@binding(1) var<storage,read_write> output:array<f32>;
@group(0)@binding(2) var<uniform> params:CropParams;
@group(0)@binding(3) var<uniform> transform:AffineTransform;
@group(0)@binding(4) var src_sampler:sampler;

@compute @workgroup_size(16,16,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let dst_x=gid.x; let dst_y=gid.y;
  if(dst_x>=params.dst_size||dst_y>=params.dst_size){return;}

  // Map crop pixel to source normalized coordinates [0,1]
  let fx=f32(dst_x)+0.5;
  let fy=f32(dst_y)+0.5;
  let src_nx=transform.a*fx+transform.b*fy+transform.tx;
  let src_ny=transform.c*fx+transform.d*fy+transform.ty;

  let out_stride=params.dst_size*params.dst_size;

  // Hardware bilinear sampling via textureSampleLevel with clamp-to-edge sampler.
  // Clamp-to-edge matches MediaPipe's BORDER_REPLICATE default
  // (ImageToTensorCalculatorOptions proto: "BORDER_REPLICATE is used by default").
  let pixel = textureSampleLevel(src_tex, src_sampler, vec2<f32>(src_nx, src_ny), 0.0);

  // Write CHW format
  output[0u*out_stride+dst_y*params.dst_size+dst_x]=pixel.r;
  output[1u*out_stride+dst_y*params.dst_size+dst_x]=pixel.g;
  output[2u*out_stride+dst_y*params.dst_size+dst_x]=pixel.b;
}
`);function Ea(s){let B=s.createShaderModule({code:Ha}),a=s.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:4,visibility:GPUShaderStage.COMPUTE,sampler:{}}]}),G=s.createComputePipeline({layout:s.createPipelineLayout({bindGroupLayouts:[a]}),compute:{module:B,entryPoint:"main"}}),P=s.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),r=s.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),g=s.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),A=new Float32Array(8);function U(y,c,w,v,j,W,l){s.queue.writeBuffer(r,0,new Uint32Array([j,W,l,0])),A.set(v),s.queue.writeBuffer(g,0,A);let C=s.createBindGroup({layout:a,entries:[{binding:0,resource:c.createView()},{binding:1,resource:{buffer:w}},{binding:2,resource:{buffer:r}},{binding:3,resource:{buffer:g}},{binding:4,resource:P}]}),E=y.beginComputePass();E.setPipeline(G),E.setBindGroup(0,C),E.dispatchWorkgroups(Math.ceil(l/16),Math.ceil(l/16),1),E.end()}return{crop:U}}var Wa="https://cdn.jsdelivr.net/npm/@svenflow/micro-handpose@0.3.0/weights";async function Ra(s={}){let{weightsUrl:B,scoreThreshold:a=.5,palmScoreThreshold:G=.5,maxHands:P=3}=s;if(typeof navigator>"u"||!navigator.gpu)throw new Error("micro-handpose requires WebGPU. Check browser support at https://webgpureport.org");let r=(B??Wa).replace(/\/$/,"")+"/",[g,A,U,y]=await Promise.all([fetch(`${r}weights_f16_full.json`),fetch(`${r}weights_f16_full.bin`),fetch(`${r}palm_detection_weights.json`),fetch(`${r}palm_detection_weights.bin`)]);if(!g.ok)throw new Error(`Failed to fetch landmark weights: ${g.status}`);if(!A.ok)throw new Error(`Failed to fetch landmark weights: ${A.status}`);if(!U.ok)throw new Error(`Failed to fetch palm detection weights: ${U.status}`);if(!y.ok)throw new Error(`Failed to fetch palm detection weights: ${y.status}`);let[c,w,v,j]=await Promise.all([g.json(),A.arrayBuffer(),U.json(),y.arrayBuffer()]),W=ua(c,w),l=ia(v,j),C=224,E=await wa(W);{let b=new OffscreenCanvas(C,C),N=b.getContext("2d");N.fillStyle="#886644",N.fillRect(0,0,C,C),N.fillStyle="#cc9966",N.fillRect(50,50,124,124);let K=await E.runFromCanvas(b);K.landmarks.every(q=>q===0)&&K.handflag.every(q=>q===0)&&console.warn("[micro-handpose] FULL model produced all-zero output on self-test")}let Te=await za(l),He=Na(Te,{scoreThreshold:G,maxHands:P}),ie=[];function k(b,N,K){let q=b[0],he=b[5],ke=b[9],me=b[13],ge=q.x*N,te=q.y*K,X=(he.x+me.x)/2,be=(he.y+me.y)/2;X=(X+ke.x)/2*N,be=(be+ke.y)/2*K;let oe=Math.PI/2-Math.atan2(-(be-te),X-ge),I=oe-2*Math.PI*Math.floor((oe+Math.PI)/(2*Math.PI)),J=[0,1,2,3,5,6,9,10,13,14,17,18],ae=Math.cos(I),D=Math.sin(I),we=1/0,ue=-1/0,Pe=1/0,ce=-1/0;for(let Oe of J){let tt=b[Oe],Re=tt.x*N,Ae=tt.y*K,Le=ae*Re+D*Ae,at=-D*Re+ae*Ae;we=Math.min(we,Le),ue=Math.max(ue,Le),Pe=Math.min(Pe,at),ce=Math.max(ce,at)}let re=(we+ue)/2,ze=(Pe+ce)/2,Ee=ue-we,Me=ce-Pe,De=(ae*re-D*ze)/N,Se=(D*re+ae*ze)/K;Ee/=N,Me/=K;let We=-.1;De+=-K*Me*We*D/N,Se+=Me*We*ae;let Ve=Math.max(Ee*N,Me*K)*2;return{centerXpx:De*N,centerYpx:Se*K,sizePx:Ve,rotation:I}}let de=E.device,ve=null,$=null,Ne=null,Ct=0,et=0;function Bt(){return ve||(ve=Ea(de)),ve}function Pt(){return $||($=de.createBuffer({size:3*C*C*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC})),$}function Ut(b,N){return(!Ne||Ct!==b||et!==N)&&(Ne&&Ne.destroy(),Ne=de.createTexture({size:[b,N],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),Ct=b,et=N),Ne}let Ie=0,Ce=0;function ft(b){let N=1/(1-2*Ie),K=1/(1-2*Ce);return{score:b.score,box:[(b.box[0]-Ie)*N,(b.box[1]-Ce)*K,b.box[2]*N,b.box[3]*K],keypoints:b.keypoints.map(([q,he])=>[(q-Ie)*N,(he-Ce)*K])}}function Ke(b,N,K){let q=b.keypoints[0],he=b.keypoints[2],ke=(he[0]-q[0])*N,me=(he[1]-q[1])*K,ge=Math.atan2(-me,ke),te=Math.PI/2-ge,X=te-2*Math.PI*Math.floor((te+Math.PI)/(2*Math.PI)),[be,oe,I,J]=b.box,ae=Math.cos(X),D=Math.sin(X),we=J*K,ue=be+.5*we*D/N,Pe=oe+-.5*J*ae,ce=Math.max(I*N,J*K)*2.6;return{centerXpx:ue*N,centerYpx:Pe*K,sizePx:ce,rotation:X}}function Kt(b){return b instanceof HTMLCanvasElement||b instanceof OffscreenCanvas?[b.width,b.height]:typeof ImageBitmap<"u"&&b instanceof ImageBitmap?[b.width,b.height]:b instanceof ImageData?[b.width,b.height]:b instanceof HTMLVideoElement?[b.videoWidth,b.videoHeight]:b instanceof HTMLImageElement?[b.naturalWidth,b.naturalHeight]:[C,C]}async function Be(b,N,K,q,he,ke){let me=Math.cos(b.rotation),ge=Math.sin(b.rotation),te=b.sizePx/C,X=C/2,be=me*te/K,oe=-ge*te/K,I=b.centerXpx/K-X*(be+oe),J=ge*te/q,ae=me*te/q,D=b.centerYpx/q-X*(J+ae),we=de.createCommandEncoder();he.crop(we,N,ke,[be,oe,I,J,ae,D],K,q,C),de.queue.submit([we.finish()]);let ue=await E.runFromGPUBuffer(ke),Pe=ue.handflag[0];if(Pe<a)return null;let ce=ue.handedness[0]>.5,re=[];for(let ze=0;ze<21;ze++){let Ee=ue.landmarks[ze*3],Me=ue.landmarks[ze*3+1],De=ue.landmarks[ze*3+2],Se=(Ee-.5)*b.sizePx,We=(Me-.5)*b.sizePx,Ve=me*Se-ge*We+b.centerXpx,Oe=ge*Se+me*We+b.centerYpx;re.push({x:Ve/K,y:Oe/q,z:De})}return{landmarks:re,score:Pe,handedness:ce?"right":"left"}}async function qe(b){let N=b,K,q;if(b instanceof HTMLVideoElement||b instanceof HTMLImageElement){let I=await createImageBitmap(b,{colorSpaceConversion:"none"});N=I,K=I.width,q=I.height}else[K,q]=Kt(b);let he=Bt(),ke=Pt(),me=Ut(K,q),ge;if(N instanceof ImageData?ge=await createImageBitmap(N,{colorSpaceConversion:"none"}):ge=N,de.queue.copyExternalImageToTexture({source:ge},{texture:me},[K,q]),ie.length>0){let I=[];for(let J of ie){let ae=k(J.landmarks,K,q),D=await Be(ae,me,K,q,he,ke);D&&I.push({score:D.score,handedness:D.handedness,landmarks:D.landmarks,keypoints:ra(D.landmarks)})}if(I.length>0)return ie=I.map(J=>({landmarks:J.landmarks,handedness:J.handedness})),I;ie=[]}let{detections:te,lbPadX:X,lbPadY:be}=await He.detectRawWithResize(N,K,q);if(Ie=X,Ce=be,te.length===0)return ie=[],[];let oe=[];for(let I of te){let J=ft(I),ae=Ke(J,K,q),D=await Be(ae,me,K,q,he,ke);D&&oe.push({score:D.score,handedness:D.handedness,landmarks:D.landmarks,keypoints:ra(D.landmarks)})}return ie=oe.map(I=>({landmarks:I.landmarks,handedness:I.handedness})),oe}function kt(){Ne&&Ne.destroy(),$&&$.destroy(),Ne=null,$=null,ve=null,E.device.destroy(),Te.device.destroy()}function St(){ie=[]}return{detect:qe,dispose:kt,reset:St}}export{aa as LANDMARK_NAMES,Ra as createHandpose};
