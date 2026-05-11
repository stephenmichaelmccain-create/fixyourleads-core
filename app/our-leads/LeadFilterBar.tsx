'use client';

import { usePathname, useRouter } from 'next/navigation';

type QueueCounts = {
  all: number;
  untouched: number;
  overdue: number;
  today: number;
  callbackReady: number;
  callbackLater: number;
  voicemail: number;
  notInterested: number;
  booked: number;
  noAnswer: number;
  sold: number;
  dead: number;
};

type LeadFilterBarProps = {
  queueCounts: QueueCounts;
  showingUntouched: boolean;
  searchQuery: string;
  selectedCity: string;
  selectedSource: string;
  selectedClinicType: string;
  selectedView: string;
  selectedStatus: string;
  selectedDue: string;
};

type FilterTarget = {
  view?: string;
  status?: string;
  nextActionDue?: string;
};

function applyParam(params: URLSearchParams, key: string, value?: string) {
  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}

export function LeadFilterBar({
  queueCounts,
  showingUntouched,
  searchQuery,
  selectedCity,
  selectedSource,
  selectedClinicType,
  selectedView,
  selectedStatus,
  selectedDue
}: LeadFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const navigateToFilter = (target: FilterTarget) => {
    const params = new URLSearchParams();
    applyParam(params, 'q', searchQuery);
    applyParam(params, 'city', selectedCity);
    applyParam(params, 'source', selectedSource);
    applyParam(params, 'clinicType', selectedClinicType);
    applyParam(params, 'view', target.view || '');
    applyParam(params, 'status', target.status || '');
    applyParam(params, 'nextActionDue', target.nextActionDue || '');

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="filter-bar">
      <button
        type="button"
        className={`filter-chip${showingUntouched ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({})}
      >
        Untouched {queueCounts.untouched}
      </button>
      <button
        type="button"
        className={`filter-chip${
          selectedStatus === 'GATEKEEPER' && selectedDue === 'ready' ? ' is-active' : ''
        }`}
        onClick={() => navigateToFilter({ status: 'GATEKEEPER', nextActionDue: 'ready' })}
      >
        Callback now {queueCounts.callbackReady}
      </button>
      <button
        type="button"
        className={`filter-chip${selectedStatus === 'NO_ANSWER' ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({ status: 'NO_ANSWER' })}
      >
        No answer {queueCounts.noAnswer}
      </button>
      <button
        type="button"
        className={`filter-chip${selectedStatus === 'VM_LEFT' ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({ status: 'VM_LEFT' })}
      >
        Left voicemail {queueCounts.voicemail}
      </button>
      <button
        type="button"
        className={`filter-chip${selectedStatus === 'NOT_INTERESTED' ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({ status: 'NOT_INTERESTED' })}
      >
        Not interested {queueCounts.notInterested}
      </button>
      <button
        type="button"
        className={`filter-chip${selectedStatus === 'BOOKED_DEMO' ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({ status: 'BOOKED_DEMO' })}
      >
        Booked {queueCounts.booked}
      </button>
      <button
        type="button"
        className={`filter-chip${selectedStatus === 'CLOSED' ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({ status: 'CLOSED' })}
      >
        Sold {queueCounts.sold}
      </button>
      <button
        type="button"
        className={`filter-chip${
          selectedStatus === 'GATEKEEPER' && (!selectedDue || selectedDue === 'later') ? ' is-active' : ''
        }`}
        onClick={() => navigateToFilter({ status: 'GATEKEEPER', nextActionDue: 'later' })}
      >
        Call back later {queueCounts.callbackLater}
      </button>
      <button
        type="button"
        className={`filter-chip${selectedStatus === 'DEAD' ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({ status: 'DEAD' })}
      >
        Do not contact {queueCounts.dead}
      </button>
      <button
        type="button"
        className={`filter-chip${selectedView === 'all' ? ' is-active' : ''}`}
        onClick={() => navigateToFilter({ view: 'all' })}
      >
        All {queueCounts.all}
      </button>
    </div>
  );
}
