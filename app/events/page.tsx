import { ActivityPage, dynamic, type ActivitySearchParamShape } from './ActivityPage';

export { dynamic };

export default async function EventsPage({
  searchParams
}: {
  searchParams?: ActivitySearchParamShape;
}) {
  return ActivityPage({ searchParams });
}

