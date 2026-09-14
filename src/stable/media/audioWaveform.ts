import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

export interface AudioRange {
  start: number;
  end: number;
}
export interface AudioWaveformEvents {
  ready(duration: number): void;
  time(time: number): void;
  playing(playing: boolean): void;
  range(range: AudioRange | null): void;
  error(error: unknown): void;
}
export interface AudioWaveform {
  playPause(): Promise<void>;
  pause(): void;
  setEditing(editing: boolean, trimming: boolean): void;
  destroy(): void;
}
export function createAudioWaveform(
  container: HTMLElement,
  url: string,
  events: AudioWaveformEvents,
): AudioWaveform {
  // WaveSurfer paints to a canvas, where CSS variables are not resolved as colours.
  // Repaint its palette in place when the root theme changes; do not reload the audio.
  const palette = () => {
    const style = getComputedStyle(container);
    const colour = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    return {
      waveColor: colour('--af-text-muted', '#a3a3a3'),
      progressColor: colour('--af-info', '#60a5fa'),
      cursorColor: colour('--af-danger', '#fb7185'),
    };
  };
  const player = WaveSurfer.create({
    container,
    ...palette(),
    cursorWidth: 1,
    height: 55,
    interact: false,
    dragToSeek: false,
    normalize: true,
    fillParent: true,
  });
  const regions = player.registerPlugin(RegionsPlugin.create());
  let disposed = false;
  const themeObserver = new MutationObserver(() => {
    if (!disposed) player.setOptions(palette());
  });
  themeObserver.observe(container.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['data-af-theme'],
  });
  let disableSelection: (() => void) | undefined;
  const clearRegions = () => {
    regions.clearRegions();
    events.range(null);
  };
  player.on('ready', (duration) => {
    if (!disposed) events.ready(duration);
  });
  player.on('timeupdate', (time) => {
    if (!disposed) events.time(time);
  });
  player.on('seeking', (time) => {
    if (!disposed) events.time(time);
  });
  player.on('play', () => {
    if (!disposed) events.playing(true);
  });
  player.on('pause', () => {
    if (!disposed) events.playing(false);
  });
  player.on('finish', () => {
    if (!disposed) events.playing(false);
  });
  player.on('error', (error) => {
    if (!disposed) events.error(error);
  });
  regions.on('region-created', (region) => {
    if (disposed) return;
    regions.getRegions().forEach((other) => {
      if (other !== region) other.remove();
    });
    region.setOptions({ drag: false, resize: false });
    events.range({ start: region.start, end: region.end });
  });
  regions.on('region-updated', (region) => {
    if (!disposed) events.range({ start: region.start, end: region.end });
  });
  // Explicit load lets every event listener be installed before cached media resolves.
  void player.load(url).catch((error) => {
    if (!disposed) events.error(error);
  });
  return {
    playPause: () => player.playPause(),
    pause: () => player.pause(),
    setEditing(editing, trimming) {
      disableSelection?.();
      disableSelection = undefined;
      container.removeEventListener('pointerdown', clearRegions, true);
      player.setOptions({ interact: editing && !trimming, dragToSeek: editing && !trimming });
      if (editing && trimming) {
        disableSelection = regions.enableDragSelection({
          color: 'rgba(59,130,246,0.3)',
          resize: false,
          drag: false,
        });
        container.addEventListener('pointerdown', clearRegions, true);
      } else clearRegions();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      themeObserver.disconnect();
      disableSelection?.();
      container.removeEventListener('pointerdown', clearRegions, true);
      player.destroy();
    },
  };
}
