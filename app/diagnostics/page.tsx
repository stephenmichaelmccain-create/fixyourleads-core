export default function DiagnosticsPage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Diagnostics</h1>
      <ul>
        <li>NODE_ENV: {process.env.NODE_ENV || 'unset'}</li>
        <li>APP_BASE_URL: {process.env.APP_BASE_URL ? 'set' : 'missing'}</li>
        <li>DATABASE_URL: {process.env.DATABASE_URL ? 'set' : 'missing'}</li>
        <li>REDIS_URL: {process.env.REDIS_URL ? 'set' : 'missing'}</li>
        <li>TELNYX_API_KEY: {process.env.TELNYX_API_KEY ? 'set' : 'missing'}</li>
        <li>TELNYX_FROM_NUMBER: {process.env.TELNYX_FROM_NUMBER ? 'set' : 'missing'}</li>
        <li>INTERNAL_API_KEY: {process.env.INTERNAL_API_KEY ? 'set' : 'missing'}</li>
      </ul>
    </main>
  );
}
