/**
 * AudioContext + bus master/SFX. Le contexte est créé/repris au premier geste utilisateur
 * (Chrome bloque tout son avant). Rien n'est joué si `unlocked` est faux.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private masterVolume = 0.8;
  private sfxVolume = 0.8;

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** À appeler depuis un handler de geste utilisateur (pointerdown / keydown). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolumes(master: number, sfx: number): void {
    this.masterVolume = master;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.masterVolume * this.masterVolume, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.sfxVolume * this.sfxVolume, t, 0.02);
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Buffer de bruit blanc (2 s) généré en code, partagé. */
  noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noise) {
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let s = 0x12345678;
      for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        data[i] = (s / 4294967296) * 2 - 1;
      }
    }
    return this.noise;
  }
}
