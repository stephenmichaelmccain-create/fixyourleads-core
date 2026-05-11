'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type ClinicTypeFilterSelectProps = {
  defaultValue: string;
  options: string[];
  className?: string;
  name?: string;
  ariaLabel?: string;
  allLabel?: string;
};

export function ClinicTypeFilterSelect({
  defaultValue,
  options,
  className,
  name = 'clinicType',
  ariaLabel = 'Filter leads by clinic type',
  allLabel = 'All niches'
}: ClinicTypeFilterSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <select
      name={name}
      className={className}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      onChange={(event) => {
        const nextClinicType = event.currentTarget.value.trim();
        const params = new URLSearchParams(searchParams.toString());

        if (nextClinicType) {
          params.set(name, nextClinicType);
        } else {
          params.delete(name);
        }

        params.delete('prospectId');
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      }}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
