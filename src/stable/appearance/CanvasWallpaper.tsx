import * as React from 'react';
import {
  useCanvasAppearance,
  type AppearancePreferences,
  type BackgroundImage,
  type CanvasAppearance,
} from './canvasAppearance';

function ActiveWallpaperLayers({
  image,
  background,
}: {
  image: BackgroundImage;
  background: AppearancePreferences['background'];
}) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  return (
    <div className="af-wallpaper" aria-hidden="true" data-af-wallpaper="true">
      <img
        key={image.id}
        src={image.url}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        style={{
          objectPosition: `${background.positionX}% ${background.positionY}%`,
          filter: background.blur ? `blur(${background.blur}px)` : undefined,
        }}
      />
      <div className="af-wallpaper-wash" style={{ opacity: background.fade / 100 }} />
    </div>
  );
}

export function WallpaperLayers({ appearance }: { appearance: CanvasAppearance }) {
  const { image, background } = appearance;
  // Failure stays quiet for this enabled period. Explicitly disabling/re-enabling (or replacing
  // the image) mounts a fresh attempt; theme/fade changes never start a background retry loop.
  return image && background.enabled ? (
    <ActiveWallpaperLayers key={image.id} image={image} background={background} />
  ) : null;
}

/** Outside the transformed canvas; no pointer targets or project state. */
export function CanvasWallpaper() {
  const appearance = useCanvasAppearance();
  return <WallpaperLayers appearance={appearance} />;
}
