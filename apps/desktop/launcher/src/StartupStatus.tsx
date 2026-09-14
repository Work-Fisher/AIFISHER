/** Startup reflects pending work; it never delays a ready session for an animation. */
export function StartupStatus({ message }: { message: string }) {
  return (
    <section className="startup-status" role="status" aria-live="polite" aria-busy="true">
      <img src={`${import.meta.env.BASE_URL}aifisher-mark-white.svg`} alt="" />
      <p>{message}</p>
      <span className="startup-progress" aria-hidden="true">
        <span />
      </span>
    </section>
  );
}
