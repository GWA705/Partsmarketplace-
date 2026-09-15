import { partTag } from '@/lib/constants';

export default function PartTags({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return (
    <span className="inline-flex gap-1 align-middle">
      {tags.map((t) => {
        const tag = partTag(t);
        if (!tag) return null;
        return (
          <span
            key={t}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${tag.badgeClass}`}
          >
            {tag.label}
          </span>
        );
      })}
    </span>
  );
}
