const GOOGLE_PLACES_SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';

export type GoogleMapsClinic = {
  placeId: string;
  name: string;
  phone: string | null;
  address: string | null;
  websiteUrl: string | null;
  googleMapsUrl: string | null;
  primaryType: string | null;
};

type SearchGoogleMapsClinicsInput = {
  query: string;
  limit?: number;
  languageCode?: string;
  regionCode?: string;
};

function getGoogleMapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || '';
}

export function isGoogleMapsConfigured() {
  return Boolean(getGoogleMapsApiKey());
}

export async function searchGoogleMapsClinics({
  query,
  limit = 10,
  languageCode = 'en',
  regionCode = 'US'
}: SearchGoogleMapsClinicsInput): Promise<GoogleMapsClinic[]> {
  const apiKey = getGoogleMapsApiKey();
  const normalizedQuery = String(query || '').trim();

  if (!apiKey) {
    throw new Error('google_maps_api_key_missing');
  }

  if (!normalizedQuery) {
    throw new Error('google_maps_query_required');
  }

  const maxResultCount = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const response = await fetch(GOOGLE_PLACES_SEARCH_TEXT_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.websiteUri',
        'places.googleMapsUri',
        'places.primaryType'
      ].join(',')
    },
    body: JSON.stringify({
      textQuery: normalizedQuery,
      maxResultCount,
      languageCode,
      regionCode
    })
  });

  if (!response.ok) {
    throw new Error(`google_maps_search_failed:${response.status}`);
  }

  const data = (await response.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      nationalPhoneNumber?: string;
      internationalPhoneNumber?: string;
      websiteUri?: string;
      googleMapsUri?: string;
      primaryType?: string;
    }>;
  };

  return (data.places || [])
    .filter((place) => place.id && place.displayName?.text)
    .map((place) => ({
      placeId: String(place.id),
      name: String(place.displayName?.text || '').trim(),
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
      address: place.formattedAddress || null,
      websiteUrl: place.websiteUri || null,
      googleMapsUrl: place.googleMapsUri || null,
      primaryType: place.primaryType || null
    }));
}
