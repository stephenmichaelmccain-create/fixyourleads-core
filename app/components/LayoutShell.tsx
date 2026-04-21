import { ReactNode } from 'react';
import { Nav } from './Nav';

export function LayoutShell({
  title,
  children,
  companyId
}: {
  title: string;
  children: ReactNode;
  companyId?: string;
}) {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Nav companyId={companyId} />
      <h1 style={{ marginBottom: 16 }}>{title}</h1>
      {children}
    </main>
  );
}
