import * as React from 'react';
import type { PromptKeyHandle } from '../prompt/promptComponents';

type Source = (...args: never[]) => React.ReactNode;
type Dependencies<F extends Source> =
  Parameters<F> extends [unknown, unknown, ...infer Rest] ? Rest : never;
type RefDependencies<F extends Source> =
  Parameters<F> extends [unknown, unknown, unknown, ...infer Rest] ? Rest : never;

/** Bind the shared React instance and retain each presentation's typed dependency contract. */
export function bind<F extends Source>(source: F) {
  type Props = Parameters<F>[1];
  const render = source as unknown as (
    runtime: typeof React,
    props: Props,
    ...dependencies: Dependencies<F>
  ) => React.ReactNode;
  return (dependencies: () => Dependencies<F>) => {
    function Presentation(props: Props) {
      return render(React, props, ...dependencies());
    }
    // Existing document-driven slots accept extension fields. Keep that public
    // contract while checking this source function's dependency tuple here.
    return Presentation as React.FunctionComponent<Props> &
      React.FunctionComponent<Record<string, unknown>>;
  };
}

export function bindRef<F extends Source>(source: F) {
  type Props = Parameters<F>[1];
  const render = source as unknown as (
    runtime: typeof React,
    props: Props,
    ref: React.ForwardedRef<PromptKeyHandle>,
    ...dependencies: RefDependencies<F>
  ) => React.ReactNode;
  return (dependencies: () => RefDependencies<F>) =>
    React.forwardRef<PromptKeyHandle, Props>(function Presentation(props, ref) {
      return render(React, props as Props, ref, ...dependencies());
    });
}
