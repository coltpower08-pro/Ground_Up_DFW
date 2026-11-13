// Sky, sun, moon, time of day and weather for the 3D map.
// Time runs on its own slow clock (a full day in about seven minutes), separate from the game calendar.
import * as THREE from 'three';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm';
const WEATHER_LABEL: Record<Weather, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm' };
const SUNRISE = 6.5, SUNSET = 19.5;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sat = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const C = (hex: string) => new THREE.Color(hex);
const KEY = {
  zenith: { day: C('#3f8fd6'), dusk: C('#34467e'), night: C('#060a18'), grey: C('#7f8a94') },
  horizon: { day: C('#cfe6f2'), dusk: C('#ff9a55'), night: C('#17223f'), grey: C('#b4bcc2') },
  sun: { high: C('#fff3da'), low: C('#ff9c57') },
  moon: C('#a9bdf2'),
  fill: { day: C('#cfe4ff'), dusk: C('#f0b08c'), night: C('#6d86cc') },
  ground: { day: C('#a98a58'), night: C('#2a3350') },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir;
uniform float night; uniform float cloud; uniform float sunUp; uniform float disc;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(up, 0.55));
  col = mix(col, horizon * 0.82, smoothstep(0.0, -0.25, d.y));
  float s = max(dot(d, sunDir), 0.0);
  float clear = 1.0 - cloud * 0.85;
  col += sunCol * sunUp * clear * (pow(s, 900.0) * 14.0 * disc + pow(s, 28.0) * 0.5 + pow(s, 4.0) * 0.16);
  float m = max(dot(d, moonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * night * clear * (smoothstep(0.9992, 0.9996, m) * 2.2 * disc + pow(m, 60.0) * 0.12);
  vec2 g = floor(vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 190.0);
  float star = step(0.9972, h21(g)) * (0.5 + 0.5 * h21(g + 7.0));
  col += vec3(star) * night * clear * smoothstep(0.02, 0.25, d.y) * 1.3 * disc;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RAIN_VERT = /* glsl */ `
uniform float time; uniform float height;
attribute float tip;
void main() {
  vec3 p = position;
  p.y = mod(p.y - time * 9.0, height) + tip * 0.16;
  p.x += tip * 0.025;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
uniform float amount; uniform vec3 tint;
void main() { gl_FragColor = vec4(tint, 0.26 * amount); }`;

export class Atmosphere {
  readonly sun = new THREE.DirectionalLight('#ffe6bc', 3.4);
  readonly hemi = new THREE.HemisphereLight('#cfe4ff', '#a98a58', 0.6);
  readonly dir = new THREE.Vector3(-0.6, 0.66, 0.43); // direction toward the light that casts shadows
  /** 0 in daylight, 1 in full night. Drives window lights, street lights and headlights. */
  night = 0;
  /** 0 to 1: cloud cover, rainfall, and how wet the ground is. */
  cloud = 0; rain = 0; wet = 0;
  hour = 9.5;
  weather: Weather = 'clear';
  exposure = 0.95;
  private sky: THREE.Mesh;
  private skyU: Record<string, { value: unknown }>;
  private rainMesh: THREE.LineSegments;
  private rainU: Record<string, { value: unknown }>;
  private clouds: THREE.Mesh;
  private cloudTex: THREE.Texture;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private weatherLeft = 70;
  private flash = 0; private nextFlash = 4;
  private fogCol = new THREE.Color();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, mapW: number, mapH: number) {
    this.skyU = { zenith: { value: KEY.zenith.day.clone() }, horizon: { value: KEY.horizon.day.clone() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: KEY.sun.high.clone() }, moonDir: { value: new THREE.Vector3(-0.35, 0.62, -0.7).normalize() }, night: { value: 0 }, cloud: { value: 0 }, sunUp: { value: 1 }, disc: { value: 1 } };
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    scene.add(this.sky);
    scene.background = null;
    scene.fog = new THREE.Fog('#ecd3ae', 100, 500);
    this.sun.castShadow = true; this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02;
    scene.add(this.hemi, this.sun, this.sun.target);

    // the same sky, rendered into a small cube map, gives glass and water something to reflect
    const envSky = new THREE.Mesh(this.sky.geometry, skyMat); envSky.scale.setScalar(50);
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // rain: short streaks in a box that follows the camera
    const N = 5200, pos = new Float32Array(N * 6), tip = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const x = Math.random() * 16 - 8, y = Math.random() * 9, z = Math.random() * 16 - 8; pos.set([x, y, z, x, y, z], i * 6); tip[i * 2 + 1] = 1; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    this.rainU = { time: { value: 0 }, height: { value: 9 }, amount: { value: 0 }, tint: { value: new THREE.Color('#dfe8f2') } };
    this.rainMesh = new THREE.LineSegments(rg, new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, fog: false }));
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false; this.rainMesh.renderOrder = 5;
    scene.add(this.rainMesh);

    // drifting cloud shadows over the whole metro
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d')!;
    c.fillStyle = '#000'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 14 + Math.random() * 44; for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) { const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
    this.cloudTex = new THREE.CanvasTexture(cv); this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping; this.cloudTex.repeat.set(2.2, 1.8);
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(mapW * 1.6, mapH * 1.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#101822', alphaMap: this.cloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.clouds.position.set(mapW / 2, 0.07, mapH / 2); this.clouds.renderOrder = 2;
    scene.add(this.clouds);
  }

  /** Short label for the on-screen chip, like "2:40 PM · Clear". */
  status(): string {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 6) * 10;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} · ${WEATHER_LABEL[this.weather]}`;
  }
  skip(hours: number) { this.hour = (this.hour + hours) % 24; }
  set(o: { hour?: number; weather?: Weather }) { if (o.hour !== undefined) this.hour = o.hour; if (o.weather) { this.weather = o.weather; this.weatherLeft = 120; const [c, r] = this.targets(); this.cloud = c; this.rain = r; } }
  private targets(): [number, number] { return this.weather === 'clear' ? [0, 0] : this.weather === 'cloudy' ? [0.7, 0] : this.weather === 'rain' ? [0.9, 0.6] : [1, 1]; }

  update(dt: number, t: number, cam: { tx: number; tz: number; dist: number; far: number }, camera: THREE.Camera, o: { cycle: boolean; weather: boolean }) {
    // --- clock ---
    if (o.cycle) { const dayTime = this.hour > 6 && this.hour < 20; this.hour = (this.hour + dt * (dayTime ? 0.043 : 0.12)) % 24; }
    else this.hour = 15.5;
    // --- weather ---
    if (o.weather) {
      this.weatherLeft -= dt;
      if (this.weatherLeft <= 0) {
        const r = Math.random();
        this.weather = this.weather !== 'clear' && r < 0.5 ? 'clear' : r < 0.58 ? 'clear' : r < 0.82 ? 'cloudy' : r < 0.95 ? 'rain' : 'storm';
        this.weatherLeft = this.weather === 'clear' ? 110 + Math.random() * 140 : 45 + Math.random() * 60;
      }
    } else this.weather = 'clear';
    const [tc, tr] = this.targets();
    this.cloud += Math.sign(tc - this.cloud) * Math.min(Math.abs(tc - this.cloud), dt * 0.12);
    this.rain += Math.sign(tr - this.rain) * Math.min(Math.abs(tr - this.rain), dt * 0.1);
    this.wet += ((this.rain > 0.05 ? 1 : 0) - this.wet) * Math.min(1, dt * (this.rain > 0.05 ? 0.12 : 0.03));

    // --- sun and moon ---
    const a = (Math.PI * (this.hour - SUNRISE)) / (SUNSET - SUNRISE), elev = Math.sin(a); // elev < 0 at night
    const sunDir = new THREE.Vector3(Math.cos(a) * 0.95, Math.max(-0.3, elev) * 0.95, 0.42).normalize();
    this.night = 1 - smooth(-0.12, 0.14, elev);
    const sunUp = smooth(-0.02, 0.16, elev), low = 1 - smooth(0.05, 0.5, elev), dusk = (1 - this.night) * low;
    const moonDir = this.skyU.moonDir.value as THREE.Vector3;
    const useMoon = sunUp < 0.02;
    this.dir.copy(useMoon ? moonDir : sunDir);
    if (!useMoon && this.dir.y < 0.14) { this.dir.y = 0.14; this.dir.normalize(); } // keep shadows from stretching forever at sunrise and sunset
    const overcast = 1 - this.cloud * 0.55 - this.rain * 0.25;
    if (useMoon) { this.sun.color.copy(KEY.moon); this.sun.intensity = 1.35 * this.night * (1 - this.cloud * 0.5); }
    else { this.sun.color.copy(KEY.sun.low).lerp(KEY.sun.high, smooth(0.04, 0.45, elev)); this.sun.intensity = 3.9 * sunUp * overcast; }
    this.sun.target.position.set(cam.tx, 0, cam.tz);
    this.sun.position.set(cam.tx + this.dir.x * 70, this.dir.y * 70, cam.tz + this.dir.z * 70);

    // --- sky colors ---
    const zen = this.skyU.zenith.value as THREE.Color, hor = this.skyU.horizon.value as THREE.Color;
    zen.copy(KEY.zenith.day).lerp(KEY.zenith.dusk, dusk).lerp(KEY.zenith.night, this.night);
    hor.copy(KEY.horizon.day).lerp(KEY.horizon.dusk, dusk * 0.9).lerp(KEY.horizon.night, this.night);
    const greyK = this.cloud * 0.8, dim = 1 - this.night * 0.9;
    zen.lerp(KEY.zenith.grey.clone().multiplyScalar(dim * (1 - this.rain * 0.35)), greyK); hor.lerp(KEY.horizon.grey.clone().multiplyScalar(dim * (1 - this.rain * 0.3)), greyK);
    if (this.weather === 'storm' && this.rain > 0.6) { this.nextFlash -= dt; if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 2.5 + Math.random() * 7; } }
    this.flash = Math.max(0, this.flash - dt * 5);
    (this.skyU.sunDir.value as THREE.Vector3).copy(sunDir);
    (this.skyU.sunCol.value as THREE.Color).copy(this.sun.color);
    this.skyU.night.value = this.night; this.skyU.cloud.value = this.cloud; this.skyU.sunUp.value = sunUp;
    this.sky.position.copy(camera.position); this.sky.scale.setScalar(cam.far * 0.92);

    // --- fill light, haze, exposure ---
    this.hemi.color.copy(KEY.fill.day).lerp(KEY.fill.dusk, dusk * 0.6).lerp(KEY.fill.night, this.night).lerp(KEY.horizon.grey, greyK * (1 - this.night) * 0.6); this.hemi.groundColor.copy(KEY.ground.day).lerp(KEY.ground.night, this.night);
    this.hemi.intensity = (lerp(0.42, 0.85, this.night) + dusk * 0.45) * lerp(1, 1.1, this.cloud * (1 - this.night)) * lerp(1, 0.7, this.rain) + this.flash * 3.5;
    this.scene.environmentIntensity = lerp(0.4, 1.2, this.night) + this.flash;
    const fog = this.scene.fog as THREE.Fog;
    this.fogCol.copy(hor).lerp(zen, 0.15); fog.color.copy(this.fogCol);
    const haze = 1 - this.rain * 0.55 - this.cloud * 0.12;
    fog.near = (cam.dist * 4 + 12) * haze; fog.far = (cam.dist * 12 + 130) * haze;
    this.exposure = lerp(0.95, 1.5, this.night) * lerp(1, 0.82, this.rain);

    // --- rain and cloud shadows ---
    this.rainMesh.visible = this.rain > 0.02;
    if (this.rainMesh.visible) {
      const s = Math.max(0.35, cam.dist / 9);
      this.rainMesh.position.set(cam.tx, 0, cam.tz); this.rainMesh.scale.setScalar(s);
      this.rainU.time.value = t; this.rainU.amount.value = this.rain * lerp(1, 0.5, this.night);
    }
    this.cloudTex.offset.set(t * 0.004, t * 0.0017);
    (this.clouds.material as THREE.MeshBasicMaterial).opacity = this.cloud * 0.3 * (1 - this.night * 0.7) * smooth(26, 44, cam.dist);
    this.clouds.visible = this.cloud > 0.02 && cam.dist > 26; // hidden up close, where it would block the contact shading

    // --- reflections: refresh the sky cube map when the light has changed enough to notice ---
    const key = `${Math.round(this.hour * 5)}|${Math.round(this.cloud * 6)}|${this.flash > 0.3 ? 1 : 0}`;
    if (key !== this.envKey) {
      this.envKey = key;
      const old = this.envRT;
      this.skyU.disc.value = 0.04; // a pin-sharp sun or moon in the reflection map turns into glare on water and glass
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      this.skyU.disc.value = 1;
      this.scene.environment = this.envRT.texture;
      old?.dispose();
    }
  }
  dispose() { this.envRT?.dispose(); this.pmrem.dispose(); }
}
