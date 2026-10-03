import * as THREE from 'three';

export function installFoliageWind(world,materials,disposables){
  const time={value:0},strength={value:1};
  const deformation=`
    transformed.x += lifeWind * lifeStrength * (sin(lifeTime*.73+position.y*.65+position.z*.8)*.022+sin(lifeTime*1.17+position.x*.5)*.009);
    transformed.z += lifeWind * lifeStrength * sin(lifeTime*.61+position.x*.7)*.014;
  `;
  const decorate=shader=>{
    shader.uniforms.lifeTime=time;shader.uniforms.lifeStrength=strength;
    shader.vertexShader='attribute float lifeWind; uniform float lifeTime; uniform float lifeStrength;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+deformation);
  };
  for(const material of materials){material.onBeforeCompile=decorate;material.customProgramCacheKey=()=> 'foliage-breeze-v1';material.needsUpdate=true;}
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});depth.onBeforeCompile=decorate;depth.customProgramCacheKey=()=> 'foliage-breeze-depth-v1';disposables.push(depth);
  world.updateMatrixWorld(true);
  const pos=new THREE.Vector3();
  world.traverse(o=>{
    if(!o.isMesh||!materials.includes(o.material))return;
    const a=o.geometry.getAttribute('position'),weights=new Float32Array(a.count);
    for(let i=0;i<a.count;i++){pos.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);weights[i]=THREE.MathUtils.smoothstep(pos.y,.65,2.8);}
    o.geometry.setAttribute('lifeWind',new THREE.BufferAttribute(weights,1));o.customDepthMaterial=depth;
    o.geometry.computeBoundingSphere();o.geometry.boundingSphere.radius+=.05;
  });
  return {time,strength};
}

export function createSceneLife({world,moving,mesh,box,cylinder,rod,curve,label,mats,cup,phone,phoneDoor,mail,laptopLid,disposables,hotspot,logoMaterial,logoReady}){
  const chime=new THREE.Group();chime.name='sheltered-wind-chime';chime.position.set(1.57,3.17,1.62);moving.add(chime);
  rod([0,0,0],[0,-.10,0],.004,'graphite',chime);
  mesh(new THREE.TorusGeometry(.09,.007,8,24),'graphite',[0,-.10,0],[1,1,1],[Math.PI/2,0,0],chime);
  const strings=[];
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2,g=new THREE.Group();g.position.set(Math.sin(a)*.063,-.10,Math.cos(a)*.063);chime.add(g);
    rod([0,0,0],[0,-.09,0],.002,'graphite',g);cylinder([0,-.19,0],.009,.009,.20,'champagne',12,g);strings.push(g);
  }
  rod([0,-.10,0],[0,-.32,0],.003,'graphite',chime);cylinder([0,-.26,0],.025,.025,.017,'wood',16,chime);
  box([0,-.39,0],[.060,.095,.009],'porcelain',[0,0,0],chime);
  hotspot('chime',[1.57,2.96,1.62],[.32,.55,.32]);
  const sign=new THREE.Group();sign.name='still-creating-door-sign';sign.position.set(1.16,2.35,1.46);world.add(sign);
  for(const x of [-.15,.15])rod([x,.11,0],[0,.24,0],.003,'graphite',sign);
  box([0,0,0],[.52,.21,.023],'graphite',[0,0,0],sign);
  label('STILL CREATING',[0,.023,.016],.46,.068,{size:36,color:'#e6e5d9',width:512},[0,0,0],sign);
  label('灯还亮着',[0,-.054,.016],.26,.042,{size:32,color:'#c6c9bb',width:256},[0,0,0],sign);

  // Two slender utility poles sit behind the atelier, leaving the front silhouette uncluttered.
  const utilities=new THREE.Group();utilities.name='rear-neighborhood-utility-poles';world.add(utilities);
  const polePoints=[[-5.75,-4.85],[3.75,-5.15]];
  for(const [x,z] of polePoints){
    cylinder([x,2.97,z],.064,.103,5.79,'graphite',20,utilities);
    cylinder([x,.25,z],.13,.14,.35,'stone',24,utilities);
    box([x,5.46,z],[1.07,.053,.067],'metal',[0,0,0],utilities);
    for(const dx of [-.43,0,.43]){
      cylinder([x+dx,5.58,z],.032,.032,.19,'porcelain',12,utilities);
      for(let k=0;k<3;k++)cylinder([x+dx,5.51+k*.045,z],.044,.044,.014,'porcelain',12,utilities);
    }
    box([x,3.72,z+.086],[.25,.38,.16],'metal',[0,0,0],utilities);
    curve([[x,5.40,z],[x+.11,5.09,z+.03],[x+.13,4.02,z+.11]],.009,'black',utilities);
    for(let k=0;k<5;k++)rod([x-.04,1.50+k*.36,z+.09],[x+.12,1.50+k*.36,z+.09],.010,'metal',utilities);
  }
  for(const dx of [-.43,0,.43]){
    const cable=new THREE.CubicBezierCurve3(new THREE.Vector3(-5.75+dx,5.68,-4.85),new THREE.Vector3(-2.4+dx,4.94,-4.95),new THREE.Vector3(.4+dx,4.94,-5.07),new THREE.Vector3(3.75+dx,5.68,-5.15));
    mesh(new THREE.TubeGeometry(cable,44,.009,8,false),'black',[0,0,0],[1,1,1],[0,0,0],utilities);
  }
  utilities.traverse(o=>{if(o.isMesh)o.castShadow=false;});

  // Left-side lightbox balances the phone booth and lamp on the right.
  const ad=new THREE.Group();ad.name='four-studio-advertising-lightbox';ad.position.set(-6.3,.075,1.2);ad.rotation.y=-.12;world.add(ad);
  const adPerchSites=[{kind:'advertising',position:[ad.position.x,ad.position.y+3.85+.053/2,ad.position.z],weight:1.2}];
  box([0,.025,0],[.38,.05,.30],'graphite',[0,0,0],ad);
  for(const x of [-.13,.13])for(const z of [-.09,.09])cylinder([x,.057,z],.014,.014,.016,'metal',12,ad);
  cylinder([0,1.49,0],.039,.056,2.92,'metal',20,ad);
  box([0,3.20,0],[1.03,1.24,.14],'graphite',[0,0,0],ad);
  const faceMaterial=new THREE.MeshStandardMaterial({color:'#dedfd3',emissive:'#e3e5d7',emissiveIntensity:.52,roughness:.65});disposables.push(faceMaterial);
  const adLogoMaterials=[];
  const adLogoReady=logoReady.then(()=>{
    const image=logoMaterial.map?.image;if(!image)return;
    const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=420;
    const ctx=canvas.getContext('2d');
    // Thicken the original silhouette uniformly; never substitute a font or stretch a second logo.
    for(let y=-12;y<=12;y++)for(let x=-12;x<=12;x++)if(x*x+y*y<=144)ctx.drawImage(image,65+x,32+y,1270,356);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;disposables.push(texture);
    for(const material of adLogoMaterials){material.map=texture;material.needsUpdate=true;}
  });
  box([0,3.20,0],[.955,1.166,.151],faceMaterial,[0,0,0],ad);
  for(const side of [-1,1]){
    const face=new THREE.Group();face.position.set(0,3.20,side*.084);face.rotation.y=side===1?0:Math.PI;ad.add(face);
    box([0,.078,.003],[.89,.008,.004],'graphite',[0,0,0],face);
    box([0,-.405,.003],[.91,.245,.005],'graphite',[0,0,0],face);
    const logo=logoMaterial.clone();logo.color.set('#102a2f');logo.toneMapped=false;logo.alphaTest=.02;disposables.push(logo);adLogoMaterials.push(logo);
    mesh(new THREE.PlaneGeometry(.64,.192),logo,[0,.34,.012],[1,1,1],[0,0,0],face);
    label('DESIGN STUDIO',[0,.175,.010],.84,.094,{color:'#172f33',size:47,width:768,height:64},[0,0,0],face);
    label('BRAND / DIGITAL / FORM',[0,-.073,.010],.84,.052,{color:'#2b4a4e',size:42,width:768,height:64},[0,0,0],face);
    label('好想法，从这里开始',[0,-.191,.010],.79,.064,{color:'#213e42',size:44,width:768,height:64},[0,0,0],face);
    label('THE LIGHT IS ON',[0,-.37,.013],.78,.056,{color:'#ebdfb9',size:44,width:768,height:64},[0,0,0],face);
    label('COME SAY HELLO',[0,-.465,.013],.68,.042,{color:'#c7d3c8',size:42,width:768,height:64},[0,0,0],face);
  }
  box([0,3.85,0],[1.14,.053,.25],'metal',[0,0,0],ad);
  box([0,3.82,.142],[1.05,.016,.016],'coolLine',[0,0,0],ad);
  const adLight=new THREE.PointLight('#d7e6d9',.55,2.7,2);adLight.position.set(0,3.20,.24);ad.add(adLight);
  ad.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  const perchSites=[...adPerchSites];
  for(const [x,z] of polePoints)for(const dx of [-.22,.22])perchSites.push({kind:'utility',position:[x+dx,5.46+.053/2,z],weight:1.0});
  world.updateMatrixWorld(true);
  for(const [object,kind,local,weight] of [[phone,'phone',[0,3.0975,0],1.5],[mail,'mail',[0,2.012,-.08],1.4]]){
    if(object)perchSites.push({kind,position:object.localToWorld(new THREE.Vector3(...local)).toArray(),weight});
  }
  // Three soft ribbons, not bright point particles. Start above the coffee surface.
  const steam=new THREE.Group();steam.name='quiet-coffee-steam';cup.add(steam);
  const steamUniform={value:0};
  const steamMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{lifeTime:steamUniform},
    vertexShader:`uniform float lifeTime;varying vec2 uv0;void main(){uv0=uv;vec3 p=position;p.x+=sin(uv.y*8.-lifeTime*.8)*.012*uv.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader:`uniform float lifeTime;varying vec2 uv0;void main(){float x=abs(uv0.x-.5)*2.;float edge=pow(max(0.,1.-x*x),3.);float a=edge*sin(uv0.y*3.14159)*(.13+.035*sin(lifeTime*.6+uv0.y*4.));gl_FragColor=vec4(.79,.82,.78,a);}`});disposables.push(steamMaterial);
  for(let i=0;i<3;i++)mesh(new THREE.PlaneGeometry(.032,.26,4,14),steamMaterial,[(i-1)*.020,.312,-.012+i*.011],[1,1,1],[0,(i-1)*.75,0],steam);

  const glassDrops=[],dropMaterial=new THREE.MeshBasicMaterial({color:'#bcd3d2',transparent:true,opacity:.17,depthWrite:false,side:THREE.DoubleSide});disposables.push(dropMaterial);
  const random=(a,b)=>a+Math.random()*(b-a);
  function droplets(parent,x,z,width,rotation=0,base=.68,range=2.55){
    for(let i=0;i<9;i++){
      const group=new THREE.Group();parent.add(group);group.position.set(x+random(-width/2,width/2),base,z);group.rotation.y=rotation;
      mesh(new THREE.PlaneGeometry(.008,random(.025,.065)),dropMaterial,[0,0,0],[1,1,1],[0,0,0],group);
      glassDrops.push({group,base,range,phase:Math.random(),speed:random(.012,.027)});
    }
  }
  droplets(moving,-3.78,1.297,1.45);droplets(moving,-1.40,1.297,2.70);
  droplets(phoneDoor,.59,.012,.90,0,.07,2.40);
  const sideRain=new THREE.Group();sideRain.rotation.y=Math.PI/2;sideRain.position.set(.632,0,0);phone.add(sideRain);droplets(sideRain,0,0,.92,0,.30,2.48);
  const cursor=new THREE.MeshBasicMaterial({color:'#d5dfd7',transparent:true,opacity:0,depthWrite:false,toneMapped:false});disposables.push(cursor);
  box([.323,.311,.030],[.006,.032,.001],cursor,[0,0,0],laptopLid);
  let impulse=0,lastFocused='overview',cursorTimer=0;
  return {
    triggerChime(){impulse=1;},
    logoReady:adLogoReady,
    getPigeonPerches(){return perchSites.map(s=>({...s,position:s.position.slice()}));},
    getState(){return {chimeSwing:chime.rotation.z,steamVisible:steam.visible,glassDrops:glassDrops.length,lightbox:{intensity:faceMaterial.emissiveIntensity,period:28,amplitude:.03,shadowCasters:0}};},
    update(t,dt,reduced,rain,focused){
      if(lastFocused!==focused&&focused==='studio')cursorTimer=3.2;lastFocused=focused;
      impulse=reduced?0:Math.max(0,impulse-dt*.40);cursorTimer=Math.max(0,cursorTimer-dt);
      const adBreath=reduced?1:1+.03*Math.sin(t*Math.PI*2/28);
      faceMaterial.emissiveIntensity=.52*adBreath;adLight.intensity=.55*adBreath;
      const breeze=reduced?0:Math.sin(t*.75)*.025+Math.sin(t*.31)*.012;
      chime.rotation.z=breeze+(reduced?0:Math.sin(t*7)*impulse*.16);chime.rotation.x=reduced?0:Math.sin(t*.63)*.012;
      strings.forEach((g,i)=>{g.rotation.z=reduced?0:Math.sin(t*(.9+i*.08)+i)*.025+Math.sin(t*8+i)*impulse*.08;});
      steam.visible=!reduced;steamUniform.value=reduced?0:t;
      for(const d of glassDrops){d.group.visible=rain;d.group.position.y=d.base+d.range*(reduced?d.phase:1-((d.phase+t*d.speed)%1));}
      cursor.opacity=!reduced&&cursorTimer>0&&Math.sin(t*5)>0?.45:0;
    }
  };
}
