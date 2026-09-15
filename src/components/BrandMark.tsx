export default function BrandMark({ large = false }: { large?: boolean }) {
  return <div className={`brand-mark${large ? ' large' : ''}`} aria-hidden="true"><span /></div>;
}
