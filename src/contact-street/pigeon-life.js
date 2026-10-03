import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Small, bounded ambient events, independent of render rate and camera interpolation.
export function createPigeonLife(parent,perchSites=[]) {
  const random=(a,b)=>a+Math.random()*(b-a);
  const v=(x,y,z)=>new THREE.Vector3(x,y,z);
  const sphere=new THREE.SphereGeometry(1,24,16);
  const materials={
    body:new THREE.MeshStandardMaterial({color:'#aeb7bd',roughness:.86}),
    wing:new THREE.MeshStandardMaterial({color:'#82929e',roughness:.88,side:THREE.DoubleSide}),
    dark:new THREE.MeshStandardMaterial({color:'#3a464f',roughness:.82}),
    neck:new THREE.MeshStandardMaterial({color:'#64817b',roughness:.58,metalness:.12}),
    feet:new THREE.MeshStandardMaterial({color:'#a67a75',roughness:.86}),
    eye:new THREE.MeshStandardMaterial({color:'#12191b',roughness:.25})
  };
  const events=[],birds=[],tangent=new THREE.Vector3();
  let flockCountdown=random(3,7),flockActive=false,flockSize=0;const flockHistory=[];
  function part(group,geometry,mat,pos,scale=[1,1,1]) {
    const m=new THREE.Mesh(geometry,materials[mat]);m.position.set(...pos);m.scale.set(...scale);m.castShadow=false;m.receiveShadow=true;group.add(m);return m;
  }
  function ellipsoid(group,mat,pos,scale){return part(group,sphere,mat,pos,scale);}
  function rod(group,a,b,r) {
    const start=v(...a),end=v(...b),d=end.clone().sub(start);
    const m=part(group,new THREE.CylinderGeometry(r,r,d.length(),6),'feet',start.add(end).multiplyScalar(.5).toArray());
    m.quaternion.setFromUnitVectors(v(0,1,0),d.normalize());
  }
  function consolidate(group){
    for(const mat of Object.values(materials)){
      const meshes=group.children.filter(o=>o.isMesh&&o.material===mat);
      if(meshes.length<2)continue;
      const gs=meshes.map(m=>{m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);g.deleteAttribute('uv');if(g.index){const expanded=g.toNonIndexed();g.dispose();return expanded;}return g;});
      const geometry=mergeGeometries(gs,false);gs.forEach(g=>g.dispose());
      if(geometry){meshes.forEach(m=>{group.remove(m);if(m.geometry!==sphere)m.geometry.dispose();});const m=part(group,geometry,Object.keys(materials).find(k=>materials[k]===mat),[0,0,0]);m.name='pigeon-rigid-parts';}
    }
  }
  for(let i=0;i<4;i++){
    const root=new THREE.Group();root.name=`ambient-pigeon-${i+1}`;parent.add(root);root.visible=false;
    const torso=new THREE.Group();root.add(torso);
    ellipsoid(torso,'body',[0,.143,-.015],[.074,.097,.145]);
    ellipsoid(torso,'neck',[0,.234,.079],[.043,.075,.047]);
    const tail=new THREE.BufferGeometry();tail.setAttribute('position',new THREE.Float32BufferAttribute([-.043,.135,-.10,-.075,.12,-.235,.075,.12,-.235,.043,.135,-.10],3));tail.setIndex([0,1,2,0,2,3]);tail.computeVertexNormals();part(torso,tail,'dark',[0,0,0]);
    for(const x of [-.030,.030]){
      rod(torso,[x,.090,.028],[x,.024,.045],.004);
      for(const dx of [-.019,0,.019])rod(torso,[x,.025,.045],[x+dx,.008,.092-Math.abs(dx)],.003);
      rod(torso,[x,.025,.045],[x,.009,.016],.003);
    }
    const head=new THREE.Group();head.position.set(0,.278,.103);root.add(head);
    ellipsoid(head,'body',[0,0,0],[.046,.045,.049]);
    for(const x of [-.040,.040]){
      ellipsoid(head,'feet',[x,.006,.019],[.007,.007,.006]);
      ellipsoid(head,'eye',[x+Math.sign(x)*.002,.006,.021],[.0045,.0045,.004]);
      ellipsoid(head,'body',[x+Math.sign(x)*.004,.007,.024],[.0014,.0014,.001]);
    }
    const beak=part(head,new THREE.ConeGeometry(.012,.039,8),'dark',[0,-.007,.060]);beak.rotation.x=Math.PI/2;
    ellipsoid(head,'body',[0,.002,.045],[.010,.009,.012]);
    const wings=[];
    for(const side of [-1,1]){
      const wing=new THREE.Group();wing.position.set(side*.053,.174,.015);root.add(wing);
      const pts=[[0,0,.075],[side*.11,.005,.052],[side*.30,-.003,-.073],[side*.36,-.008,-.155],[side*.20,-.004,-.163],[side*.06,0,-.103]];
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts.flat(),3));g.setIndex([0,1,2,0,2,3,0,3,4,0,4,5]);g.computeVertexNormals();part(wing,g,'wing',[0,0,0]);
      const stripe=new THREE.BufferGeometry();stripe.setAttribute('position',new THREE.Float32BufferAttribute([side*.11,.002,-.015,side*.16,.002,-.040,side*.20,.002,-.14,side*.145,.002,-.13],3));stripe.setIndex([0,1,2,0,2,3]);stripe.computeVertexNormals();part(wing,stripe,'dark',[0,0,0]);
      // Rounded primary feathers overlap the wing edge; two darker bars read as pigeon markings.
      for(let k=0;k<7;k++){
        const feather=ellipsoid(wing,k%3?'wing':'body',[side*(.115+k*.034),-.004,-.111-k*.007],[.019,.008,.066-k*.004]);feather.rotation.y=side*(-.32-k*.035);
      }
      const folded=new THREE.Group();folded.position.set(side*.066,.161,-.031);root.add(folded);
      ellipsoid(folded,'wing',[0,0,0],[.026,.056,.117]);
      for(let k=0;k<5;k++){const feather=ellipsoid(folded,k<2?'dark':'wing',[side*.014,-.027+k*.010,-.035-k*.012],[.007,.009,.067]);feather.rotation.x=-.13;}
      folded.rotation.x=-.10;folded.visible=false;consolidate(wing);consolidate(folded);
      wings.push({group:wing,side,folded});
    }
    for(let k=0;k<5;k++){const feather=ellipsoid(torso,k%2?'wing':'dark',[(k-2)*.024,.127,-.174],[.015,.009,.077]);feather.rotation.y=(k-2)*.08;}
    root.scale.setScalar(random(.94,1.10));
    consolidate(torso);consolidate(head);
    birds.push({root,torso,head,wings,phase:'wait',elapsed:0,duration:0,queued:false,curve:null,perch:null,perchKind:null,rest:0,phaseOffset:random(0,6.28),completed:0});
  }
  function flight(b,phase,curve,duration){b.phase=phase;b.elapsed=0;b.duration=duration;b.curve=curve;b.root.visible=true;}
  function note(b,type){events.push({bird:birds.indexOf(b),type,perch:b.perch?.toArray()||null,perchKind:b.perchKind,duration:+b.duration.toFixed(2),routeStart:b.curve?.v0.toArray()||null,routeEnd:b.curve?.v3.toArray()||null});if(events.length>24)events.shift();}
  const candidates=[...perchSites.map(s=>({...s,position:s.position.slice()})),
    {kind:'eave',weight:1.4,random:()=>v(random(-4.3,1.35),3.669,1.30)},
    {kind:'roof',weight:.9,random:()=>v(random(.40,1.40),3.669,random(-2.30,.25))}];
  function choosePerch(b){
    // Fixed small objects are reserved while another pigeon is approaching or perched.
    const available=candidates.filter(site=>site.random||!birds.some(other=>other!==b&&other.phase!=='wait'&&other.perch&&other.perch.distanceTo(v(...site.position))<.60));
    if(!available.length)return false;
    for(let attempt=0;attempt<24;attempt++){
      let ticket=Math.random()*available.reduce((sum,s)=>sum+s.weight,0),site=available.at(-1);
      for(const candidate of available){ticket-=candidate.weight;if(ticket<=0){site=candidate;break;}}
      const point=site.random?site.random():v(...site.position);
      if(birds.some(other=>other!==b&&other.phase!=='wait'&&other.perch&&other.perch.distanceTo(point)<.60))continue;
      b.perchKind=site.kind;b.surfaceY=point.y;point.y-=.008*b.root.scale.y;b.perch=point;return true;
    }
    return false;
  }
  function launch(b){
    const side=Math.random()<.5?-1:1,landing=Math.random()<.72&&choosePerch(b);
    b.rest=random(9,23);
    const start=v(side*random(13,16),random(7.1,8.1),random(3.8,6));
    if(landing){
      const above=b.perch.clone();above.y+=1.45;
      const cruise=Math.max(6.8,above.y+.65);
      flight(b,'approach',new THREE.CubicBezierCurve3(start,v(side*6,cruise,5),v(b.perch.x,cruise,b.perch.z+.35),above),random(4.0,5.8));
    }else{
      b.perch=null;b.perchKind=null;
      flight(b,'flyby',new THREE.CubicBezierCurve3(start,v(side*4,random(5.8,7),3.2),v(-side*5,random(5.8,7.2),1.8),v(-side*15,random(6.3,8),random(-1,4))),random(6,9));
    }
    note(b,b.phase);
  }
  function advance(b){
    if(b.phase==='approach'){
      const start=b.root.position.clone(),end=b.perch.clone();
      flight(b,'landing',new THREE.CubicBezierCurve3(start,v(end.x,end.y+.92,end.z),v(end.x,end.y+.23,end.z),end),random(1.25,1.75));
    }else if(b.phase==='landing'){
      b.phase='perch';b.elapsed=0;b.duration=b.rest;b.root.position.copy(b.perch);b.root.rotation.set(0,b.perchKind==='utility'?Math.PI/2:random(-2.6,2.6),0);note(b,'perch');
    }else if(b.phase==='perch'){
      const start=b.root.position.clone(),end=start.clone().add(v(0,Math.max(1.70,5.7-start.y),.05));
      flight(b,'takeoff',new THREE.CubicBezierCurve3(start,start.clone().add(v(0,.42,.07)),end.clone().add(v(0,-.4,-.04)),end),random(1.1,1.6));note(b,'takeoff');
    }else if(b.phase==='takeoff'){
      const start=b.root.position.clone(),side=Math.random()<.5?-1:1;
      flight(b,'depart',new THREE.CubicBezierCurve3(start,start.clone().add(v(side*1.5,1.3,.45)),v(side*7,6.8,3.8),v(side*15,random(7,8),5)),random(4.2,6));
    }else{
      b.completed++;b.phase='wait';b.elapsed=0;b.duration=0;b.queued=false;b.root.visible=false;note(b,'cooldown');
    }
  }
  return {
    update(t,dt,reduced,focused){
      if(!reduced&&focused==='overview'&&!flockActive){
        flockCountdown-=dt;
        if(flockCountdown<=0){
          flockSize=1+Math.floor(Math.random()*4);flockActive=true;flockHistory.push(flockSize);if(flockHistory.length>30)flockHistory.shift();
          for(let i=0;i<birds.length;i++){birds[i].queued=i<flockSize;birds[i].elapsed=0;birds[i].duration=i*.45+random(0,.35);}
        }
      }
      for(const b of birds){
        if(reduced){b.root.visible=b.phase==='perch';continue;}
        if(b.phase==='wait'){
          b.root.visible=false;if(focused!=='overview'||!b.queued)continue;
          b.elapsed+=dt;if(b.elapsed>=b.duration){b.queued=false;launch(b);}continue;
        }
        b.root.visible=true;b.elapsed+=dt;
        const p=THREE.MathUtils.clamp(b.elapsed/b.duration,0,1);
        const perched=b.phase==='perch';
        if(!perched){
          const u=b.phase==='landing'?1-Math.pow(1-p,2):b.phase==='takeoff'?p*p:p;
          b.curve.getPoint(u,b.root.position);b.curve.getTangent(Math.min(u,.999),tangent);
          if(tangent.x*tangent.x+tangent.z*tangent.z>.0001)b.root.rotation.y=Math.atan2(tangent.x,tangent.z);
          b.root.rotation.x=THREE.MathUtils.clamp(-Math.asin(tangent.y)*.35,-.32,.32);
          b.root.rotation.z=Math.sin(t*1.4+b.phaseOffset)*.05;
        }else{
          b.root.rotation.x=0;b.root.rotation.z=0;
        }
        const fold=perched?1:b.phase==='landing'?THREE.MathUtils.smoothstep(p,.72,1):b.phase==='takeoff'?1-THREE.MathUtils.smoothstep(p,0,.25):0;
        for(const {group,side,folded} of b.wings){group.visible=fold<.99;folded.visible=fold>.55;group.scale.x=1-fold*.80;group.rotation.z=side*(fold*-1.10+(1-fold)*Math.sin(t*22+b.phaseOffset)*.72);}
        b.head.rotation.y=perched?Math.sin(b.elapsed*.72+b.phaseOffset)*.34:0;
        b.head.rotation.x=perched?Math.pow(Math.max(0,Math.sin(b.elapsed*1.17+b.phaseOffset)),9)*.16:0;
        if(p>=1)advance(b);
      }
      if(!reduced&&flockActive&&birds.every(b=>b.phase==='wait'&&!b.queued)){flockActive=false;flockCountdown=random(10,24);}
    },
    getState(){return {capacity:4,perchKinds:[...new Set(candidates.map(s=>s.kind))],flockSize,flockHistory:flockHistory.slice(),birds:birds.map(b=>({phase:b.phase,visible:b.root.visible,position:b.root.position.toArray(),scale:b.root.scale.y,surfaceY:b.surfaceY,remaining:+Math.max(0,b.duration-b.elapsed).toFixed(3),perchKind:b.perchKind,completed:b.completed})),events:events.map(e=>({...e,perch:e.perch?.slice()||null,routeStart:e.routeStart?.slice()||null,routeEnd:e.routeEnd?.slice()||null}))};}
  };
}
