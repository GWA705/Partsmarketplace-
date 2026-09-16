/**
 * A part's photo, at whatever size the row needs.
 *
 * Almost none of the 1,380 imported parts has one — nobody is going to
 * photograph a catalogue that size — so the placeholder is the common case and
 * has to look deliberate rather than broken. It is a quiet outline box, not a
 * grey square with a torn-image icon.
 *
 * Photos come back through an authenticated route, never a public URL.
 */
export default function PartThumb({
  partId,
  hasImage,
  alt,
  size = 40,
}: {
  partId: string;
  hasImage: boolean;
  alt?: string;
  size?: number;
}) {
  const style = { width: size, height: size } as const;

  if (!hasImage) {
    return (
      <span
        aria-hidden="true"
        style={style}
        className="shrink-0 grid place-items-center rounded border border-line bg-canvas"
      >
        <svg width={Math.round(size * 0.45)} height={Math.round(size * 0.45)} viewBox="0 0 16 16" fill="none">
          <path
            d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3v-5Z M2.5 5.5 8 8.5l5.5-3 M8 8.5v5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
            className="text-line"
            opacity="0.85"
          />
        </svg>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/parts/${partId}/image`}
      alt={alt ?? ''}
      width={size}
      height={size}
      loading="lazy"
      style={style}
      className="shrink-0 rounded border border-line object-cover bg-surface"
    />
  );
}
