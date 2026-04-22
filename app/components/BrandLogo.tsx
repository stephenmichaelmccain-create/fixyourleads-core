import Image from 'next/image';

export function BrandLogo({
  priority = false,
  className = ''
}: {
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`brand-lockup ${className}`.trim()}>
      <Image
        src="/brand/fyl-logo.png"
        alt="Fix Your Leads"
        width={760}
        height={121}
        priority={priority}
        className="brand-logo"
      />
    </div>
  );
}
