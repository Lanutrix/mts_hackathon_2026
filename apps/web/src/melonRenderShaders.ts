export const vertexSource = `
attribute vec3 a_point;
attribute vec3 a_normal;
attribute float a_material;
uniform vec3 u_rotation, u_camera, u_translation, u_pivot, u_origin;
uniform vec2 u_scale;
uniform float u_size, u_floor;
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
  vec3 world=(rotate(a_point-u_pivot,u_rotation)+u_pivot+u_translation)*u_size;
  vec3 camera=rotate(world,u_camera)+u_origin;
  v_world=camera;
  float perspective=8./(8.-camera.z);
  gl_Position=vec4(camera.xy*perspective*u_scale,-camera.z/7.0,1.);
  if(u_floor>0.5) gl_Position=vec4(a_point.xy,0.99,1.);
}
`;

export const fragmentSource = `
precision highp float;
uniform float u_floor, u_index, u_focus, u_hero, u_pick;
uniform vec4 u_loads, u_selection, u_occupied;
uniform vec2 u_viewport;
uniform sampler2D u_backdrop;
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
  float y=along/(.043*size), x=across/(.0178*size);
  float d=length(vec2((x+.12*y*y)*(1.+.48*clamp(y,-1.,1.)),y));
  float pocket=1.-smoothstep(.78,1.90,d);
  flesh=mix(flesh,flesh*vec3(.78,.61,.65),pocket*.35);
  float seed=1.-smoothstep(.79,1.06,d);
  vec3 shell=mix(vec3(.083,.059,.09),vec3(.237,.139,.192),clamp(.22-.45*x+.17*y,0.,1.));
  shell+=vec3(.14,.11,.15)*(1.-smoothstep(.0,.60,length(vec2(x+.42,(y-.10)*.72))));
  shell+=vec3(.29,.23,.19)*(1.-smoothstep(.0,.29,length(vec2((x-.48)*.80,(y+.10)*.76))));
  return mix(flesh,shell,seed);
}

void main() {
  if(u_pick>.5) {
    gl_FragColor=vec4((v_material>2.5? 5.:u_index+1.)/255., 0., 0., 1.); return;
  }
  if(u_floor>0.5) {
    vec2 p=v_local.xy/u_scale;
    p.x-=.01;
    float wide=exp(-2.0*(p.x*p.x/2.0+pow((p.y+mix(.94,1.21,u_hero)-p.x*.030)/.16,2.)));
    float near=exp(-2.1*(p.x*p.x/.93+pow((p.y+mix(.94,1.21,u_hero)-p.x*.030)/.069,2.)));
    gl_FragColor=vec4(.16,.125,.22,.13*wide+.16*near);
    return;
  }
  if(v_material>2.5) {
    vec3 n=normalize(v_normal);
    vec3 eye=normalize(vec3(0.,0.,8.)-v_world);
    float facing=abs(dot(n,eye));
    vec3 ray=normalize(reflect(-eye,n)+vec3(.30*v_world.x-.17*v_world.y,.34*v_world.y+.14*v_world.x,0.));
    float fresnel=pow(1.-facing,2.25);
    // Studio strip lights reflect around the rounded shoulders of the casting.
    float windowLight=smoothstep(.13,.19,ray.y+.40*ray.x)*(1.-smoothstep(.64,.74,ray.y+.40*ray.x));
    float darkStrip=1.-smoothstep(.028,.15,abs(ray.x+.26*ray.y+.62));
    float whiteStrip=1.-smoothstep(.024,.091,abs(ray.x-.34*ray.y-.49));
    float edge=1.-smoothstep(.058,.22,abs(ray.y-.31*ray.x+.55));
    vec2 uv=gl_FragCoord.xy/u_viewport;
    vec2 offset=n.xy*(.006+.023*(1.-facing));
    vec4 refractImage=texture2D(u_backdrop, clamp(uv-offset,vec2(.001),vec2(.999)));
    vec3 bg=vec3(.886,.878,.933);
    vec3 transmitted=(refractImage.rgb+bg*(1.-refractImage.a));
    vec3 amethyst=mix(vec3(.42,.22,.61),vec3(.74,.60,.89),facing);
    vec3 glass=transmitted*mix(amethyst,vec3(1.),.37)+vec3(.019,.004,.039);
    glass=mix(glass,vec3(.24,.12,.36),.48*fresnel+.34*darkStrip);
    glass=mix(glass,vec3(.98,.95,1.),clamp(.43*windowLight+.80*whiteStrip+.55*edge,0.,1.));
    vec2 railDistance=abs(v_local.xy)-vec2(.72-.165,.79-.165);
    float across=(length(max(railDistance,vec2(0.)))+min(max(railDistance.x,railDistance.y),0.)-.165)/.116;
    float strand=across+.10*sin(v_local.y*4.+v_local.x*2.1);
    float ghost=exp(-pow((strand+.49)*6.4,2.))*.38+exp(-pow((strand-.64)*13.,2.))*.66;
    float band=exp(-pow((strand+.75)*10.,2.))*.46+exp(-pow((strand-.45)*9.,2.))*.19;
    float sheet=clamp(v_local.z*7.+.38,0.,1.);
    glass=mix(glass,vec3(.30,.117,.43),band*(.37+.63*sheet));
    glass=mix(glass,vec3(.985,.92,1.),ghost*(.28+.72*sheet));
    float ribbon=exp(-pow((v_local.x+.72*v_local.y-.67)*6.4,2.));
    glass=mix(glass,vec3(1.,.963,1.),.29*ribbon*(.28+.72*facing));
    // Four separate engraved gauges use unique incidents as their denominator.
    if(u_hero<.5 && v_local.z>.094 && abs(v_local.y-.79)<.025 && abs(v_local.x)<.55) {
      float rail=(v_local.x+.55)/1.10*4.;
      float slot=floor(rail), t=fract(rail);
      vec4 mask=1.-step(.48,abs(vec4(0.,1.,2.,3.)-slot));
      float load=dot(u_loads,mask);
      vec3 tint=mask.x*vec3(.77,0.,.20)+mask.y*vec3(.16,.40,.36)+mask.z*vec3(.40,.27,.58)+mask.w*vec3(.34,.32,.42);
      float track=smoothstep(.02,.06,t)*(1.-smoothstep(.9,.94,t));
      float level=load>.0001 ? 1.-smoothstep(load*.85+.04,load*.85+.065,t):0.;
      glass=mix(glass,mix(vec3(.86,.81,.90),tint,level),track);
    }
    gl_FragColor=vec4(glass,.94);
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
  vec3 peel=mix(vec3(.055,.237,.216),vec3(.30,.54,.419),smoothstep(-.68,.53,stripe + .24*(mottling-.5)));
  peel+=vec3(.045,.07,.06)*(mottling-.4)+vec3(.09)*(fine-.5);
  float fibres=(noise2(plane*vec2(92.,31.))-.5)*.038;
  float pulp=(large-.5)*.095+(mottling-.5)*.078+(grain-.5)*.077+(fine-.5)*.056+fibres;
  vec3 flesh=mix(vec3(.911,.12,.245),vec3(.99,.434,.532),large*.48+clamp((radius-.55)*1.2,0.,.34));
  float veins=noise2(plane*vec2(34.,10.)+2.6*vec2(large,noise3(v_local*3.6)));
  float juice=pow(max(0.,grain-.49)*2.,3.);
  flesh=mix(flesh,vec3(.957,.117,.206),.49);
  flesh+=pulp*vec3(.71,1.09,.88)+(veins-.5)*vec3(.09,.12,.13)+juice*vec3(.07,.10,.095);
  float edge=radius+(mottling-.5)*.012+(large-.5)*.019;
  flesh=mix(flesh,vec3(.985,.666,.736)+.04*(grain-.5),smoothstep(.785,.90,edge)*.83);
  vec3 pith=mix(vec3(.969,.936,.962),vec3(.756,.865,.824),smoothstep(.916,.963,edge));
  pith+=(grain-.5)*.065+(mottling-.5)*.038;
  vec3 color=mix(flesh,pith,smoothstep(.871,.907,edge));
  color=mix(color,mix(vec3(.48,.67,.587),peel,.35),smoothstep(.938,.979,edge));
  color=mix(color,peel,smoothstep(.976,.993,radius));
  if(!skin) {
    float crossSection=top?1.:sqrt(max(.002,1.-local.z*local.z));
    vec2 seedPlane=plane/crossSection;
    float id=top?9.:2.+u_index*1.6;
    float seedWeight=1.-smoothstep(.78,.84,radius);
    vec3 seeded=seedRing(seedPlane,color,.655,15.,.258+id*.123,id);
    seeded=seedRing(seedPlane,seeded,.400,8.,.03+id*.11,id+12.);
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
  if(u_hero<.5 && !skin && radius>.77 && radius<.91) {
    vec4 group=1.-step(.45,abs(vec4(0.,1.,2.,3.)-u_index));
    float selected=dot(group,u_selection), load=dot(group,u_loads);
    vec3 tint=group.x*vec3(.77,0.,.20)+group.y*vec3(.16,.40,.36)+group.z*vec3(.40,.27,.58)+group.w*vec3(.34,.32,.42);
    float a=clamp((atan(-plane.y,-plane.x)+.001)/3.14159,0.,1.);
    float arc=(1.-smoothstep(load,load+.009,a))*smoothstep(.81,.818,radius)*(1.-smoothstep(.831,.842,radius));
    color=mix(color,tint,arc*(.5+.45*selected)*step(.0001,load));
  }
  if(u_hero<.5) {
    vec4 group=1.-step(.45,abs(vec4(0.,1.,2.,3.)-u_index));
    float occupied=dot(u_occupied,group);
    float luminance=dot(color,vec3(.27,.58,.15));
    vec3 idleGlass=mix(vec3(.635,.625,.705),vec3(.912,.904,.953),luminance);
    float rim=pow(1.-abs(normal.z),2.);
    idleGlass+=vec3(.037,.03,.059)*rim;
    color=mix(idleGlass,color,occupied);
  }
  gl_FragColor=vec4(color,1.);
}
`;
