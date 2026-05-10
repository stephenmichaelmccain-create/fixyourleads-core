'use client';

type ClinicTypeFilterSelectProps = {
  defaultValue: string;
  options: string[];
  className?: string;
  name?: string;
  ariaLabel?: string;
};

export function ClinicTypeFilterSelect({
  defaultValue,
  options,
  className,
  name = 'clinicType',
  ariaLabel = 'Filter leads by clinic type'
}: ClinicTypeFilterSelectProps) {
  return (
    <select
      name={name}
      className={className}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      onChange={(event) => {
        event.currentTarget.form?.requestSubmit();
      }}
    >
      <option value="">All niches</option>
      {options.map((clinicType) => (
        <option key={clinicType} value={clinicType}>
          {clinicType}
        </option>
      ))}
    </select>
  );
}
