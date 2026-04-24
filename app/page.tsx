import { ActivityPage, dynamic, type ActivitySearchParamShape } from './events/ActivityPage';

export { dynamic };

export default function HomePage({
  searchParams
}: {
  searchParams?: ActivitySearchParamShape;
}) {
  return (
    <ActivityPage
      searchParams={searchParams}
      basePath="/"
      title="Activity"
      hidePageHeader
      compact
      section="activity"
    />
  );
}
