import type * as React from 'react';

/** UI slots accept React components and DOM tags, not a renderer's private intrinsic tags. */
export type CanvasComponent =
  | Exclude<React.ElementType, string>
  | (keyof React.JSX.IntrinsicElements &
      (keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap));
