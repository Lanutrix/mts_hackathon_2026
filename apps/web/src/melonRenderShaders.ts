export const vertexSource = `
attribute vec3 a_point;
attribute vec3 a_normal;
attribute float a_material;
uniform vec3 u_rotation, u_camera, u_translation;
uniform vec2 u_scale;
uniform float u_pivot, u_floor;
varying vec3 v_local, v_normal, v_world;
varying float v_material;
vec3 rotate(vec3 p,vec3 angles) {
  vec3 c=cos(angles),s=sin(angles);
  p.yz=mat2(c.x,s.x,-s.x,c.x)*p.yz;
  p.xz=mat2(c.y,-s.y,s.y,c.y)*p.xz;
  p.xy=mat2(c.z,s.z,-s.z,c.z)*p.xy;
  return p;
}
void main() {
  v_material=a_material;
  v_local=a_point;
  v_normal=rotate(rotate(a_normal,u_rotation),u_camera);
  vec3 pivot=vec3(0.0,-0.38,u_pivot);
  vec3 world=rotate(a_point-pivot,u_rotation)+pivot+u_translation;
  vec3 camera=rotate(world+vec3(0.0,0.46,0.68),u_camera);
  v_world=camera;
  float perspective=6.8/(6.8-camera.z);
  gl_Position=vec4((camera.xy*perspective+vec2(.45,.13))*u_scale,-camera.z/7.0,1.);
  if(u_floor>0.5) gl_Position=vec4(a_point.xy,0.99,1.);
}
`;

export const fragmentSource = `
precision highp float;
uniform float u_floor, u_index, u_focus;
uniform vec2 u_scale;
varying vec3 v_local,v_normal,v_world;
varying float v_material;
float hash(vec2 v) {
  vec3 p=fract(vec3(v.xyx)*vec3(0.1031,0.1030,0.0973));
  p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
float noise2(vec2 v) {
  vec2 cell=floor(v), f=fract(v);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash(cell),hash(cell+vec2(1,0)),f.x),mix(hash(cell+vec2(0,1)),hash(cell+1.),f.x),f.y);
}
float noise3(vec3 p) { return noise2(vec2(p.x+.413*p.y-.617*p.z,.217*p.x+.85*p.y+1.13*p.z)); }

// Seed pockets follow two staggered arcs in each cut plane. Each seed has
// an asymmetric outline, a soft indentation, and a small reflected highlight.
vec3 seedRing(vec2 p,vec3 flesh,float radius,float count,float phase,float seedID) {
  float a=atan(p.y,p.x), stepAngle=6.2831853/count;
  float id=floor((a-phase)/stepAngle+0.5);
  float random=hash(vec2(id+31.,seedID));
  float theta=phase+(id+(random-.5)*.29)*stepAngle;
  vec2 radial=vec2(cos(theta),sin(theta));
  float r=radius+(hash(vec2(id+12.,seedID+31.))-.5)*.067;
  vec2 delta=p-r*radial;
  float across=dot(delta,vec2(-radial.y,radial.x)), along=dot(delta,radial);
  across+=along*(random-.5)*.65;
  float size=.80+random*.36;
  float y=along/(.046*size), x=across/(.022*size);
  float d=length(vec2(x*(1.+.29*clamp(y,-1.,1.)),y));
  float pocket=1.-smoothstep(.78,1.90,d);
  flesh=mix(flesh,flesh*vec3(.78,.61,.65),pocket*.35);
  float seed=1.-smoothstep(.79,1.06,d);
  vec3 shell=mix(vec3(.096,.050,.052),vec3(.26,.135,.115),clamp(.22-.45*x+.17*y,0.,1.));
  shell+=vec3(.15,.105,.09)*(1.-smoothstep(.0,.60,length(vec2(x+.42,(y-.10)*.72))));
  return mix(flesh,shell,seed);
}

void main() {
  if(u_floor>0.5) {
    vec2 p=v_local.xy/u_scale;
    p.x-=.01;
    float wide=exp(-2.0*(p.x*p.x/2.0+pow((p.y+.825-p.x*.096)/.159,2.)));
    float near=exp(-2.1*(p.x*p.x/.93+pow((p.y+.81-p.x*.10)/.074,2.)));
    gl_FragColor=vec4(.14,.195,.14,.115*wide+.14*near);
    return;
  }
  vec3 local=v_local/vec3(1.16,1.08,1.82);
  float radius=length(local);
  bool top=v_material>.5&&v_material<1.5;
  bool skin=v_material>1.5;
  vec2 plane=top ? local.xz : local.xy;
  vec3 normal=normalize(v_normal);
  float large=noise3(v_local*5.2);
  float mottling=noise3(v_local*24.0);
  float grain=noise3(v_local*123.);
  float fine=noise3(v_local*300.);
  float angle=atan(local.y,local.x);
  float stripe=cos(13.0*angle+local.z*.55+1.2*noise2(vec2(angle*7.,local.z*10.))+.39*noise2(vec2(angle*17.,local.z*26.)));
  vec3 peel=mix(vec3(.093,.294,.199),vec3(.382,.557,.301),smoothstep(-.85,.55,stripe));
  peel+=vec3(.06,.07,.035)*(mottling-.4)+vec3(.09)*(fine-.5);
  float fibres=(noise2(plane*vec2(92.,31.))-.5)*.038;
  float pulp=(large-.5)*.095+(mottling-.5)*.078+(grain-.5)*.077+(fine-.5)*.056+fibres;
  vec3 flesh=mix(vec3(.94,.304,.352),vec3(.985,.49,.47),large*.48+clamp((radius-.55)*1.2,0.,.34));
  flesh+=pulp*vec3(.66,.95,.74);
  float edge=radius+(mottling-.5)*.012+(large-.5)*.019;
  flesh=mix(flesh,vec3(.99,.695,.606)+.04*(grain-.5),smoothstep(.785,.90,edge)*.83);
  vec3 pith=mix(vec3(.998,.927,.778),vec3(.792,.886,.622),smoothstep(.916,.963,edge));
  pith+=(grain-.5)*.065+(mottling-.5)*.038;
  vec3 color=mix(flesh,pith,smoothstep(.871,.907,edge));
  color=mix(color,mix(vec3(.55,.71,.31),peel,.35),smoothstep(.938,.979,edge));
  color=mix(color,peel,smoothstep(.976,.993,radius));
  if(!skin) {
    float crossSection=top?1.:sqrt(max(.002,1.-local.z*local.z));
    vec2 seedPlane=plane/crossSection;
    float id=top?9.:2.+u_index*1.6;
    float seedWeight=1.-smoothstep(.78,.84,radius);
    vec3 seeded=seedRing(seedPlane,color,.655,17.,.258+id*.123,id);
    seeded=seedRing(seedPlane,seeded,.400,10.,.03+id*.11,id+12.);
    color=mix(color,seeded,seedWeight);
  } else color=peel;
  vec3 key=normalize(vec3(-.48,.78,.72));
  vec3 fill=normalize(vec3(.88,.32,.25));
  float sun=max(dot(normal,key),0.);
  float bounce=max(dot(normal,fill),0.);
  float lighting=.74+.27*sun+.095*bounce;
  float sheen=pow(max(dot(normal,normalize(key+vec3(0,0,1))),0.),skin?27.:38.);
  color=color*lighting+sheen*(skin?.095:.02);
  color*=.95+.05*smoothstep(-.92,.14,v_world.y);
  color*=1.-.045*u_focus;
  gl_FragColor=vec4(color,1.);
}
`;
