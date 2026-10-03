import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createPigeonLife } from './pigeon-life.js';
import { createSceneLife, installFoliageWind } from './scene-life.js';

export const LANDMARKS = {
  studio: { position: [-.95,1.62,-.12], yaw: 0 },
  phone: { position: [3.6,1.71,1.7], yaw: 0 },
  mail: { position: [-4.9,1.91,4.0], yaw: Math.PI / 2 }
};

export function createWorld(scene, renderer) {
  const world = new THREE.Group(); scene.add(world);
  const mats = {}, cache = new Map(), batches = new Map(), outlines = [];
  const moving = new THREE.Group(); world.add(moving);
  const hitboxes = [], disposables = [], rainStreaks = [], ripples = [], letters = [], leaves = [];
  const v = (x,y,z) => new THREE.Vector3(x,y,z);
  function mergeCompatible(gs) {
    // Rigid untextured parts may mix UV-equipped primitives and custom position/normal meshes.
    // Keep their common attributes instead of attempting an invalid merge and losing the batch.
    const common=Object.keys(gs[0].attributes).filter(name=>gs.every(g=>g.getAttribute(name)));
    for(const g of gs)for(const name of Object.keys(g.attributes))if(!common.includes(name))g.deleteAttribute(name);
    const mixed=gs.some(g=>g.index)&&gs.some(g=>!g.index);
    const normalized=mixed?gs.map(g=>g.index?g.toNonIndexed():g):gs;
    const result=mergeGeometries(normalized,false);
    if(mixed)normalized.forEach((g,i)=>{if(g!==gs[i])g.dispose();});
    return result;
  }
  const material = (name,color,options={}) => mats[name] = new THREE.MeshStandardMaterial({color,roughness:.72,flatShading:false,...options});
  material('base','#263b44'); material('edge','#30444a'); material('road','#263c47',{roughness:.27,metalness:.16});
  material('pavement','#617070'); material('curb','#92998c'); material('wall','#6c796e'); material('wallDark','#3f5550');
  material('roof','#294448',{metalness:.38,roughness:.5}); material('roofLine','#405959',{metalness:.35});
  material('wood','#987956'); material('woodLight','#c0a778'); material('floor','#9b8361'); material('dark','#172b30');
  material('metal','#526369',{metalness:.7,roughness:.35}); material('black','#233438'); material('red','#893e36',{roughness:.48,metalness:.12});
  material('redEdge','#b75b46',{roughness:.35,metalness:.2}); material('paper','#e4d4ae'); material('cream','#dcd3b9');
  material('green','#48624d'); material('greenLight','#788566'); material('greenDark','#304e43'); material('pot','#9c6048');
  material('brass','#b59a62',{metalness:.6,roughness:.3}); material('white','#cbd3c9');
  material('warm','#ffda8a',{emissive:'#ffbd62',emissiveIntensity:2.2});
  material('bulb','#ffdeb0',{emissive:'#ffc475',emissiveIntensity:3.5});
  material('screen','#a2d3d1',{emissive:'#83beb7',emissiveIntensity:.6});
  material('cyan','#89b1ae',{emissive:'#659e9f',emissiveIntensity:.35});
  material('glass','#7fa4a0',{transparent:true,opacity:.055,roughness:.62,metalness:0,depthWrite:false,side:THREE.DoubleSide});
  const gradient = new THREE.DataTexture(new Uint8Array([70,145,205,255]),4,1,THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
  // Continuous smooth lighting, also on foliage, avoids discrete horizontal tone bands.
  for(const key of ['green','greenLight','greenDark']) { mats[key].flatShading=false;mats[key].roughness=.92; }
  disposables.push(gradient);
  const unitBox = new THREE.BoxGeometry(1,1,1);
  function geom(key, create) { if(!cache.has(key)) cache.set(key,create()); return cache.get(key); }
  function mesh(g, mat, pos=[0,0,0], scale=[1,1,1], rotation=[0,0,0], parent=world, outline=false) {
    const m = new THREE.Mesh(g, typeof mat === 'string' ? mats[mat] : mat); m.position.set(...pos); m.scale.set(...scale); m.rotation.set(...rotation);
    m.castShadow = !m.material.transparent; m.receiveShadow = true; parent.add(m);
    if(parent === world && !m.material.transparent) { m.updateMatrix(); const cloned = g.clone().applyMatrix4(m.matrix); if(!batches.has(m.material)) batches.set(m.material,[]); batches.get(m.material).push(cloned); world.remove(m);
      if(outline) { const eg = new THREE.EdgesGeometry(g,28); eg.applyMatrix4(m.matrix); outlines.push(eg); }
    }
    return m;
  }
  const box = (pos,size,mat,rot=[0,0,0],parent=world,outline=false) => mesh(unitBox,mat,pos,size,rot,parent,outline);
  const cylinder = (pos,rt,rb,h,mat,segments=12,parent=world,rot=[0,0,0]) => mesh(geom(`c${rt},${rb},${h},${segments}`,()=>new THREE.CylinderGeometry(rt,rb,h,segments)),mat,pos,[1,1,1],rot,parent);
  const ball = (pos,r,mat,scale=[1,1,1],parent=world) => mesh(geom('ico',()=>toCreasedNormals(new THREE.IcosahedronGeometry(1,1),Math.PI)),mat,pos,scale.map(s=>s*r),[0,0,0],parent);
  function rod(a,b,r,mat,parent=world) { const va=v(...a),vb=v(...b),d=vb.clone().sub(va); const q=new THREE.Quaternion().setFromUnitVectors(v(0,1,0),d.clone().normalize()); const e=new THREE.Euler().setFromQuaternion(q); return cylinder(va.add(vb).multiplyScalar(.5).toArray(),r,r,d.length(),mat,8,parent,e.toArray().slice(0,3)); }
  function curve(points,r,mat,parent=world) { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>v(...p))),28,r,5,false); return mesh(g,mat,[0,0,0],[1,1,1],[0,0,0],parent); }
  function textTexture(text,{bg='transparent',color='#eddfb8',size=64,width=512,height=128,font='Arial',weight=500,lines=null}={}) {
    const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');
    if(bg!=='transparent'){ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);}ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${weight} ${size}px ${font}`;
    if(lines) lines.forEach((line,i)=>ctx.fillText(line,width/2,(i+.5)*height/lines.length)); else ctx.fillText(text,width/2,height/2,width*.92);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());disposables.push(t);return t;
  }
  function label(text,pos,w,h,options={},rot=[0,0,0],parent=world) { const t=textTexture(text,options); const m=new THREE.MeshBasicMaterial({map:t,transparent:true,side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}); disposables.push(m);return mesh(geom('plane',()=>new THREE.PlaneGeometry(1,1)),m,pos,[w,h,1],rot,parent); }
  // Source-aligned, depth-tested soft halos remain visible in ECO without a global bloom boost.
  const haloCanvas=document.createElement('canvas');haloCanvas.width=haloCanvas.height=128;
  const haloCtx=haloCanvas.getContext('2d'),haloGradient=haloCtx.createRadialGradient(64,64,0,64,64,64);
  haloGradient.addColorStop(0,'rgba(255,255,255,.95)');haloGradient.addColorStop(.24,'rgba(255,255,255,.62)');haloGradient.addColorStop(.55,'rgba(255,255,255,.18)');haloGradient.addColorStop(1,'rgba(255,255,255,0)');
  haloCtx.fillStyle=haloGradient;haloCtx.fillRect(0,0,128,128);
  const haloMap=new THREE.CanvasTexture(haloCanvas);disposables.push(haloMap);
  const sourceHalos=[];
  function sourceHalo(name,pos,w,h,color,opacity,rotation=[0,0,0],parent=world){
    const mat=new THREE.MeshBasicMaterial({map:haloMap,color,transparent:true,opacity,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false});
    const halo=mesh(geom('plane',()=>new THREE.PlaneGeometry(1,1)),mat,pos,[w,h,1],rotation,parent);
    halo.name=name;halo.castShadow=false;halo.receiveShadow=false;sourceHalos.push(halo);disposables.push(mat);return halo;
  }
  function hotspot(mode,pos,size) { const g = new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({visible:false}));g.position.set(...pos);g.userData.mode=mode;world.add(g);hitboxes.push(g); }
  function plant(x,y,z,r=.3,h=.8) {
    const ph=Math.min(.38,h*.42);cylinder([x,y+ph/2,z],r*.72,r*.53,ph,'pot',20);cylinder([x,y+ph,z],r*.73,r*.73,.035,'pot',20);cylinder([x,y+ph+.01,z],r*.63,r*.63,.014,'dark');
    rod([x,y+ph,z],[x,y+ph+h*.78,z],Math.min(.021,r*.075),'wood');
    const leafG=geom('foliage-leaf',()=>new THREE.SphereGeometry(1,8,6));
    for(let i=0;i<13;i++){const a=i*2.4,level=(i%5)/5;const ly=y+ph+h*(.22+level*.64),spread=r*(1.05-level*.35),lx=x+Math.sin(a)*spread,lz=z+Math.cos(a)*spread;
      rod([x,ly-h*.12,z],[lx,ly,lz],Math.min(.008,r*.038),'greenDark');
      mesh(leafG,i%3?'green':'greenLight',[lx,ly,lz],[r*.45,h*.16,r*.09],[.5*Math.cos(a),a,.6*Math.sin(a)]);
    }
  }

  material('porcelain','#d4d8d1',{roughness:.72,metalness:0});
  material('stone','#aaa99c',{roughness:.47});
  material('graphite','#3b484d',{roughness:.46,metalness:.30});
  material('champagne','#a09b84',{roughness:.3,metalness:.62});
  material('linen','#bfb6a0',{roughness:.94});
  material('lightLine','#e9dfc7',{emissive:'#ffdcad',emissiveIntensity:1.35});
  material('coolLine','#c0d5d8',{emissive:'#acd7dd',emissiveIntensity:1.1});
  mats.floor.color.set('#d0d0c9');mats.wood.color.set('#777875');mats.woodLight.color.set('#d1d0c7');mats.pot.color.set('#dedfd9');
  mats.graphite.color.set('#252b2e');mats.dark.color.set('#181e22');mats.black.color.set('#1e2528');
  mats.stone.color.set('#d6d8d2');mats.porcelain.color.set('#edf0e9');mats.linen.color.set('#d7d8d1');
  mats.roof.color.set('#bfc5c4');mats.roof.metalness=.13;mats.roof.roughness=.7;mats.roofLine.color.set('#a6afae');
  mats.champagne.color.set('#aab3b3');mats.cream.color.set('#e3e4dc');
  // Continuous polished ground, with actual mirrored geometry and distance fade.
  const groundShader={
    uniforms:{...THREE.UniformsUtils.clone(Reflector.ReflectorShader.uniforms),time:{value:0},texel:{value:new THREE.Vector2(1/1024,1/1024)}},
    vertexShader:`uniform mat4 textureMatrix;varying vec4 vUv;varying vec3 worldPos;void main(){vUv=textureMatrix*vec4(position,1.);worldPos=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform sampler2D tDiffuse;uniform vec2 texel;uniform float time;varying vec4 vUv;varying vec3 worldPos;
    void main(){
      vec2 uv=vUv.xy/vUv.w;
      // Sample the continuous, two-pass Gaussian-filtered reflection texture.
      vec3 reflected=texture2D(tDiffuse,uv).rgb;
      float zone=1.-smoothstep(10.,25.,length(worldPos.xz));
      vec3 floorColor=vec3(.0052,.0105,.0165);
      reflected=reflected/(1.+reflected*.65);
      gl_FragColor=vec4(mix(floorColor,floorColor+reflected*.19,zone),zone);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  };
  const ground=new Reflector(new THREE.PlaneGeometry(2000,2000),{textureWidth:1024,textureHeight:1024,multisample:0,clipBias:.003,shader:groundShader});
  ground.material.transparent=true;ground.material.depthWrite=false;ground.renderOrder=-1;
  ground.rotation.x=-Math.PI/2;ground.position.y=.075;ground.name='continuous-reflective-ground';world.add(ground);
  // Separable Gaussian blur avoids repeated bright outlines from sparse wide taps.
  const blurA=new THREE.WebGLRenderTarget(512,512,{type:THREE.HalfFloatType,depthBuffer:false});
  const blurB=blurA.clone();
  const blurMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{source:{value:null},direction:{value:new THREE.Vector2()}},
    vertexShader:`varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`uniform sampler2D source;uniform vec2 direction;varying vec2 uv0;void main(){vec4 sum=vec4(0.);float weights=0.;for(int i=-12;i<=12;i++){float x=float(i);float w=exp(-x*x/32.);sum+=texture2D(source,clamp(uv0+direction*x,vec2(.001),vec2(.999)))*w;weights+=w;}gl_FragColor=sum/weights;}`});
  const blurQuad=new FullScreenQuad(blurMaterial),renderReflection=ground.onBeforeRender.bind(ground);
  const savedViewport=new THREE.Vector4(),savedScissor=new THREE.Vector4();
  ground.onBeforeRender=function(r,s,c){
    const target=r.getRenderTarget(),face=r.getActiveCubeFace(),level=r.getActiveMipmapLevel();
    const xr=r.xr.enabled,shadowUpdate=r.shadowMap.autoUpdate,scissorTest=r.getScissorTest();
    // getViewport() is the default framebuffer's logical viewport, not the active HDR target.
    r.getCurrentViewport(savedViewport);r.getScissor(savedScissor);
    try {
      renderReflection(r,s,c);r.xr.enabled=false;r.setScissorTest(false);
      blurMaterial.uniforms.source.value=ground.getRenderTarget().texture;blurMaterial.uniforms.direction.value.set(1/512,0);r.setRenderTarget(blurA);blurQuad.render(r);
      blurMaterial.uniforms.source.value=blurA.texture;blurMaterial.uniforms.direction.value.set(0,1/512);r.setRenderTarget(blurB);blurQuad.render(r);
      ground.material.uniforms.tDiffuse.value=blurB.texture;
    } finally {
      r.setRenderTarget(target,face,level);r.state.viewport(savedViewport);if(c.viewport)r.state.viewport(c.viewport);r.setScissor(savedScissor);r.setScissorTest(scissorTest);
      r.xr.enabled=xr;r.shadowMap.autoUpdate=shadowUpdate;ground.visible=true;
    }
  };
  // Refresh reflection as an explicit prepass, never inside the main scene's transparent draw list.
  const reflectionPrepass=ground.onBeforeRender.bind(ground);
  ground.onBeforeRender=()=>{};
  // Only architectural entrance steps remain; the diorama slab is removed.
  for(let i=0;i<3;i++){box([.82,.16+i*.145,1.80-i*.28],[1.86,.15,.42],'stone');box([.82,.23+i*.145,1.998-i*.28],[1.70,.018,.015],'lightLine');}

  // Single-storey atelier, recessed glass and a restrained folded-metal fascia.
  const bx=-1.45;
  material('facade','#d5d8d5',{roughness:.65,metalness:.08});
  material('plaster','#dcddd5',{roughness:.95});
  material('oak','#c9c9be',{roughness:.82});
  material('fabric','#919a98',{roughness:1});
  box([bx,.32,-1.1],[6.75,.47,4.85],'graphite');
  box([bx,.575,-1.1],[6.54,.08,4.62],'stone');
  for(let x=-4.5;x<1.7;x+=.47)box([x,.62,-1.1],[.456,.015,4.51],'oak');
  box([bx,2.02,-3.4],[6.6,2.88,.18],'plaster');
  box([-4.75,2.02,-1.1],[.18,2.88,4.75],'facade');
  box([-4.638,2.03,-1.2],[.025,2.68,4.24],'plaster');
  for(let x of [-4.63,-2.95,.12,1.80])box([x,2.0,1.29],[.055,2.79,.07],'graphite');
  for(let y of [.67,3.34])box([bx,y,1.28],[6.51,.052,.085],'champagne');
  for(let [x,w] of [[-3.78,1.62],[-1.41,2.97]])box([x,2.0,1.283],[w,2.64,.012],'glass');
  // Clear glass entrance leaf, with a slender black perimeter and metal pull.
  box([.90,2.0,1.355],[1.43,2.66,.019],'glass');
  for(let x of [.17,1.66])box([x,2.0,1.37],[.045,2.76,.052],'graphite');
  for(let y of [.64,3.36])box([.915,y,1.37],[1.53,.045,.052],'graphite');
  for(let y of [1.12,2.82])box([1.635,y,1.398],[.046,.11,.027],'metal');
  rod([.35,1.47,1.43],[.35,1.99,1.43],.022,'metal');
  label('01',[1.19,2.60,1.40],.32,.32,{size:72,color:'#d9d4bd'});
  label('FOUR DESIGN',[.89,1.05,1.40],.67,.095,{size:42,color:'#aeb5b1'});
  for(let z of [-3.32,-1.54,.12,1.28])box([1.82,2.0,z],[.078,2.79,.066],'facade');
  box([1.81,2.0,-1.03],[.012,2.65,4.45],'glass');
  for(let y of [.68,3.33])box([1.83,y,-1.03],[.065,.055,4.59],'champagne');
  // One flat roof only. Shallow parapet, raised skylight, seams and drain.
  box([bx,3.48,-1.1],[7.04,.25,5.19],'facade');
  box([bx,3.35,1.535],[7.08,.34,.14],'graphite');
  box([bx,3.535,1.612],[7.08,.022,.018],'lightLine');
  box([2.08,3.535,-1.05],[.018,.022,5.24],'lightLine');
  box([bx,3.63,-1.1],[6.88,.07,5.02],'roof');
  for(let x of [-4.94,2.04])box([x,3.71,-1.1],[.075,.16,5.07],'facade');
  box([bx,3.71,-3.61],[7.04,.16,.075],'facade');
  for(let x=-4.6;x<2;x+=.82)box([x,3.669,-1.1],[.012,.009,4.95],'roofLine');
  box([-1.8,3.83,-1.8],[2.76,.31,1.30],'facade');
  box([-1.8,4.001,-1.8],[2.60,.017,1.16],'cyan');
  for(let x of [-3.08,-2.24,-1.40,-.52])box([x,4.025,-1.8],[.045,.026,1.23],'graphite');
  for(let z of [-2.42,-1.18])box([-1.8,4.025,z],[2.68,.026,.042],'graphite');
  for(let i=0;i<6;i++)box([-.395,3.81+i*.022,-1.80],[.014,.012,.77],'metal');
  cylinder([1.15,3.93,-2.77],.09,.12,.53,'metal');cylinder([1.15,4.22,-2.77],.20,.20,.08,'graphite');
  curve([[2.02,3.64,-3.35],[2.10,3.42,-3.35],[2.10,.37,-3.35],[2.30,.15,-3.35]],.044,'metal');
  for(let y of [.74,2.0,3.10])box([2.1,y,-3.35],[.12,.032,.14],'champagne');
  // Branded dark fascia and warm recessed soffit, matching the supplied reference.
  label('D E S I G N   S T U D I O',[-1.89,3.34,1.613],3.20,.21,{size:45,color:'#e8e5d5',width:1024});
  label('IDEAS  /  DIGITAL  /  FORM',[.93,3.31,1.614],1.46,.10,{size:35,color:'#bcc7c5',width:1024});
  const logoMaterial=new THREE.MeshBasicMaterial({color:'#e8e2d0',transparent:true,depthWrite:false,toneMapped:false});
  mesh(new THREE.PlaneGeometry(.62,.18),logoMaterial,[-4.14,3.34,1.615]);
  const logoReady=new Promise(resolve=>new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}logo.svg`,t=>{t.colorSpace=THREE.SRGBColorSpace;logoMaterial.map=t;logoMaterial.needsUpdate=true;disposables.push(t);resolve();},undefined,()=>resolve()));
  box([-1.62,3.16,1.15],[5.46,.021,.036],'lightLine');
  box([1.62,3.16,-1.08],[.033,.021,4.4],'lightLine');
  for(let z of [-2.48,.63]){box([1.99,2.80,z],[.18,.31,.12],'graphite');box([2.087,2.80,z],[.018,.20,.083],'lightLine');}


  // Interior rebuilt as three zones: material library, working table, quiet lounge.
  for(let x of [-4.45,-3.61,-2.77])box([x,1.97,-3.03],[.052,2.66,.52],'oak');
  for(let y of [.72,1.30,1.92,2.55,3.27])box([-3.61,y,-3.03],[1.76,.055,.55],'oak');
  for(let row=0;row<4;row++)for(let i=0;i<12;i++){
    if((row===1&&i>8)||(row===3&&i<4))continue;
    const h=.24+(i%4)*.042,x=-4.33+i*.127,y=.76+row*.62;
    box([x,y+h/2,-3.02],[.088,h,.29],['paper','wood','cream','facade','red'][i%5],[0,0,i%5===0?.1:0]);
    box([x,y+h*.65,-2.865],[.052,.014,.003],'champagne');
  }
  for(let y of [1.27,2.51])box([-3.6,y,-2.76],[1.62,.018,.018],'lightLine');
  cylinder([-3.04,1.52,-3.00],.12,.08,.31,'cream');
  // Wide back-wall whiteboard with actual miniature layout studies and pinned sheets.
  box([-.65,2.30,-3.255],[3.72,1.57,.05],'metal');
  box([-.65,2.30,-3.217],[3.61,1.47,.016],'white');
  function designSheet(index,x,y,w=.55,h=.69){
    const c=document.createElement('canvas');c.width=256;c.height=340;const q=c.getContext('2d');
    q.fillStyle=index%3===0?'#ded7c7':'#eeeadf';q.fillRect(0,0,256,340);
    q.fillStyle='#4b5656';q.font='13px Arial';q.fillText(['FORM STUDY','VISUAL SYSTEM','SPACE / 04','TYPE / GRID'][index%4],22,28);
    q.strokeStyle='#7d8680';q.lineWidth=2;
    if(index%3===0){q.strokeRect(23,60,210,171);for(let i=1;i<4;i++){q.beginPath();q.moveTo(23+i*52,60);q.lineTo(23+i*52,231);q.stroke();}q.fillStyle='#ab8b73';q.fillRect(32,70,86,70);q.fillStyle='#425860';q.fillRect(137,159,86,60);}
    else if(index%3===1){q.fillStyle='#35484b';q.font='72px Georgia';q.fillText('Aa',24,134);q.font='26px Arial';q.fillText('four / form',24,195);for(let i=0;i<4;i++){q.fillStyle=['#334c54','#a77861','#b7b6a4','#d3c5ad'][i];q.fillRect(24+i*54,224,44,34);}}
    else {for(let i=0;i<3;i++){q.beginPath();q.ellipse(127,120+i*28,74-i*10,42,0,0,6.29);q.stroke();}q.beginPath();q.moveTo(37,206);q.lineTo(127,62);q.lineTo(213,206);q.stroke();}
    q.fillStyle='#969a91';for(let i=0;i<4;i++)q.fillRect(24,281+i*9,170-(i%2)*41,3);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;disposables.push(t);
    const m=new THREE.MeshBasicMaterial({map:t,toneMapped:false});disposables.push(m);
    mesh(new THREE.PlaneGeometry(w,h),m,[x,y,-3.197],[1,1,1],[0,0,(index%3-1)*.04]);
    box([x,y+h*.49,-3.18],[.14,.043,.008],'paper');
  }
  for(let i=0;i<5;i++)designSheet(i,-2.04+i*.70,2.52,.56,.74);
  for(let i=0;i<5;i++)designSheet(i+5,-2.04+i*.70,1.86,.49,.43);
  box([-.65,1.53,-3.16],[3.64,.045,.14],'metal');
  for(let i=0;i<3;i++)rod([.29+i*.15,1.56,-3.12],[.39+i*.15,1.56,-3.12],.016,['red','dark','cyan'][i]);
  // Shallow storage below the whiteboard, with a printer and material trays.
  for(let x of [-1.91,-.84,.23,1.20]){box([x,1.01,-2.94],[1.00,.74,.58],'oak');box([x,1.01,-2.625],[.94,.67,.028],'linen');rod([x-.13,1.20,-2.60],[x+.13,1.20,-2.60],.012,'metal');}
  box([-.37,1.41,-2.94],[4.1,.056,.69],'stone');
  box([1.17,1.57,-2.95],[.63,.27,.42],'cream');box([1.17,1.57,-2.729],[.49,.044,.011],'dark');
  for(let i=0;i<4;i++)box([.31,1.46+i*.035,-2.95],[.55,.028,.40],i%2?'paper':'oak');
  // One broad pale desk with slender metal trestles.
  box([-1.12,1.43,-.39],[3.20,.085,1.10],'oak');
  for(let x of [-2.51,.25])for(let z of [-.79,.02])box([x,1.02,z],[.052,.78,.052],'graphite');
  for(let x of [-2.51,.25])rod([x,.69,-.82],[x,.69,.05],.025,'metal');
  box([-2.15,1.08,-.63],[.46,.57,.58],'linen');
  for(let y of [.87,1.07,1.27]){box([-2.15,y,-.329],[.42,.16,.017],'oak');rod([-2.26,y+.03,-.313],[-2.04,y+.03,-.313],.01,'metal');}
  // Laptop screen stays at the existing focus landmark; enlarged just enough to read.
  box([-.95,1.49,-.32],[1.00,.035,.62],'metal');
  box([-.95,1.515,-.40],[.81,.009,.29],'dark');
  for(let r=0;r<4;r++)for(let i=0;i<11;i++)box([-1.32+i*.073,1.523,-.505+r*.061],[.054,.006,.043],'metal');
  box([-.95,1.523,-.11],[.29,.006,.12],'graphite');
  const laptopLid=new THREE.Group();laptopLid.position.set(-.95,1.50,-.63);laptopLid.rotation.x=-.12;moving.add(laptopLid);
  box([0,.32,0],[1.01,.64,.032],'metal',[0,0,0],laptopLid);
  const laptopScreen=label('',[0,.32,.021],.935,.56,{bg:'#152e34',width:1024,height:640},[0,0,0],laptopLid);
  const screenCanvas=document.createElement('canvas');screenCanvas.width=1024;screenCanvas.height=640;const sc=screenCanvas.getContext('2d');
  sc.fillStyle='#142127';sc.fillRect(0,0,1024,640);sc.textAlign='center';sc.textBaseline='middle';
  sc.fillStyle='#f0e4cb';sc.font='54px Arial';sc.fillText('Thanks For Watching',512,285);
  sc.fillStyle='#bdc9c3';sc.font='26px Arial';sc.fillText('four Design',512,369);sc.fillRect(484,421,56,1);
  const screenTexture=new THREE.CanvasTexture(screenCanvas);screenTexture.colorSpace=THREE.SRGBColorSpace;laptopScreen.material.map=screenTexture;disposables.push(screenTexture);
  // Articulated desk lamp, pen cup, notebook, coffee and cable routing.
  cylinder([-2.33,1.50,-.69],.13,.15,.035,'metal');rod([-2.33,1.53,-.69],[-2.34,1.97,-.65],.018,'metal');rod([-2.34,1.97,-.65],[-2.05,2.13,-.63],.017,'metal');
  cylinder([-2.04,2.06,-.63],.04,.14,.14,'graphite');cylinder([-2.04,1.985,-.63],.12,.12,.01,'lightLine');
  const deskLight=new THREE.PointLight('#ffe1b3',2.5,3,2);deskLight.position.set(-2.04,1.96,-.55);world.add(deskLight);
  // Hollow ceramic cup; its C-shaped handle lies in XY and enters the wall at both ends.
  const cup=new THREE.Group();cup.name='ceramic-cup-with-attached-handle';cup.position.set(-.17,1.52,-.13);world.add(cup);
  const cupProfile=[[0,0],[.050,0],[.057,.009],[.071,.172],[.072,.180],[.064,.180],[.063,.170],[.050,.018],[0,.018]].map(p=>new THREE.Vector2(...p));
  mesh(new THREE.LatheGeometry(cupProfile,32),'cream',[0,0,0],[1,1,1],[0,0,0],cup);
  const cupHandle=new THREE.CubicBezierCurve3(v(.060,.146,0),v(.157,.173,0),v(.149,.028,0),v(.055,.043,0));
  mesh(new THREE.TubeGeometry(cupHandle,32,.010,10,false),'cream',[0,0,0],[1,1,1],[0,0,0],cup).name='cup-handle-connected-at-two-ends';
  material('coffee','#352a22',{roughness:.30});
  mesh(new THREE.CircleGeometry(.061,32),'coffee',[0,.154,0],[1,1,1],[-Math.PI/2,0,0],cup);
  for(let i=0;i<3;i++)box([-1.86,1.495+i*.019,-.10],[.37,.015,.27],i%2?'paper':'facade',[0,-.14,0]);
  rod([-1.99,1.55,-.10],[-1.77,1.55,.005],.008,'metal');
  cylinder([.14,1.57,-.74],.055,.055,.18,'metal');for(let i=0;i<5;i++)rod([.11+(i%3)*.025,1.58,-.74],[.10+(i%3)*.03,1.79+i*.016,-.73],.008,i%2?'wood':'dark');
  curve([[-1.42,1.49,-.54],[-1.69,1.43,-.80],[-1.70,.86,-.80],[-2.31,.67,-.72]],.008,'dark');
  // Chair on the glass side, parked left of the laptop rather than across its sightline.
  const chair=new THREE.Group();chair.position.set(-2.12,.63,.63);chair.rotation.y=-.32;world.add(chair);
  box([0,.47,0],[.54,.10,.51],'fabric',[0,0,0],chair);
  box([0,.81,.225],[.55,.52,.065],'fabric',[-.12,0,0],chair);
  for(let x of [-.30,.30]){rod([x,.48,-.1],[x,.71,-.1],.018,'metal',chair);box([x,.73,.03],[.07,.04,.34],'dark',[0,0,0],chair);}
  cylinder([0,.29,0],.027,.043,.34,'metal',12,chair);
  for(let i=0;i<5;i++){const a=i*1.257;rod([0,.13,0],[Math.sin(a)*.34,.08,Math.cos(a)*.34],.019,'metal',chair);ball([Math.sin(a)*.34,.064,Math.cos(a)*.34],.045,'dark',[1,1,1],chair);}
  // Low two-seat sofa against the left wall, rounded cushions, throw and coffee table.
  box([-4.09,.89,-1.02],[.77,.26,1.74],'fabric');box([-4.43,1.15,-1.02],[.18,.65,1.85],'fabric');
  for(let z of [-1.85,-.20])box([-4.07,1.10,z],[.76,.40,.15],'linen');
  for(let z of [-1.43,-.61]){box([-4.03,1.057,z],[.61,.10,.73],'linen');box([-4.30,1.36,z],[.16,.35,.58],'linen',[0,0,-.12]);}
  box([-3.99,1.127,-1.47],[.53,.03,.39],'paper',[0,.04,0]);
  cylinder([-3.10,1.00,-1.38],.37,.37,.057,'oak',32);for(let a of [0,2.094,4.189])rod([-3.10+Math.sin(a)*.21,.66,-1.38+Math.cos(a)*.21],[-3.10+Math.sin(a)*.16,.97,-1.38+Math.cos(a)*.16],.019,'graphite');
  box([-3.13,1.04,-1.4],[.24,.023,.29],'paper',[0,.14,0]);cylinder([-2.93,1.10,-1.29],.05,.04,.13,'cream');
  plant(-4.15,.64,.63,.24,1.45);plant(1.23,.64,-2.2,.27,1.50);plant(.11,1.47,-2.90,.095,.32);
  // Small exhibition plinth with an abstract folded-paper sculpture.
  box([.74,.92,-.66],[.43,.58,.43],'stone');
  mesh(new THREE.TorusKnotGeometry(.16,.045,48,8),'cream',[.74,1.48,-.66],[.8,1.35,.8]);
  label('FORM 04',[.74,1.14,-.439],.25,.058,{size:35,color:'#394d50'});
  for(let z of [-2.45,-.59])box([-.93,3.22,z],[3.2,.034,.04],'lightLine');
  const interiorLight=new THREE.PointLight('#ffe0b7',17,9,2);interiorLight.position.set(-1.45,2.8,-.70);world.add(interiorLight);
  plant(2.19,.075,-.28,.23,1.1);
  hotspot('studio',[-1.45,1.96,-.85],[6.85,3.85,5.06]);

  // Detached glass telephone pavilion, with champagne reveals and luminous edges.
  const phone=new THREE.Group();phone.name='studio-side-phone-booth';phone.position.set(LANDMARKS.phone.position[0],.08,LANDMARKS.phone.position[2]);phone.rotation.y=LANDMARKS.phone.yaw;moving.add(phone);
  box([0,.11,0],[1.42,.22,1.42],'graphite',[0,0,0],phone);
  box([0,.238,0],[1.22,.035,1.22],'stone',[0,0,0],phone);
  for(let x of [-.62,.62])for(let z of [-.60,.60]){
    box([x,1.54,z],[.073,2.66,.073],'porcelain',[0,0,0],phone);
    box([x,1.56,z+.043],[.016,2.58,.013],'lightLine',[0,0,0],phone);
  }
  box([0,1.53,-.59],[1.15,2.60,.048],'graphite',[0,0,0],phone);
  for(let x of [-.62,.62]){
    box([x,1.54,0],[.014,2.56,1.13],'glass',[0,0,0],phone);
    box([x,1.1,0],[.038,.035,1.19],'champagne',[0,0,0],phone);
    box([x,1.54,-.13],[.035,2.57,.035],'champagne',[0,0,0],phone);
  }
  box([0,2.97,0],[1.58,.20,1.58],'porcelain',[0,0,0],phone);
  box([0,2.96,.799],[1.43,.135,.016],'graphite',[0,0,0],phone);
  box([0,3.08,0],[1.45,.035,1.45],'metal',[0,0,0],phone);
  for(let y of [.25,2.84])box([0,y,.648],[1.20,.019,.014],'lightLine',[0,0,0],phone);
  label('F O U R   /   C A L L',[0,2.96,.813],1.25,.093,{color:'#d9d6c4',size:48,width:1024},[0,0,0],phone);
  box([0,2.80,0],[1.10,.015,1.10],'lightLine',[0,0,0],phone);
  const phoneDoor=new THREE.Group();phoneDoor.position.set(-.59,.24,.63);phone.add(phoneDoor);
  for(let x of [0,1.18])box([x,1.28,0],[.046,2.56,.043],'champagne',[0,0,0],phoneDoor);
  for(let y of [0,2.56])box([.59,y,0],[1.18,.039,.043],'champagne',[0,0,0],phoneDoor);
  box([.59,1.28,0],[1.10,2.50,.012],'glass',[0,0,0],phoneDoor);
  rod([1.045,.98,.06],[1.045,1.47,.06],.016,'champagne',phoneDoor);
  box([0,1.84,-.44],[.66,.92,.19],'metal',[0,0,0],phone);
  box([.1,2.1,-.33],[.37,.17,.02],'dark',[0,0,0],phone);
  label('HELLO FOUR',[.1,2.10,-.313],.33,.10,{size:36,color:'#a6d1a1',width:512},[0,0,0],phone);
  const keyMat=new THREE.MeshStandardMaterial({color:'#c6d4b3',emissive:'#cfe8a8',emissiveIntensity:.0,roughness:.35});
  for(let row=0;row<4;row++)for(let col=0;col<3;col++){box([-.015+col*.10,1.88-row*.095,-.323],[.077,.065,.037],keyMat,[0,0,0],phone);label(String(row*3+col+1),[-.015+col*.1,1.88-row*.095,-.3],.036,.038,{size:55,color:'#263c38',width:64,height:64},[0,0,0],phone);}
  box([-.245,1.95,-.295],[.115,.44,.125],'dark',[0,0,.08],phone);box([-.235,2.16,-.285],[.18,.13,.17],'dark',[0,0,0],phone);box([-.257,1.73,-.285],[.18,.13,.17],'dark',[0,0,0],phone);
  const cordPoints=[];for(let i=0;i<=70;i++){const t=i/70;cordPoints.push([-.245+.025*Math.sin(t*70),1.71-t*.39,-.28+.025*Math.cos(t*70)]);}curve(cordPoints,.008,'black',phone);
  box([0,1.25,-.40],[.82,.045,.33],'champagne',[0,0,0],phone);
  const phoneLight=new THREE.PointLight('#ffcc8f',1.5,3.5,2);phoneLight.position.set(0,2.68,.1);phone.add(phoneLight);
  hotspot('phone',LANDMARKS.phone.position,[1.95,3.35,1.95]);

  // Smooth only these curved surfaces; keep architectural and foliage materials untouched.
  mats.mailEnamel=mats.porcelain.clone();mats.mailEnamel.flatShading=false;
  mats.mailMetal=mats.graphite.clone();mats.mailMetal.flatShading=false;
  material('bumperTrim','#252b2e',{roughness:.46,metalness:.30,flatShading:false});
  // Arched mailbox: one slender iron post, curved metal body and opening face.
  const mail=new THREE.Group();mail.name='entrance-left-mailbox';mail.position.set(LANDMARKS.mail.position[0],.08,LANDMARKS.mail.position[2]);mail.rotation.y=LANDMARKS.mail.yaw;moving.add(mail);
  cylinder([0,.64,0],.045,.055,1.19,'metal',12,mail);cylinder([0,.05,0],.18,.2,.09,'dark',16,mail);
  box([0,1.25,0],[.73,.055,.9],'graphite',[0,0,0],mail);
  function archShape(w,h) {const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h-w/2);s.absarc(0,h-w/2,w/2,0,Math.PI,false);s.lineTo(-w/2,0);return s;}
  const outer=archShape(.76,.74),hole=archShape(.69,.67);outer.holes.push(new THREE.Path(hole.getPoints(30).reverse()));
  const shellG=new THREE.ExtrudeGeometry(outer,{depth:.89,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:2,steps:1});
  toCreasedNormals(shellG,Math.PI/3);
  mesh(shellG,'mailEnamel',[0,1.26,-.46],[1,1,1],[0,0,0],mail);
  mesh(new THREE.ShapeGeometry(archShape(.74,.73)),'graphite',[0,1.26,-.45],[1,1,1],[0,0,0],mail);
  const mailDoor=new THREE.Group();mailDoor.position.set(0,1.265,.451);mail.add(mailDoor);
  const mailDoorGeometry=new THREE.ExtrudeGeometry(archShape(.735,.715),{depth:.028,bevelEnabled:true,bevelThickness:.008,bevelSize:.009,bevelSegments:2});
  toCreasedNormals(mailDoorGeometry,Math.PI/3);
  mesh(mailDoorGeometry,'mailMetal',[0,0,0],[1,1,1],[0,0,0],mailDoor);
  box([0,.385,.037],[.41,.075,.025],'dark',[0,0,0],mailDoor);box([0,.44,.053],[.45,.027,.045],'brass',[0,0,0],mailDoor);
  label('LETTERS',[0,.2,.048],.47,.095,{size:46,color:'#ead6ac',width:512},[0,0,0],mailDoor);
  cylinder([0,.59,.06],.033,.033,.024,'brass',12,mailDoor,[Math.PI/2,0,0]);
  const mailRimPoints=archShape(.755,.735).getPoints(40).map(p=>[p.x,p.y+.003,.046]);mailRimPoints.push(mailRimPoints[0]);curve(mailRimPoints,.009,'lightLine',mailDoor);
  box([0,1.26,.48],[.64,.016,.019],'lightLine',[0,0,0],mail);
  box([.019,.71,.048],[.016,.92,.012],'coolLine',[0,0,0],mail);
  cylinder([.389,1.55,-.26],.033,.033,.009,'coolLine',16,mail,[0,0,Math.PI/2]);
  label('FOUR',[.39,1.60,-.04],.56,.18,{size:60,color:'#e4c6a4'},[0,Math.PI/2,0],mail);
  material('envelopeFlap','#e9dbb8',{roughness:.94,side:THREE.DoubleSide});
  material('waxSeal','#9f433d',{roughness:.42,metalness:.06});
  material('waxStamp','#72302e',{roughness:.68});
  for(let i=0;i<5;i++) {
    const env=new THREE.Group();env.name='v-flap-envelope';mail.add(env);
    box([0,0,0],[.46,.31,.014],'paper',[0,0,0],env);
    const flap=new THREE.Shape();flap.moveTo(-.222,.148);flap.lineTo(.222,.148);flap.lineTo(0,-.039);flap.closePath();
    const flapMesh=mesh(new THREE.ShapeGeometry(flap),'envelopeFlap',[0,0,.0085],[1,1,1],[0,0,0],env);flapMesh.castShadow=false;flapMesh.receiveShadow=false;
    const sealCanvas=document.createElement('canvas');sealCanvas.width=920;sealCanvas.height=620;
    const sealCtx=sealCanvas.getContext('2d');sealCtx.strokeStyle='rgba(112,91,60,.56)';sealCtx.lineWidth=3.2;
    sealCtx.lineJoin='round';sealCtx.lineCap='round';sealCtx.beginPath();sealCtx.moveTo(16,14);sealCtx.lineTo(460,388);sealCtx.lineTo(904,14);sealCtx.stroke();
    sealCtx.strokeStyle='rgba(123,107,76,.22)';sealCtx.lineWidth=1.8;sealCtx.beginPath();sealCtx.moveTo(16,600);sealCtx.lineTo(330,340);sealCtx.moveTo(904,600);sealCtx.lineTo(590,340);sealCtx.stroke();
    const sealTexture=new THREE.CanvasTexture(sealCanvas);sealTexture.colorSpace=THREE.SRGBColorSpace;
    const sealMaterial=new THREE.MeshBasicMaterial({map:sealTexture,transparent:true,depthWrite:false,side:THREE.DoubleSide});disposables.push(sealTexture,sealMaterial);
    const sealMesh=mesh(new THREE.PlaneGeometry(.46,.31),sealMaterial,[0,0,.010],[1,1,1],[0,0,0],env);sealMesh.castShadow=false;sealMesh.receiveShadow=false;
    // Thin, irregular wax disk straddles the V tip; recessed stamp stays inside the raised lip.
    const waxShape=new THREE.Shape();
    for(let k=0;k<48;k++){const a=k/48*Math.PI*2,r=.037*(1+.045*Math.sin(a*5)+.025*Math.cos(a*7));k?waxShape.lineTo(Math.cos(a)*r,Math.sin(a)*r):waxShape.moveTo(r,0);}waxShape.closePath();
    const waxGeometry=new THREE.ExtrudeGeometry(waxShape,{depth:.003,bevelEnabled:true,bevelThickness:.0015,bevelSize:.0018,bevelSegments:2,curveSegments:12});
    toCreasedNormals(waxGeometry,Math.PI/3);
    mesh(waxGeometry,'waxSeal',[0,-.035,.011],[1,1,1],[0,0,i*.31],env).name='wax-seal-at-v-tip';
    mesh(new THREE.TorusGeometry(.026,.0016,8,32),'waxSeal',[0,-.035,.016],[1,1,1],[0,0,0],env);
    const stamp=label('F',[0,-.035,.0162],.028,.033,{font:'Georgia',weight:600,size:72,color:'#64302d',width:128,height:128},[0,0,0],env);stamp.material.toneMapped=true;
    env.visible=false;letters.push(env);
  }
  hotspot('mail',[LANDMARKS.mail.position[0],1.4,LANDMARKS.mail.position[2]],[1.50,2.8,1.50]);

  // Courtyard lighting: warm downlights, visible but very restrained rain-lit cones.
  const streetLamps=[];
  // The arm points toward the right-side phone booth; its light also reaches the entrance side.
  const lampX=5.3,lampZ=1.9,lampYaw=Math.atan2(LANDMARKS.phone.position[2]-lampZ,LANDMARKS.phone.position[0]-lampX);
  for(const [x,z,h,yaw] of [[lampX,lampZ,4.55,lampYaw]]){
    // Keep pole geometry out of architecture batches so its cast-shadow flag survives merging.
    const pole=new THREE.Group();pole.name=x>0?'right-street-lamp':'left-street-lamp';pole.userData.anchor=[x,0,z];world.add(pole);
    cylinder([x,.20,z],.12,.16,.25,'graphite',12,pole);cylinder([x,h/2,z],.039,.061,h,'graphite',12,pole);
    const dx=Math.cos(yaw)*.63,dz=Math.sin(yaw)*.63;
    rod([x,h-.08,z],[x+dx,h-.08,z+dz],.034,'metal',pole);
    box([x+dx,h-.10,z+dz],[.48,.09,.20],'graphite',[0,-yaw,0],pole);
    box([x+dx,h-.152,z+dz],[.38,.012,.14],'lightLine',[0,-yaw,0],pole);
    pole.userData.yaw=yaw;
    const light=new THREE.SpotLight('#ffdda9',36,9,.66,.9,1.7);light.name='phone-side-street-light';light.position.set(x+dx,h-.2,z+dz);light.target.position.set(LANDMARKS.phone.position[0],.08,LANDMARKS.phone.position[2]+.4);world.add(light,light.target);
    streetLamps.push({x:x+dx,y:h-.172,z:z+dz,anchor:[x,0,z],yaw,target:light.target.position.toArray(),light});
    // Clamp pow bases: UV/sin endpoint roundoff can produce negative inputs and NaN in reflected HDR.
    const beamMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{strength:{value:.032}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform float strength;varying vec2 vUv;void main(){float edge=pow(max(0.,sin(clamp(vUv.x,0.,1.)*3.14159265)),3.);float a=edge*pow(clamp(vUv.y,0.,1.),.8)*(1.-smoothstep(.88,1.,vUv.y))*strength;gl_FragColor=vec4(1.,.78,.48,a);}`});
    const beamAxis=light.position.clone().sub(light.target.position),beamCenter=light.position.clone().add(light.target.position).multiplyScalar(.5);
    const beam=mesh(new THREE.ConeGeometry(1.75,beamAxis.length(),32,1,true),beamMat,beamCenter.toArray());beam.name='phone-side-street-light-cone';beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),beamAxis.normalize());
  }
  // Umbrellas tucked against the side wall, entirely outside the entrance steps.
  const umbrellaX=2.20,umbrellaZ=.72;
  const umbrellaHolder=new THREE.Group();umbrellaHolder.name='open-hollow-umbrella-holder';umbrellaHolder.position.set(umbrellaX,.075,umbrellaZ);world.add(umbrellaHolder);
  const holderProfile=[[0,0],[.132,0],[.141,.025],[.160,.44],[.138,.44],[.121,.035],[0,.035]].map(p=>new THREE.Vector2(...p));
  mesh(new THREE.LatheGeometry(holderProfile,48),'porcelain',[0,0,0],[1,1,1],[0,0,0],umbrellaHolder);
  cylinder([0,.038,0],.119,.119,.008,'dark',32,umbrellaHolder);
  mesh(new THREE.TorusGeometry(.149,.007,8,48),'metal',[0,.44,0],[1,1,1],[Math.PI/2,0,0],umbrellaHolder);
  for(let i=0;i<3;i++){const x=umbrellaX-.07+i*.065;rod([x,.23,umbrellaZ],[x,1.02,umbrellaZ],.014,'graphite');curve([[x,1.02,umbrellaZ],[x,1.12,umbrellaZ],[x+.04,1.13,umbrellaZ],[x+.07,1.05,umbrellaZ]],.014,'metal');}
  box([-4.02,.27,1.75],[.45,.37,.35],'wood');box([-4.02,.46,1.75],[.07,.013,.36],'paper');label('FOUR',[-4.02,.30,1.931],.23,.085,{size:45,color:'#324348'});
  // Small courtyard trees and curated planting.
  function tree(x,z,h=3.3) {cylinder([x,.39,z],.40,.32,.62,'wallDark',16);cylinder([x,1.28,z],.045,.086,2.1,'wood');
    for(let i=0;i<38;i++){const a=i*2.399,r=.22+(i%6)*.105,y=1.72+(i%8)*.13;const px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;ball([px,y*h/3.3,pz],.21,i%3===0?'greenLight':i%3===1?'green':'greenDark',[1.3,.7,1]);if(i%6===0)rod([x,1.25,z],[px,y*h/3.3,pz],.023,'wood');}
  }
  tree(-6.35,-.80,3.4);tree(2.76,-4.31,3.6);
  box([-3.1,.59,-4.44],[2.45,.56,.60],'wallDark');
  for(let i=0;i<8;i++)ball([-4.15+i*.30,.97+(i%3)*.09,-4.46],.35,i%2?'green':'greenDark',[1,.95,.85]);
  // Monolithic outdoor bench and sparse flush light markers.
  box([-2.7,.54,2.26],[2.25,.11,.49],'stone');
  for(let x of [-3.54,-1.86])box([x,.30,2.26],[.075,.39,.35],'graphite');
  for(let [x,z] of [[-.48,2.12],[2.12,2.12]]){
    box([x,.37,z],[.065,.59,.065],'graphite');box([x,.61,z+.038],[.025,.09,.01],'lightLine');
  }

  // Soft painted pools of reflected light. Broken highlights keep asphalt from looking like a mirror.
  const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=128;const gc=glowCanvas.getContext('2d'),gr=gc.createRadialGradient(64,64,2,64,64,64);gr.addColorStop(0,'rgba(255,255,255,.8)');gr.addColorStop(.35,'rgba(255,255,255,.36)');gr.addColorStop(1,'rgba(255,255,255,0)');gc.fillStyle=gr;gc.fillRect(0,0,128,128);const glowMap=new THREE.CanvasTexture(glowCanvas);disposables.push(glowMap);
  function glow(x,z,w,d,color,opacity=.3,y=.079){const mat=new THREE.MeshBasicMaterial({map:glowMap,color,transparent:true,opacity,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});disposables.push(mat);return mesh(new THREE.PlaneGeometry(w,d),mat,[x,y,z],[1,1,1],[-Math.PI/2,0,0]);}
  glow(-1.35,2.0,6.2,2.2,'#d5b78d',.055);glow(LANDMARKS.phone.position[0],LANDMARKS.phone.position[2],2.1,2.2,'#e0bc94',.065);glow(LANDMARKS.mail.position[0],LANDMARKS.mail.position[2],1.7,1.7,'#c5d5d7',.04);
  const rng=(i)=>{const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);};
  for(const lamp of streetLamps)glow(lamp.target[0],lamp.target[2],4.7,4.7,'#e9c194',.14);
  const puddles=[[-3.9,2.95,1.45,.64],[-.45,2.08,.91,.46],[2.45,3.40,.75,.47],[4.48,4.70,1.35,.74],[-5.62,.09,.84,.56],[6.54,1.68,.9,.57]];
  const puddleMaterial=new THREE.MeshBasicMaterial({color:'#7b9699',transparent:true,opacity:.055,depthWrite:false});
  for(const [x,z,sx,sz] of puddles){
    const s=new THREE.Shape();for(let i=0;i<48;i++){const a=i/48*Math.PI*2,r=1+Math.sin(a*5+.4)*.10+Math.cos(a*7)*.045;const px=Math.cos(a)*r*sx,py=Math.sin(a)*r*sz;i?s.lineTo(px,py):s.moveTo(px,py);}s.closePath();
    mesh(new THREE.ShapeGeometry(s),puddleMaterial,[x,.083,z],[1,1,1],[-Math.PI/2,0,0]);
  }
  // Sparse local double-crested waves. Derivative-softened bands survive the overview/FXAA.
  // One impact expands for 1.65s, then rests; no continuous carpet of repeating circles.
  for(let i=0;i<18;i++){
    const p=puddles[i%puddles.length],mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,toneMapped:false,side:THREE.DoubleSide,
      uniforms:{waveOpacity:{value:0}},
      vertexShader:`varying vec2 waveUv;void main(){waveUv=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform float waveOpacity;varying vec2 waveUv;void main(){float radius=length(waveUv);float aa=max(fwidth(radius),.018);float outer=1.-smoothstep(.030,.030+aa,abs(radius-.88));float inner=1.-smoothstep(.024,.024+aa,abs(radius-.63));float alpha=(outer+inner*.46)*waveOpacity;gl_FragColor=vec4(.56,.70,.73,alpha);}`});
    disposables.push(mat);
    const r=mesh(new THREE.PlaneGeometry(2,2),mat,[0,.094,0],[1,1,1],[-Math.PI/2,0,0],moving);
    r.name='local-puddle-rain-impact';r.visible=false;r.castShadow=false;r.receiveShadow=false;
    ripples.push({mesh:r,phase:rng(i+90),period:4.2+rng(i+512)*2.8,puddle:p,cycle:-1,x:0,z:0});
  }
  // Discrete fallen leaves and flush drain slots, without a street or raised base.
  for(let i=0;i<24;i++){const x=-5.7+rng(i+193)*12,z=1.85+rng(i+813)*3.8;mesh(new THREE.CircleGeometry(.046,5),i%3?'wood':'greenDark',[x,.091,z],[1,.49,1],[-Math.PI/2,0,i]);}
  for(let i=0;i<22;i++)box([-4.50+i*.27,.09,1.80],[.11,.012,.035],'graphite');
  // Instanced soft ribbons: 1px GL lines disappeared after FXAA and overview downscaling.
  // Keep a modest CSS-pixel width, world-space length and depth-tested architectural occlusion.
  const count=180,rainOrigins=new Float32Array(count*3),rainSeeds=new Float32Array(count);
  for(let i=0;i<count;i++){rainOrigins.set([(rng(i+300)-.5)*19,rng(i+5700)*10,(rng(i+2600)-.5)*16],i*3);rainSeeds[i]=rng(i+7900);}
  const rainG=new THREE.InstancedBufferGeometry();
  rainG.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,-1,1,0,1,1,0],3));rainG.setIndex([0,2,1,2,3,1]);
  rainG.setAttribute('rainOrigin',new THREE.InstancedBufferAttribute(rainOrigins,3));rainG.setAttribute('seed',new THREE.InstancedBufferAttribute(rainSeeds,1));rainG.instanceCount=count;
  const rainMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,toneMapped:false,side:THREE.DoubleSide,
    uniforms:{time:{value:0},opacity:{value:.34},resolution:{value:new THREE.Vector2(1440,1000)},pixelRatio:{value:1}},
    vertexShader:`attribute vec3 rainOrigin;attribute float seed;uniform float time;uniform vec2 resolution;uniform float pixelRatio;varying vec2 rainUv;varying float rainAlpha;
      void main(){vec3 head=rainOrigin;float speed=3.8+seed*2.5;head.y=mod(rainOrigin.y-time*speed,10.0)+.10;head.x+=head.y*.045;
        float len=.24+seed*.24;vec3 tail=head+vec3(-len*.045,len,0.);
        vec4 h=projectionMatrix*modelViewMatrix*vec4(head,1.),t=projectionMatrix*modelViewMatrix*vec4(tail,1.);
        vec2 direction=(t.xy/max(t.w,.001)-h.xy/max(h.w,.001))*resolution;
        vec2 normal=vec2(-direction.y,direction.x)/max(length(direction),.001);
        vec4 clip=mix(h,t,position.y);clip.xy+=normal*position.x*(.75+seed*.25)*pixelRatio*2./resolution*clip.w;
        rainUv=vec2(position.x,position.y);rainAlpha=.60+seed*.40;
        if(head.x>-4.98&&head.x<2.10&&head.z>-3.70&&head.z<1.65&&head.y<3.76)rainAlpha=0.;
        if(h.w<.20||t.w<.20)rainAlpha=0.;gl_Position=clip;
      }`,
    fragmentShader:`uniform float opacity;varying vec2 rainUv;varying float rainAlpha;void main(){float side=pow(max(0.,1.-rainUv.x*rainUv.x),1.5);float endFade=smoothstep(0.,.12,rainUv.y)*(1.-smoothstep(.72,1.,rainUv.y));gl_FragColor=vec4(.67,.79,.87,opacity*rainAlpha*side*endFade);}`});
  const rain=new THREE.Mesh(rainG,rainMat);rain.name='visible-soft-rain-ribbons';rain.frustumCulled=false;rain.castShadow=false;rain.receiveShadow=false;world.add(rain);
  const rainViewport=new THREE.Vector4();
  rain.onBeforeRender=r=>{r.getCurrentViewport(rainViewport);rainMat.uniforms.resolution.value.set(Math.max(1,rainViewport.z),Math.max(1,rainViewport.w));rainMat.uniforms.pixelRatio.value=r.getPixelRatio();};
  // Narrow glass streaks are nearly invisible except against the warm interior.
  const streakMat=new THREE.MeshBasicMaterial({color:'#aec9c0',transparent:true,opacity:.11,depthWrite:false});
  for(let i=0;i<22;i++){const s=box([-4.4+rng(i+33)*4.1,1.4+rng(i+65)*1.4,1.277],[.006,.07+rng(i+22)*.17,.001],streakMat,[0,0,.025],moving);rainStreaks.push(s);}
  const drips=[];
  const dripMat=new THREE.MeshBasicMaterial({color:'#cee0d7',transparent:true,opacity:.29,depthWrite:false});
  // Logo-side runoff was present, but its box height was scaled twice into near invisibility.
  // Four outlets, including the FOUR fascia; each drop uses world-sized axes and a matching splash.
  for(let i=0;i<24;i++){
    const cluster=i%4,x=[-4.75,-.27,2.075,-4.14][cluster]+(Math.floor(i/4)%3)*.027,z=cluster===2?-.39:1.73;
    const sourceY=cluster===3?3.18:3.51;
    const d=mesh(geom('rain-drop-sphere',()=>new THREE.SphereGeometry(1,10,8)),dripMat,[x,sourceY,z],[.007,.021,.007],[0,0,0],moving);d.name=cluster===3?'logo-fascia-runoff':'roof-runoff';
    const m=new THREE.MeshBasicMaterial({color:'#c8d3c6',transparent:true,opacity:0,depthWrite:false});
    const ring=mesh(new THREE.RingGeometry(.92,1,28),m,[x,.091,z],[1,1,1],[-Math.PI/2,0,0],moving);
    drips.push({drop:d,ring,phase:i*.173,sourceY,logo:cluster===3});
  }
  const sceneLife=createSceneLife({world,moving,mesh,box,cylinder,rod,curve,label,mats,cup,phone,phoneDoor,mail,laptopLid,disposables,hotspot,logoMaterial,logoReady});
  // Soft perimeter glow follows luminous architecture; depth testing keeps walls and props opaque.
  sourceHalo('studio-fascia-soft-halo',[bx,3.535,1.640],7.32,.24,'#ffdda9',.11);
  sourceHalo('studio-side-fascia-soft-halo',[2.105,3.535,-1.05],5.40,.22,'#ffdda9',.10,[0,Math.PI/2,0]);
  for(const z of [-2.48,.63])sourceHalo('studio-wall-light-soft-halo',[2.112,2.80,z],.34,.53,'#ffdda9',.14,[0,Math.PI/2,0]);
  for(const x of [-.62,.62])sourceHalo('phone-edge-soft-halo',[x,1.56,.667],.17,2.76,'#ffdaa4',.13,[0,0,0],phone);
  sourceHalo('phone-ceiling-soft-halo',[0,2.785,.03],1.36,1.3,'#ffdaa4',.12,[Math.PI/2,0,0],phone);
  sourceHalo('mail-slot-soft-halo',[0,1.26,.501],.85,.17,'#ffdda9',.14,[0,0,0],mail);
  const advertising=world.getObjectByName('four-studio-advertising-lightbox');
  for(const side of [-1,1])sourceHalo('advertising-edge-soft-halo',[0,3.82,side*.161],1.27,.18,'#d7e6d9',.12,[0,side>0?0:Math.PI,0],advertising);
  for(const lamp of streetLamps)sourceHalo('street-lamp-soft-halo',[lamp.x,lamp.y,lamp.z],.86,.72,'#ffdda9',.28,[-Math.PI/2,0,0]);
  const pigeonLife=createPigeonLife(moving,sceneLife.getPigeonPerches());
  const ambient=new THREE.HemisphereLight('#accedf','#59685b',1.5);scene.add(ambient);
  const moon=new THREE.DirectionalLight('#adcddb',2.1);moon.position.set(-3,10,7);moon.castShadow=true;moon.shadow.mapSize.set(1024,1024);moon.shadow.camera.left=-9;moon.shadow.camera.right=9;moon.shadow.camera.top=9;moon.shadow.camera.bottom=-9;moon.shadow.camera.near=1;moon.shadow.camera.far=28;moon.shadow.normalBias=.024;moon.shadow.bias=-.00015;moon.shadow.radius=.65;scene.add(moon);
  const rim=new THREE.DirectionalLight('#80aaac',1.3);rim.position.set(-8,4,-8);scene.add(rim);
  // Merge the static architecture by material. Repeated scene elements share geometry.
  for(const [mat,gs] of batches){const merged=mergeCompatible(gs);if(merged){const m=new THREE.Mesh(merged,mat);m.castShadow=true;m.receiveShadow=true;world.add(m);}gs.forEach(g=>g.dispose());}
  if(outlines.length){const merged=mergeGeometries(outlines,false);const m=new THREE.LineSegments(merged,new THREE.LineBasicMaterial({color:'#162a30',transparent:true,opacity:.42}));world.add(m);outlines.forEach(g=>g.dispose());}
  // Consolidate local rigid parts while retaining door/lid group transforms.
  for(const parent of [phone,phoneDoor,mailDoor,mail,chair]) {
    const groups=new Map();
    for(const child of [...parent.children]) {
      if(!child.isMesh||child.material.transparent)continue;
      const key=child.material;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(child);
    }
    for(const [mat,objects] of groups){
      if(objects.length<2)continue;
      const gs=objects.map(o=>{o.updateMatrix();return o.geometry.clone().applyMatrix4(o.matrix);});
      const g=mergeCompatible(gs);
      if(g){objects.forEach(o=>parent.remove(o));const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);}
      gs.forEach(g=>g.dispose());
    }
  }
  const wind=installFoliageWind(world,[mats.green,mats.greenLight,mats.greenDark],disposables);
  let focused='overview',focusAmount=0,rainOn=true,reduced=false,quality='auto';
  const params={studio:0,phone:0,mail:0};
  return {
    world, hitboxes, logoReady:Promise.all([logoReady,sceneLife.logoReady]),
    getLightingState(){return {halos:sourceHalos.length,streetLampPosition:streetLamps[0].anchor.slice(),streetLampIntensity:36,streetLampYaw:streetLamps[0].yaw,streetLampHead:[streetLamps[0].x,streetLamps[0].y,streetLamps[0].z],streetLampTarget:streetLamps[0].target.slice(),advertisingPosition:world.getObjectByName('four-studio-advertising-lightbox').position.toArray()};},
    getLayoutState(){world.updateMatrixWorld(true);return {studioFront:[0,0,1],phone:{position:phone.position.toArray(),yaw:phone.rotation.y,front:new THREE.Vector3(0,0,1).transformDirection(phone.matrixWorld).toArray(),doorYaw:phoneDoor.rotation.y},mail:{position:mail.position.toArray(),yaw:mail.rotation.y,front:new THREE.Vector3(0,0,1).transformDirection(mail.matrixWorld).toArray(),doorPitch:mailDoor.rotation.x},perches:sceneLife.getPigeonPerches(),interactiveModes:hitboxes.map(o=>o.userData.mode)};},
    getAmbientState(){return {pigeons:pigeonLife.getState(),...sceneLife.getState(),reduced,rain:{enabled:rainOn,visible:rain.visible,instances:rainG.instanceCount,opacity:rainMat.uniforms.opacity.value,length:[.24,.48],widthCss:[1.5,2.0]},puddleImpacts:{total:ripples.length,active:ripples.filter(r=>r.mesh.visible).length,maxRadius:.36,lifetime:1.65,waves:ripples.filter(r=>r.mesh.visible).map(r=>({position:r.mesh.position.toArray(),radius:r.mesh.scale.x,opacity:r.mesh.material.uniforms.waveOpacity.value}))},runoff:{total:drips.length,logo:drips.filter(s=>s.logo).map(s=>({visible:s.drop.visible,y:s.drop.position.y,length:s.drop.scale.y*2,splash:s.ring.visible}))}};},
    triggerChime(){sceneLife.triggerChime();},
    prepareRender(camera){
      world.updateMatrixWorld(true);camera.updateMatrixWorld(true);
      // The reflection prepass runs before the main pass: refresh dynamic-door shadows now,
      // otherwise the mirror would sample the previous frame's shadow map during close-up motion.
      renderer.shadowMap.needsUpdate=true;
      reflectionPrepass(renderer,scene,camera);
    },
    setMode(mode){focused=mode;},
    setRain(value){rainOn=value;rain.visible=value&&!reduced;rainStreaks.forEach(s=>s.visible=value);drips.forEach(s=>{s.drop.visible=value&&!reduced;s.ring.visible=value&&!reduced;});ripples.forEach(s=>s.mesh.visible=false);},
    setReduced(value){reduced=value;rain.visible=rainOn&&!value;drips.forEach(s=>{s.drop.visible=rainOn&&!value;s.ring.visible=rainOn&&!value;});ripples.forEach(s=>s.mesh.visible=false);},
    setQuality(value){quality=value;const low=value==='low'||(value==='auto'&&innerWidth<700);rainG.instanceCount=low?100:count;const res=low?768:value==='high'?1536:1024;ground.getRenderTarget().setSize(res,res);ground.material.uniforms.texel.value.set(1/res,1/res);moon.shadow.mapSize.set(1024,1024);if(moon.shadow.map){moon.shadow.map.dispose();moon.shadow.map=null;}},
    update(t,dt){
      pigeonLife.update(t,dt,reduced,focused);sceneLife.update(t,dt,reduced,rainOn,focused);
      wind.time.value=reduced?0:t;wind.strength.value=reduced?0:1;
      for(const key of Object.keys(params))params[key]=reduced?(focused===key?1:0):THREE.MathUtils.damp(params[key],focused===key?1:0,3.1,dt);
      phoneDoor.rotation.y=-params.phone*1.58;keyMat.emissiveIntensity=params.phone*.65;phoneLight.intensity=.8+params.phone*1.5;
      mailDoor.rotation.x=params.mail*1.64;
      for(let i=0;i<letters.length;i++){const p=THREE.MathUtils.smoothstep(params.mail,.32+i*.065,.80+i*.035);const env=letters[i];env.visible=p>.01;env.position.set(Math.sin(i*1.9)*.24*p,1.55+p*(.38+i*.14),.04+p*(.64+i*.12));env.rotation.set(-.18*p,-.20+i*.095,Math.sin(i*1.7)*.21*p);if(!reduced&&p>.99)env.position.y+=Math.sin(t*1.5+i)*.035;}
      laptopLid.rotation.x=-.15-params.studio*.05;laptopScreen.material.color.setScalar(1+params.studio*.16);
      interiorLight.intensity=17+params.studio*3+(reduced?0:Math.sin(t*.64)*.45);
      ground.material.uniforms.time.value=reduced?0:t;
      if(!reduced){rainMat.uniforms.time.value=t;rain.visible=rainOn;for(let i=0;i<ripples.length;i++){const r=ripples[i],time=t+r.phase*r.period,cycle=Math.floor(time/r.period),age=time-cycle*r.period;
        if(cycle!==r.cycle){r.cycle=cycle;const angle=rng(i+cycle*37+100)*Math.PI*2,spread=Math.sqrt(rng(i+cycle*71+500))*.42;r.x=r.puddle[0]+Math.cos(angle)*spread*r.puddle[2];r.z=r.puddle[1]+Math.sin(angle)*spread*r.puddle[3];}
        const p=Math.min(age/1.65,1),radius=.035+p*.325;
        r.mesh.visible=rainOn&&age<1.65;r.mesh.position.set(r.x,.094,r.z);r.mesh.scale.setScalar(radius);
        r.mesh.material.uniforms.waveOpacity.value=THREE.MathUtils.smoothstep(p,0,.10)*Math.pow(1-p,1.15)*.46;
      }
        rainStreaks.forEach((s,i)=>{s.visible=rainOn&&focused!=='studio';s.position.y=1.1+((i*.23-t*.055)%1.6+1.6)%1.6;});drips.forEach(s=>{const p=(t*.72+s.phase)%1;const falling=Math.min(p/.79,1);s.drop.visible=rainOn&&p<.79;s.drop.position.y=s.sourceY-(s.sourceY-.10)*falling*falling;s.drop.scale.y=.021+falling*.040;const impact=THREE.MathUtils.clamp((p-.79)/.21,0,1);s.ring.visible=rainOn&&p>=.79;s.ring.scale.setScalar(.018+impact*.20);s.ring.material.opacity=(1-impact)*.22;});}
    },
    dispose(){blurA.dispose();blurB.dispose();blurQuad.dispose();blurMaterial.dispose();ground.dispose();const geometries=new Set(),materials=new Set();world.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material){for(const m of(Array.isArray(o.material)?o.material:[o.material]))materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());Object.values(mats).forEach(m=>m.dispose());cache.forEach(g=>g.dispose());unitBox.dispose();disposables.forEach(d=>d.dispose());moon.shadow.map?.dispose();}
  };
}
